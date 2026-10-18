import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Marks a company's scoring facts as changed (people added or researched),
// so a score computed from the old facts is refused by set_company_scores.
// Compare-and-set, retried once if another write bumped it first.
export async function bumpFactsVersion(supabase: Supabase, companyId: string): Promise<{ error?: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.from("companies").select("facts_version").eq("id", companyId).maybeSingle();
    if (error) return { error: `Couldn't update the company (${error.message}).` };
    if (!data) return { error: "That company isn't in your list." };
    const bumped = await supabase
      .from("companies")
      .update({ facts_version: data.facts_version + 1 })
      .eq("id", companyId)
      .eq("facts_version", data.facts_version)
      .select("id");
    if (bumped.error) return { error: `Couldn't update the company (${bumped.error.message}).` };
    if (bumped.data.length > 0) return {};
  }
  return { error: "The company changed while saving. Reload and try again." };
}
