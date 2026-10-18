"use server";

import { revalidatePath } from "next/cache";

import { parseCsv, type CsvRow } from "@/lib/csv";
import { normalizeCompanyUrl } from "@/lib/domain";
import { containsWords, mentionsPerson, normalize } from "@/lib/enrich/extract";
import type { FindConnection } from "@/lib/find-limits";
import type { CompanyLocation } from "@/lib/locations";
import { rescore } from "@/lib/rescore";
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
  // Companies this submit added, so they can be queued for a lookup.
  added?: { id: string; name: string; domain?: string }[];
};

type Candidate = {
  label: string;
  line?: number;
  name: string;
  url: string;
  domain: string;
  // From the optional CSV columns: a tag like "Duke" and the page it came from.
  connection?: string;
  connectionSource?: string;
  // From Find: office locations with their quoted sentence and page.
  locations?: CompanyLocation[];
};

const LOOKUP_CHUNK = 100;
const NAME_MAX_LENGTH = 200;
const CONNECTION_MAX_LENGTH = 200;
const FILENAME_MAX_LENGTH = 100;

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Every action checks the session before reading the request body further.
async function signedInClient(): Promise<{ supabase: Supabase } | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    return { error: `Your session couldn't be checked (${error.message}). Sign in again.` };
  }
  if (!data?.claims) {
    return { error: "You're signed out. Sign in again to add companies." };
  }
  return { supabase };
}

export async function addFromUrl(_prev: AddState, formData: FormData): Promise<AddState> {
  const submittedAt = Date.now();
  const input = String(formData.get("url") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  const session = await signedInClient();
  if ("error" in session) {
    return { submittedAt, url: input, name, error: session.error };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return { submittedAt, url: input, name, error: `Keep the name under ${NAME_MAX_LENGTH} characters.` };
  }

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
  const result = await save(session.supabase, [candidate], [], "link", submittedAt);
  return result.error ? { ...result, url: input, name } : result;
}

export async function addFromCsv(_prev: AddState, formData: FormData): Promise<AddState> {
  const submittedAt = Date.now();
  const session = await signedInClient();
  if ("error" in session) {
    return { submittedAt, error: session.error };
  }
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

  let table: CsvRow[];
  try {
    table = parseCsv(await file.text());
  } catch (e) {
    return { submittedAt, error: `Couldn't read that CSV. ${(e as Error).message}` };
  }

  if (table.length === 0) {
    return { submittedAt, error: "That file is empty." };
  }

  const header = table[0].cells.map((h) => h.trim().toLowerCase());
  const nameCol = header.indexOf("name");
  const urlCol = header.indexOf("url");
  // Optional: "connection" (e.g. Duke) and "source_url" (the page the list came from).
  const connectionCol = header.indexOf("connection");
  const sourceCol = header.indexOf("source_url");
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
  body.forEach(({ cells, line }) => {
    const rawUrl = (cells[urlCol] ?? "").trim();
    const rawName = (cells[nameCol] ?? "").trim();
    const label = rawName || rawUrl || "(blank)";
    const normalized = normalizeCompanyUrl(rawUrl);
    if (!normalized.ok) {
      rejected.push({ label, line, status: "skipped", message: normalized.error });
      return;
    }
    if (rawName.length > NAME_MAX_LENGTH) {
      rejected.push({
        label: `${rawName.slice(0, 60)}…`,
        line,
        status: "skipped",
        message: `Name is over ${NAME_MAX_LENGTH} characters.`,
      });
      return;
    }
    const connection = connectionCol === -1 ? "" : (cells[connectionCol] ?? "").trim().replace(/\s+/g, " ");
    const rawSource = sourceCol === -1 ? "" : (cells[sourceCol] ?? "").trim();
    if (connection.length > CONNECTION_MAX_LENGTH) {
      rejected.push({ label, line, status: "skipped", message: `Connection is over ${CONNECTION_MAX_LENGTH} characters.` });
      return;
    }
    let connectionSource: string | undefined;
    if (connection && rawSource) {
      const source = httpUrl(rawSource);
      if (!source) {
        rejected.push({ label, line, status: "skipped", message: "source_url isn't a web address starting with https://." });
        return;
      }
      connectionSource = source;
    }
    candidates.push({
      label,
      line,
      name: rawName || normalized.domain,
      url: normalized.url,
      domain: normalized.domain,
      connection: connection || undefined,
      connectionSource,
    });
  });

  const source = `csv:${file.name.slice(0, FILENAME_MAX_LENGTH)}`;
  return save(session.supabase, candidates, rejected, source, submittedAt);
}

async function save(
  supabase: Supabase,
  candidates: Candidate[],
  rejected: RowOutcome[],
  source: string,
  submittedAt: number,
): Promise<AddState> {
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
  const retag: Candidate[] = [];
  for (const c of unique) {
    if (existing.has(c.domain)) {
      if (c.connection) retag.push(c);
      else
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

  // An already-saved company gets the list's tag if it has none yet; a tag it
  // already has is left alone. One update per tag, source and chunk.
  const groups = new Map<string, Candidate[]>();
  for (const c of retag) {
    const key = JSON.stringify([c.connection, c.connectionSource ?? null]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const taggedDomains = new Set<string>();
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += LOOKUP_CHUNK) {
      const chunk = group.slice(i, i + LOOKUP_CHUNK);
      const { data, error } = await supabase
        .from("companies")
        .update({ connection: chunk[0].connection, connection_source_url: chunk[0].connectionSource ?? null })
        .in("domain", chunk.map((c) => c.domain))
        .is("connection", null)
        .select("domain");
      if (error) {
        const done = taggedDomains.size > 0 ? ` ${taggedDomains.size} saved companies were already tagged.` : "";
        return { submittedAt, error: `Couldn't tag saved companies (${error.message}). Nothing new was added.${done}` };
      }
      data.forEach((row) => taggedDomains.add(row.domain));
    }
  }
  for (const c of retag) {
    const tagged = taggedDomains.has(c.domain);
    outcomes.push({
      label: c.label,
      line: c.line,
      domain: c.domain,
      status: "duplicate",
      message: tagged
        ? `${c.domain} is already in your list; tagged it ${c.connection}.`
        : `${c.domain} is already in your list and already has a tag.`,
    });
  }

  let added: { id: string; name: string }[] = [];
  if (fresh.length > 0) {
    const { data: inserted, error } = await supabase
      .from("companies")
      .insert(
        fresh.map((c) => ({
          name: c.name,
          url: c.url,
          domain: c.domain,
          source,
          connection: c.connection ?? null,
          connection_source_url: c.connectionSource ?? null,
          locations: c.locations ?? [],
        })),
      )
      .select("id, name, domain");
    if (error) {
      const message =
        error.code === "23505"
          ? "One of these sites was added from another tab at the same time. Nothing was added; try again."
          : `Couldn't save (${error.message}). Nothing was added.`;
      const done = taggedDomains.size > 0 ? ` ${taggedDomains.size} saved companies were tagged before this.` : "";
      return { submittedAt, error: message + done };
    }
    added = inserted;
    fresh.forEach((c) =>
      outcomes.push({ label: c.label, line: c.line, domain: c.domain, status: "added", message: c.connection ? `Added, tagged ${c.connection}.` : "Added." }),
    );
  }
  if (fresh.length > 0 || retag.length > 0) revalidatePath("/", "layout");

  // A new tag can change a looked-up company's score. One rescore covers all.
  if (taggedDomains.size > 0) {
    const scored = await rescore(supabase);
    if (scored.error) {
      outcomes.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
      return { submittedAt, rows: outcomes, added, error: `Imported, but scores couldn't be updated. ${scored.error}` };
    }
  }

  outcomes.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { submittedAt, rows: outcomes, added };
}

const FIND_MAX_ADD = 20;

// Adds the companies the user ticked in Find. The list comes from the
// browser, so each site goes through the same checks as a pasted link.
export async function addFromFind(
  items: { name: string; url: string; connections?: FindConnection[] }[],
  request: string,
): Promise<AddState> {
  const submittedAt = Date.now();
  const session = await signedInClient();
  if ("error" in session) return { submittedAt, error: session.error };
  if (!Array.isArray(items) || items.length === 0) return { submittedAt, error: "Tick at least one company to add." };
  if (items.length > FIND_MAX_ADD) return { submittedAt, error: `Add at most ${FIND_MAX_ADD} at a time.` };
  const candidates: Candidate[] = [];
  const rejected: RowOutcome[] = [];
  const evidence = new Map<string, FindConnection[]>();
  for (const item of items) {
    const name = typeof item?.name === "string" ? item.name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX_LENGTH) : "";
    const normalized = normalizeCompanyUrl(typeof item?.url === "string" ? item.url : "");
    if (!normalized.ok) {
      rejected.push({ label: name || "(no name)", status: "skipped", message: normalized.error });
      continue;
    }
    const connections = readConnections(item?.connections);
    evidence.set(normalized.domain, connections);
    candidates.push({
      label: name || normalized.domain,
      name: name || normalized.domain,
      url: normalized.url,
      domain: normalized.domain,
      locations: connections
        .filter((c) => c.kind === "office")
        .map((c) => ({ value: c.value, quote: c.quote, source_url: c.source_url, kind: "office", from: "find" })),
    });
  }
  const source = `find:${String(request ?? "").trim().replace(/\s+/g, " ").slice(0, FILENAME_MAX_LENGTH)}`;
  const result = await save(session.supabase, candidates, rejected, source, submittedAt);

  // A founder's school or hometown from Find becomes a person fact with its
  // sentence and page ("stated", as founder research saves it), so the score
  // counts it right away and lookups keep it.
  const problems: string[] = [];
  const scoreNow: string[] = [];
  for (const company of result.added ?? []) {
    const found = evidence.get(company.domain ?? "") ?? [];
    if (found.length === 0) continue;
    scoreNow.push(company.id);
    const byPerson = new Map<string, Record<string, unknown>>();
    for (const c of found) {
      if (c.kind === "office" || !c.person) continue;
      // One row per person, whatever the capitalization ("Jane Doe", "jane doe").
      const key = c.person.trim().toLowerCase();
      const row = byPerson.get(key) ?? { company_id: company.id, name: c.person, source_url: c.source_url, source_quote: c.quote };
      const evidenceRow = [{ value: c.value, quote: c.quote, url: c.source_url, single: true }];
      if (c.kind === "school" && !row.school) {
        Object.assign(row, { school: c.value, school_source_url: c.source_url, school_quote: c.quote, school_status: "stated", school_evidence: evidenceRow });
      }
      if (c.kind === "hometown" && !row.hometown) {
        Object.assign(row, { hometown: c.value, hometown_source_url: c.source_url, hometown_quote: c.quote, hometown_status: "stated", hometown_evidence: evidenceRow });
      }
      byPerson.set(key, row);
    }
    if (byPerson.size > 0) {
      const { error } = await session.supabase.from("contacts").insert([...byPerson.values()]);
      if (error) problems.push(`Added ${company.name}, but couldn't save the people Find quoted (${error.message}).`);
    }
  }
  for (const id of scoreNow) {
    const scored = await rescore(session.supabase, id);
    if (scored.error) problems.push(`A score couldn't be updated. ${scored.error}`);
  }
  if (problems.length > 0) return { ...result, error: [result.error, ...problems].filter(Boolean).join(" ") };
  return result;
}

// Find's connections come back from the browser, so each is checked again
// for shape: a known kind, a sentence that names the value (and the person),
// and a web page as its source. The quote isn't fetched again: a forged one
// can only change the user's own rows (RLS), like typing a person by hand.
function readConnections(raw: unknown): FindConnection[] {
  const out: FindConnection[] = [];
  for (const c of Array.isArray(raw) ? raw.slice(0, 10) : []) {
    if (typeof c !== "object" || c === null) continue;
    const { kind, value, person, quote, source_url } = c as Record<string, unknown>;
    if (kind !== "school" && kind !== "hometown" && kind !== "office") continue;
    if (typeof value !== "string" || typeof quote !== "string" || typeof source_url !== "string") continue;
    const v = value.trim().slice(0, 120);
    const q = quote.trim().slice(0, 1000);
    const source = httpUrl(source_url);
    const who = kind === "office" ? null : typeof person === "string" ? person.trim().slice(0, 120) : "";
    if (!v || !q || !source || !containsWords(normalize(q), v)) continue;
    if (kind !== "office" && (!who || !mentionsPerson(q, who))) continue;
    out.push({ kind, value: v, person: who, quote: q, source_url: source });
  }
  return out;
}

function httpUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && u.href.length <= 2000 ? u.href : undefined;
  } catch {
    return undefined;
  }
}
