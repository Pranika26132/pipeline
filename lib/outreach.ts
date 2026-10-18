import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const STATUS_VALUES = ["to_contact", "drafted", "sent", "replied", "interview", "rejected", "ghosted"] as const;
export type OutreachStatus = (typeof STATUS_VALUES)[number];

// Statuses before anything was sent.
const UNSENT = new Set<string>(["to_contact", "drafted"]);

async function newestRow(supabase: Supabase, companyId: string) {
  return supabase
    .from("outreach")
    .select("id, status, follow_up_on, sent_at, is_follow_up")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

// Saves the current draft on the company's newest outreach row while
// nothing has been sent from it: it's "to contact" or "drafted" (and becomes
// "drafted"), or it's a follow-up draft not yet sent. Once an email was sent
// (or later), a new draft starts a follow-up row, so what was sent is kept;
// it carries the same status, follow-up date and send date, so the company
// still reads "Sent" (or "Replied", …). Nothing is ever sent.
export async function saveDraft(
  supabase: Supabase,
  companyId: string,
  draft: { subject: string; body: string; contactId: string | null },
): Promise<{ error?: string }> {
  const { data: latest, error: readError } = await newestRow(supabase, companyId);
  if (readError) return { error: `Couldn't load the saved draft (${readError.message}).` };

  const fields = {
    subject: draft.subject,
    draft: draft.body,
    contact_id: draft.contactId,
    updated_at: new Date().toISOString(),
  };
  // RLS and the outreach policies only allow the user's own company, and a
  // contact from that same company.
  let result;
  if (latest && UNSENT.has(latest.status)) {
    result = await supabase.from("outreach").update({ ...fields, status: "drafted" }).eq("id", latest.id);
  } else if (latest?.is_follow_up) {
    result = await supabase.from("outreach").update(fields).eq("id", latest.id);
  } else {
    result = await supabase.from("outreach").insert({
      ...fields,
      company_id: companyId,
      status: latest?.status ?? "drafted",
      follow_up_on: latest?.follow_up_on ?? null,
      sent_at: latest?.sent_at ?? null,
      is_follow_up: !!latest,
    });
  }
  if (result.error) return { error: `Couldn't save the draft (${result.error.message}).` };
  return {};
}

// Sets the company's status and follow-up date on its newest outreach row
// (creating one if there's none). The send date is recorded when the status
// changes to sent, and cleared when it goes back to before sending.
// `followUpSent`: the user marked the follow-up draft on this row as sent.
export async function setStatus(
  supabase: Supabase,
  companyId: string,
  next: { status: OutreachStatus; followUpOn: string | null; followUpSent?: boolean },
): Promise<{ error?: string }> {
  const { data: latest, error: readError } = await newestRow(supabase, companyId);
  if (readError) return { error: `Couldn't load the status (${readError.message}).` };
  const now = new Date().toISOString();
  const becameSent = next.status === "sent" && latest?.status !== "sent";
  const fields = {
    status: next.status,
    follow_up_on: next.followUpOn,
    updated_at: now,
    ...(becameSent || (next.followUpSent && latest?.is_follow_up) ? { sent_at: now, is_follow_up: false } : {}),
    ...(UNSENT.has(next.status) ? { sent_at: null, is_follow_up: false } : {}),
  };
  // RLS and the outreach policies only allow the user's own company.
  const { error } = latest
    ? await supabase.from("outreach").update(fields).eq("id", latest.id)
    : await supabase.from("outreach").insert({ ...fields, company_id: companyId });
  if (error) return { error: `Couldn't save the status (${error.message}).` };
  return {};
}
