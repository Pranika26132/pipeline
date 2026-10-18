import type { NextRequest } from "next/server";

import { draftFacts, HOOKS, type Hook } from "@/lib/drafts";
import { writeDraft } from "@/lib/draft-writer";
import { describeModelError } from "@/lib/enrich/errors";
import { BadModelOutputError } from "@/lib/enrich/extract";
import { saveDraft } from "@/lib/outreach";
import { API_KEY_MESSAGE, isWellFormedApiKey, redactSecrets } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";

// One model call (plus at most one retry to fix a failed check).
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DraftResponse =
  | { ok: true; subject: string; body: string; fact: string; toTeam: boolean }
  | { ok: false; error: string };

function fail(status: number, error: string) {
  const safe = redactSecrets(error, [process.env.ANTHROPIC_API_KEY]);
  return Response.json({ ok: false, error: safe } satisfies DraftResponse, { status });
}

// Writes a draft email for a company and saves it. Never sends anything.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/companies/[id]/draft">) {
  // Only our own pages may trigger this: each draft costs money.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    // "null" or a malformed Origin header; rejected below.
  }
  if (!originHost || !host || originHost !== host) return fail(403, "This request didn't come from Pipeline.");

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return fail(401, `Your session couldn't be checked (${authError.message}). Sign in again.`);
  if (!auth?.claims) return fail(401, "You're signed out. Sign in again.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!isWellFormedApiKey(apiKey)) return fail(500, API_KEY_MESSAGE);

  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "That company isn't in your list.");
  const options = ((await req.json().catch(() => null)) ?? {}) as { contactId?: unknown; hook?: unknown };
  const contactId = typeof options.contactId === "string" && UUID.test(options.contactId) ? options.contactId : null;
  const hook: Hook = HOOKS.some((h) => h.value === options.hook) ? (options.hook as Hook) : "auto";

  // RLS returns nothing for another user's company, contact or profile.
  const [companyResult, contactResult, profileResult] = await Promise.all([
    supabase
      .from("companies")
      .select("name, summary, stage, size, open_roles, score_reasons, field_sources")
      .eq("id", id)
      .maybeSingle(),
    contactId
      ? supabase
          .from("contacts")
          .select("id, name, title, school, hometown, school_status, hometown_status")
          .eq("id", contactId)
          .eq("company_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("profiles").select("school, hometown, interests, role_targets, writing_samples").maybeSingle(),
  ]);
  if (companyResult.error) return fail(500, `Couldn't load the company (${companyResult.error.message}).`);
  if (!companyResult.data) return fail(404, "That company isn't in your list.");
  if (contactResult.error) return fail(500, `Couldn't load that person (${contactResult.error.message}).`);
  if (contactId && !contactResult.data) return fail(404, "That person isn't saved for this company.");
  if (profileResult.error) return fail(500, `Couldn't load your profile (${profileResult.error.message}).`);

  const company = companyResult.data;
  const contact = contactResult.data;
  const profile = profileResult.data;
  // A researched school or hometown is only used when it's "stated".
  const counts = (status: string | null) => !status || status === "stated";
  const facts = draftFacts({
    company,
    contact: contact
      ? { ...contact, schoolCounts: counts(contact.school_status), hometownCounts: counts(contact.hometown_status) }
      : null,
    profile,
  });
  if (!facts.some((f) => f.kind === "company")) {
    return fail(422, "There's nothing specific about this company to write from yet. Look it up first.");
  }

  let written;
  try {
    written = await writeDraft(apiKey, {
      company: company.name,
      to: contact?.name ?? null,
      facts,
      hook,
      samples: profile?.writing_samples ?? [],
    });
  } catch (e) {
    // Our own check messages say what was wrong; API errors use fixed text.
    return fail(502, `Couldn't write the draft. ${e instanceof BadModelOutputError ? e.message : describeModelError(e)}`);
  }

  const saved = await saveDraft(supabase, id, { subject: written.subject, body: written.body, contactId: contact?.id ?? null });
  if (saved.error) return fail(500, `Wrote a draft, but ${saved.error.charAt(0).toLowerCase()}${saved.error.slice(1)}`);

  const fact = facts.find((f) => f.id === written.companyFact)?.text ?? "";
  return Response.json({ ok: true, subject: written.subject, body: written.body, fact, toTeam: !contact } satisfies DraftResponse);
}
