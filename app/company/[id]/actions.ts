"use server";

import { revalidatePath } from "next/cache";

import { bumpFactsVersion } from "@/lib/facts";
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
