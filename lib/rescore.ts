import { WEIGHTS } from "./profile";
import { scoreCompany, type ScoreInput } from "./scoring";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const PAGE = 1000;
const SAVE_CHUNK = 500;

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
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("school, hometown, role_targets, weight_school, weight_hometown, weight_open_role, weight_early_stage")
    .maybeSingle();
  if (profileError) return { error: `Couldn't load your profile (${profileError.message}).` };
  const profile: ScoreInput["profile"] = profileRow ?? DEFAULT_PROFILE;

  const companies = await readAll<ScoreRow>((from, to) => {
    let q = supabase.from("companies").select("id, enriched_at, stage, size, open_roles, field_sources").order("id");
    if (companyId) q = q.eq("id", companyId);
    return q.range(from, to);
  });
  if ("error" in companies) return { error: `Couldn't load your companies (${companies.error}).` };

  const contacts = await readAll<ScoreInput["contacts"][number] & { company_id: string }>((from, to) => {
    let q = supabase.from("contacts").select("company_id, name, title, school, hometown, source_url").order("id");
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

  // A company that was never looked up has nothing to score yet.
  const scores = companies.rows.map((company) => {
    if (!company.enriched_at) return { id: company.id, score: null, reasons: [] };
    const { score, reasons } = scoreCompany({ company, contacts: byCompany.get(company.id) ?? [], profile });
    return { id: company.id, score, reasons };
  });

  for (let i = 0; i < scores.length; i += SAVE_CHUNK) {
    const { error } = await supabase.rpc("set_company_scores", { scores: scores.slice(i, i + SAVE_CHUNK) });
    if (error) return { error: `Couldn't save scores (${error.message}).` };
  }
  return {};
}

type ScoreRow = ScoreInput["company"] & { id: string; enriched_at: string | null };

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
