import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Saves the current draft on the company's newest outreach row while it's
// still "to contact" or "drafted" (it becomes "drafted"). Once an email was
// sent (or later), a new draft is a new row for the follow-up, so what was
// sent is kept; it carries the same status, so the company still reads
// "Sent" (or "Replied", …) until the user changes it. Nothing is ever sent.
export async function saveDraft(
  supabase: Supabase,
  companyId: string,
  draft: { subject: string; body: string; contactId: string | null },
): Promise<{ error?: string }> {
  const { data: latest, error: readError } = await supabase
    .from("outreach")
    .select("id, status, follow_up_on")
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
    : await supabase.from("outreach").insert({
        ...fields,
        company_id: companyId,
        status: latest?.status ?? "drafted",
        follow_up_on: latest?.follow_up_on ?? null,
      });
  if (error) return { error: `Couldn't save the draft (${error.message}).` };
  return {};
}

export const STATUS_VALUES = ["to_contact", "drafted", "sent", "replied", "interview", "rejected", "ghosted"] as const;
export type OutreachStatus = (typeof STATUS_VALUES)[number];

// Sets the company's status and follow-up date on its newest outreach row
// (creating one if there's none). Marking it sent records when.
export async function setStatus(
  supabase: Supabase,
  companyId: string,
  next: { status: OutreachStatus; followUpOn: string | null },
): Promise<{ error?: string }> {
  const { data: latest, error: readError } = await supabase
    .from("outreach")
    .select("id, sent_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) return { error: `Couldn't load the status (${readError.message}).` };
  const now = new Date().toISOString();
  const fields = {
    status: next.status,
    follow_up_on: next.followUpOn,
    updated_at: now,
    ...(next.status === "sent" && !latest?.sent_at ? { sent_at: now } : {}),
  };
  // RLS and the outreach policies only allow the user's own company.
  const { error } = latest
    ? await supabase.from("outreach").update(fields).eq("id", latest.id)
    : await supabase.from("outreach").insert({ ...fields, company_id: companyId });
  if (error) return { error: `Couldn't save the status (${error.message}).` };
  return {};
}
