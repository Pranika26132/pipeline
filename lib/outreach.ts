import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Saves the current draft on the company's newest outreach row while it's
// still "to contact" or "drafted" (it becomes "drafted"). Once an email was
// sent (or later), a new draft is a new row, so what was sent is kept.
// Nothing is ever sent.
export async function saveDraft(
  supabase: Supabase,
  companyId: string,
  draft: { subject: string; body: string; contactId: string | null },
): Promise<{ error?: string }> {
  const { data: latest, error: readError } = await supabase
    .from("outreach")
    .select("id, status")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) return { error: `Couldn't load the saved draft (${readError.message}).` };

  const fields = {
    subject: draft.subject,
    draft: draft.body,
    contact_id: draft.contactId,
    updated_at: new Date().toISOString(),
  };
  // RLS and the outreach policies only allow the user's own company, and a
  // contact from that same company.
  const open = latest && (latest.status === "to_contact" || latest.status === "drafted");
  const { error } = open
    ? await supabase.from("outreach").update({ ...fields, status: "drafted" }).eq("id", latest.id)
    : await supabase.from("outreach").insert({ ...fields, company_id: companyId, status: "drafted" });
  if (error) return { error: `Couldn't save the draft (${error.message}).` };
  return {};
}
