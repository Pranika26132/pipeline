"use server";

import { revalidatePath } from "next/cache";

import { parseCsv } from "@/lib/csv";
import { normalizeCompanyUrl } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

import { CSV_MAX_BYTES, CSV_MAX_ROWS } from "./limits";

export type RowOutcome = {
  // What the user gave us for this row, so they can find it in their file.
  label: string;
  line?: number;
  domain?: string;
  status: "added" | "duplicate" | "skipped";
  message: string;
};

export type AddState = {
  error?: string;
  rows?: RowOutcome[];
  // Bumps on every submit so a new result is announced.
  submittedAt?: number;
  // Echoed back on an error so the field keeps what the user typed.
  url?: string;
  name?: string;
};

type Candidate = {
  label: string;
  line?: number;
  name: string;
  url: string;
  domain: string;
};

const LOOKUP_CHUNK = 100;

export async function addFromUrl(_prev: AddState, formData: FormData): Promise<AddState> {
  const submittedAt = Date.now();
  const input = String(formData.get("url") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  const normalized = normalizeCompanyUrl(input);
  if (!normalized.ok) {
    return { submittedAt, url: input, name, error: normalized.error };
  }

  const candidate: Candidate = {
    label: input.trim(),
    name: name || normalized.domain,
    url: normalized.url,
    domain: normalized.domain,
  };
  const result = await save([candidate], [], "link", submittedAt);
  return result.error ? { ...result, url: input, name } : result;
}

export async function addFromCsv(_prev: AddState, formData: FormData): Promise<AddState> {
  const submittedAt = Date.now();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { submittedAt, error: "Choose a CSV file first." };
  }
  if (file.size > CSV_MAX_BYTES) {
    return {
      submittedAt,
      error: `That file is ${Math.ceil(file.size / 1024)} KB. The limit is ${CSV_MAX_BYTES / 1024} KB; split it into smaller files.`,
    };
  }

  let table: string[][];
  try {
    table = parseCsv(await file.text());
  } catch (e) {
    return { submittedAt, error: `Couldn't read that CSV. ${(e as Error).message}` };
  }

  if (table.length === 0) {
    return { submittedAt, error: "That file is empty." };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const nameCol = header.indexOf("name");
  const urlCol = header.indexOf("url");
  if (nameCol === -1 || urlCol === -1) {
    const missing = [nameCol === -1 && "name", urlCol === -1 && "url"].filter(Boolean).join(" and ");
    return {
      submittedAt,
      error: `The first row needs column headers called name and url. Missing: ${missing}.`,
    };
  }

  const body = table.slice(1);
  if (body.length === 0) {
    return { submittedAt, error: "That file has headers but no companies under them." };
  }
  if (body.length > CSV_MAX_ROWS) {
    return {
      submittedAt,
      error: `That file has ${body.length} companies. The limit is ${CSV_MAX_ROWS} per file; split it up.`,
    };
  }

  const candidates: Candidate[] = [];
  const rejected: RowOutcome[] = [];
  body.forEach((cells, i) => {
    // Line numbers match the file as opened in a spreadsheet (header is line 1).
    const line = i + 2;
    const rawUrl = (cells[urlCol] ?? "").trim();
    const rawName = (cells[nameCol] ?? "").trim();
    const label = rawName || rawUrl || "(blank)";
    const normalized = normalizeCompanyUrl(rawUrl);
    if (!normalized.ok) {
      rejected.push({ label, line, status: "skipped", message: normalized.error });
      return;
    }
    candidates.push({
      label,
      line,
      name: rawName || normalized.domain,
      url: normalized.url,
      domain: normalized.domain,
    });
  });

  return save(candidates, rejected, `csv:${file.name}`, submittedAt);
}

async function save(
  candidates: Candidate[],
  rejected: RowOutcome[],
  source: string,
  submittedAt: number,
): Promise<AddState> {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims) {
    return {
      submittedAt,
      error: authError
        ? `Your session couldn't be checked (${authError.message}). Sign in again.`
        : "You're signed out. Sign in again to add companies.",
    };
  }

  const outcomes: RowOutcome[] = [...rejected];

  // The same domain twice in one file: keep the first.
  const firstLine = new Map<string, number | undefined>();
  const unique: Candidate[] = [];
  for (const c of candidates) {
    if (firstLine.has(c.domain)) {
      const earlier = firstLine.get(c.domain);
      outcomes.push({
        label: c.label,
        line: c.line,
        domain: c.domain,
        status: "duplicate",
        message: earlier ? `Same site as line ${earlier} of this file.` : "Same site as an earlier row.",
      });
    } else {
      firstLine.set(c.domain, c.line);
      unique.push(c);
    }
  }

  // Domains already saved for this user. RLS limits the lookup to their rows.
  const existing = new Set<string>();
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK).map((c) => c.domain);
    const { data, error } = await supabase.from("companies").select("domain").in("domain", chunk);
    if (error) {
      return { submittedAt, error: `Couldn't check your list for duplicates (${error.message}). Nothing was added.` };
    }
    data.forEach((row) => existing.add(row.domain));
  }

  const fresh: Candidate[] = [];
  for (const c of unique) {
    if (existing.has(c.domain)) {
      outcomes.push({
        label: c.label,
        line: c.line,
        domain: c.domain,
        status: "duplicate",
        message: `${c.domain} is already in your list.`,
      });
    } else {
      fresh.push(c);
    }
  }

  if (fresh.length > 0) {
    const { error } = await supabase
      .from("companies")
      .insert(fresh.map((c) => ({ name: c.name, url: c.url, domain: c.domain, source })));
    if (error) {
      const message =
        error.code === "23505"
          ? "One of these sites was added from another tab at the same time. Nothing was added; try again."
          : `Couldn't save (${error.message}). Nothing was added.`;
      return { submittedAt, error: message };
    }
    fresh.forEach((c) =>
      outcomes.push({ label: c.label, line: c.line, domain: c.domain, status: "added", message: "Added." }),
    );
    revalidatePath("/");
  }

  outcomes.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { submittedAt, rows: outcomes };
}
