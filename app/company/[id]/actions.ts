"use server";

import { revalidatePath } from "next/cache";

import { bumpFactsVersion } from "@/lib/facts";
import { saveDraft, setStatus, STATUS_VALUES, type OutreachStatus } from "@/lib/outreach";
import { rescore } from "@/lib/rescore";
import { createClient } from "@/lib/supabase/server";

export type PersonValues = { name: string; title: string; school: string; hometown: string; source: string; email: string };
export type AddPersonState = { error?: string; added?: string; submittedAt?: number; values?: PersonValues };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 200;
// Plain shape check only; the address is the user's own, never looked up.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Adds a person the user knows about. What they type is their own word, so a
// school or hometown here counts toward the score even without a link.
export async function addPerson(companyId: string, _prev: AddPersonState, formData: FormData): Promise<AddPersonState> {
  const submittedAt = Date.now();
  const text = (k: string) => String(formData.get(k) ?? "").trim().replace(/\s+/g, " ");
  const values: PersonValues = {
    name: text("name"),
    title: text("title"),
    school: text("school"),
    hometown: text("hometown"),
    source: text("source"),
    email: text("email"),
  };
  const fail = (error: string): AddPersonState => ({ submittedAt, values, error });

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return fail(`Your session couldn't be checked (${authError.message}). Sign in again.`);
  if (!auth?.claims) return fail("You're signed out. Sign in again to add people.");
  if (!UUID.test(companyId)) return fail("That company isn't in your list.");

  if (!values.name) return fail("Enter the person's name.");
  for (const [label, v] of [["Name", values.name], ["Title", values.title], ["School", values.school], ["Hometown", values.hometown]] as const) {
    if (v.length > MAX) return fail(`${label} is too long. Keep it under ${MAX} characters.`);
  }
  let source: string | null = null;
  if (values.source) {
    try {
      const u = new URL(values.source);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      source = u.href;
    } catch {
      return fail("The source link must be a full web address starting with https://.");
    }
    if (source.length > 2000) return fail("The source link is too long.");
  }
  if (values.email && (!EMAIL.test(values.email) || values.email.length > 320)) {
    return fail("That email address doesn't look right. Check it, or leave it empty.");
  }

  // RLS (and the contacts insert policy) only allow the user's own company.
  const { error } = await supabase.from("contacts").insert({
    company_id: companyId,
    name: values.name,
    title: values.title || null,
    school: values.school || null,
    hometown: values.hometown || null,
    email: values.email || null,
    source_url: source,
    school_source_url: values.school ? source : null,
    hometown_source_url: values.hometown ? source : null,
    added_by_user: true,
  });
  if (error) {
    if (error.code === "23505") return fail(`${values.name} is already saved for this company.`);
    if (error.code === "42501" || error.code === "23503") return fail("That company isn't in your list.");
    return fail(`Couldn't add ${values.name} (${error.message}).`);
  }

  const bumped = await bumpFactsVersion(supabase, companyId);
  const scored = bumped.error ? bumped : await rescore(supabase, companyId);
  revalidatePath("/", "layout");
  if (scored.error) {
    return { submittedAt, added: values.name, error: `Added ${values.name}, but the score couldn't be updated. ${scored.error}` };
  }
  return { submittedAt, added: values.name };
}

export type SaveDraftState = { error?: string; savedAt?: number };

// Saves the user's edits to the draft. The text is theirs; it's only checked
// for length. Nothing is sent.
export async function saveEditedDraft(companyId: string, _prev: SaveDraftState, formData: FormData): Promise<SaveDraftState> {
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const rawContact = String(formData.get("contactId") ?? "");
  const contactId = UUID.test(rawContact) ? rawContact : null;

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return { error: `Your session couldn't be checked (${authError.message}). Sign in again.` };
  if (!auth?.claims) return { error: "You're signed out. Sign in again to save the draft." };
  if (!UUID.test(companyId)) return { error: "That company isn't in your list." };
  if (!body) return { error: "The draft is empty." };
  if (subject.length > 200) return { error: "The subject is too long. Keep it under 200 characters." };
  if (body.length > 5000) return { error: "The draft is too long to save." };

  const saved = await saveDraft(supabase, companyId, { subject, body, contactId });
  if (saved.error) return { error: saved.error };
  revalidatePath("/", "layout");
  return { savedAt: Date.now() };
}

export type RenameState = { error?: string; savedAt?: number };

// Sets the company's name (e.g. "Turbo AI" for one saved as "turbo.ai").
export async function renameCompany(companyId: string, _prev: RenameState, formData: FormData): Promise<RenameState> {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return { error: `Your session couldn't be checked (${authError.message}). Sign in again.` };
  if (!auth?.claims) return { error: "You're signed out. Sign in again to rename the company." };
  if (!UUID.test(companyId)) return { error: "That company isn't in your list." };
  if (!name) return { error: "Enter the company's name." };
  if (name.length > MAX) return { error: `Keep the name under ${MAX} characters.` };
  // RLS limits the update to the user's own company.
  const { data, error } = await supabase.from("companies").update({ name }).eq("id", companyId).select("id");
  if (error) return { error: `Couldn't rename the company (${error.message}).` };
  if (data.length === 0) return { error: "That company isn't in your list." };
  revalidatePath("/", "layout");
  return { savedAt: Date.now() };
}

export type StatusState = { error?: string; savedAt?: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Sets the company's outreach status and follow-up date.
export async function saveStatus(companyId: string, _prev: StatusState, formData: FormData): Promise<StatusState> {
  const status = String(formData.get("status") ?? "");
  const followUp = String(formData.get("followUpOn") ?? "").trim();
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return { error: `Your session couldn't be checked (${authError.message}). Sign in again.` };
  if (!auth?.claims) return { error: "You're signed out. Sign in again to save the status." };
  if (!UUID.test(companyId)) return { error: "That company isn't in your list." };
  if (!(STATUS_VALUES as readonly string[]).includes(status)) return { error: "Pick a status from the list." };
  if (followUp && !isRealDate(followUp)) return { error: "The follow-up date isn't a real date." };
  const saved = await setStatus(supabase, companyId, {
    status: status as OutreachStatus,
    followUpOn: followUp || null,
    followUpSent: formData.get("followUpSent") === "1",
  });
  if (saved.error) return { error: saved.error };
  revalidatePath("/", "layout");
  return { savedAt: Date.now() };
}

// "2026-02-30" isn't a date; neither is year 0. The date must round-trip.
function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2100 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
