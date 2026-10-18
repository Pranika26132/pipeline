import { WEIGHTS } from "./profile";
import { scoreCompany, type ScoreInput } from "./scoring";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
const SAVE_CHUNK = 500;
// A save is skipped for a company whose facts or profile changed after they
// were read; trying again reads the newer data.
const ATTEMPTS = 3;

// Without a saved profile, score with SPEC.md's default weights.
const DEFAULT_PROFILE: ScoreInput["profile"] = {
  school: null,
  hometown: null,
  role_targets: [],
  ...(Object.fromEntries(WEIGHTS.map((w) => [w.key, w.points[w.fallback]])) as Record<
    (typeof WEIGHTS)[number]["key"],
    number
  >),
};

// Recomputes and saves the signed-in user's scores: one company after a
// lookup, or all of them after a profile change. RLS limits every read and
// write to the user's own rows. Returns a message for the user on failure.
export async function rescore(supabase: Supabase, companyId?: string): Promise<{ error?: string }> {
  for (let attempt = 1; ; attempt++) {
    const result = await rescoreOnce(supabase, companyId);
    if ("error" in result) return result;
    if (result.skipped === 0) return {};
    if (attempt === ATTEMPTS) {
      return { error: `Scores for ${result.skipped} companies kept changing while being saved. Reload to try again.` };
    }
  }
}

async function rescoreOnce(supabase: Supabase, companyId?: string): Promise<{ error: string } | { skipped: number }> {
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("school, hometown, role_targets, degree, major, grad_year, resume, weight_school, weight_hometown, weight_open_role, weight_early_stage, updated_at")
    .maybeSingle();
  if (profileError) return { error: `Couldn't load your profile (${profileError.message}).` };
  const profile: ScoreInput["profile"] = profileRow ?? DEFAULT_PROFILE;
  const profileVersion = profileRow?.updated_at ?? null;

  const companies = await readAll<ScoreRow>((from, to) => {
    let q = supabase
      .from("companies")
      .select("id, enriched_at, facts_version, stage, size, open_roles, field_sources, connection, connection_source_url, role_fit")
      .order("id");
    if (companyId) q = q.eq("id", companyId);
    return q.range(from, to);
  });
  if ("error" in companies) return { error: `Couldn't load your companies (${companies.error}).` };

  const contacts = await readAll<ScoreInput["contacts"][number] & { company_id: string }>((from, to) => {
    let q = supabase
      .from("contacts")
      .select(
        "company_id, name, title, school, hometown, source_url, school_source_url, hometown_source_url, added_by_user, school_status, hometown_status",
      )
      .order("id");
    if (companyId) q = q.eq("company_id", companyId);
    return q.range(from, to);
  });
  if ("error" in contacts) return { error: `Couldn't load contacts (${contacts.error}).` };

  const byCompany = new Map<string, ScoreInput["contacts"]>();
  for (const c of contacts.rows) {
    const list = byCompany.get(c.company_id) ?? [];
    list.push(c);
    byCompany.set(c.company_id, list);
  }

  // Each score carries the versions it was computed from; the database only
  // writes it if both are still current. A company never looked up has
  // nothing to score yet.
  const scores = companies.rows.map((company) => {
    const versions = { id: company.id, facts_version: company.facts_version, profile_version: profileVersion };
    if (!company.enriched_at) return { ...versions, score: null, reasons: [] };
    const { score, reasons } = scoreCompany({ company, contacts: byCompany.get(company.id) ?? [], profile });
    return { ...versions, score, reasons };
  });

  let saved = 0;
  for (let i = 0; i < scores.length; i += SAVE_CHUNK) {
    const { data, error } = await supabase.rpc("set_company_scores", { scores: scores.slice(i, i + SAVE_CHUNK) });
    if (error) return { error: `Couldn't save scores (${error.message}).` };
    saved += typeof data === "number" ? data : 0;
  }
  // Rows deleted meanwhile also count as skipped; the retry won't see them.
  return { skipped: scores.length - saved };
}

type ScoreRow = ScoreInput["company"] & { id: string; enriched_at: string | null; facts_version: number };

async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[] } | { error: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { error: error.message };
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return { rows };
  }
}
