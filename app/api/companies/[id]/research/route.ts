import type { NextRequest } from "next/server";

import { describeModelError } from "@/lib/enrich/errors";
import { MAX_PEOPLE, research, type ResearchPerson } from "@/lib/enrich/research";
import { bumpFactsVersion } from "@/lib/facts";
import { API_KEY_MESSAGE, isWellFormedApiKey, redactSecrets } from "@/lib/redact";
import { rescore } from "@/lib/rescore";
import { createClient } from "@/lib/supabase/server";

// Up to 3 web searches plus one short model call; separate from the lookup
// so each stays under the function time limit.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOLDOWN_MS = maxDuration * 1000;

export type ResearchResponse =
  | {
      ok: true;
      // Asked to research only a never-researched company, and it had been.
      skipped?: boolean;
      // People looked into, facts found, searches used.
      people: number;
      found: string[];
      searches: number;
      notes: string[];
    }
  | { ok: false; error: string };

function safe(text: string) {
  return redactSecrets(text, [process.env.ANTHROPIC_API_KEY]);
}

function fail(status: number, error: string) {
  return Response.json({ ok: false, error: safe(error) } satisfies ResearchResponse, { status });
}

function done(body: Omit<Extract<ResearchResponse, { ok: true }>, "ok">) {
  return Response.json({ ok: true, ...body, found: body.found.map(safe), notes: body.notes.map(safe) } satisfies ResearchResponse);
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/companies/[id]/research">) {
  // Only our own pages may trigger this: each run costs money.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    // "null" or a malformed Origin header; rejected below.
  }
  if (!originHost || !host || originHost !== host) {
    return fail(403, "This request didn't come from Pipeline.");
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return fail(401, `Your session couldn't be checked (${authError.message}). Sign in again.`);
  if (!auth?.claims) return fail(401, "You're signed out. Sign in again.");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!isWellFormedApiKey(apiKey)) return fail(500, API_KEY_MESSAGE);

  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "That company isn't in your list.");
  const options = (await req.json().catch(() => null)) as { onlyNew?: unknown } | null;
  const onlyNew = options?.onlyNew === true;

  // RLS returns nothing for another user's company or its contacts.
  const { data: company, error: loadError } = await supabase
    .from("companies")
    .select("id, name, domain")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return fail(500, `Couldn't load the company (${loadError.message}).`);
  if (!company) return fail(404, "That company isn't in your list.");

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id, name, title, school, hometown")
    .eq("company_id", id)
    .order("name");
  if (contactsError) return fail(500, `Couldn't load the people (${contactsError.message}).`);

  // Only people missing a school or hometown; founders and leaders first.
  const people: ResearchPerson[] = contacts
    .filter((c) => !c.school || !c.hometown)
    .sort((a, b) => leaderRank(a.title) - leaderRank(b.title))
    .map((c) => ({ key: c.id, name: c.name, title: c.title, needSchool: !c.school, needHometown: !c.hometown }));
  if (people.length === 0) {
    const why = contacts.length === 0 ? "No people are saved for this company yet." : "Everyone saved already has a school and hometown.";
    return done({ people: 0, found: [], searches: 0, notes: [why] });
  }

  // Claims the run in one conditional update, so two taps can't both search.
  const now = Date.now();
  const claim = supabase.from("companies").update({ researched_at: new Date(now).toISOString() }).eq("id", id);
  const { data: claimed, error: claimError } = await (onlyNew
    ? claim.is("researched_at", null)
    : claim.or(`researched_at.is.null,researched_at.lt.${new Date(now - COOLDOWN_MS).toISOString()}`)
  ).select("id");
  if (claimError) return fail(500, `Couldn't start the research (${claimError.message}).`);
  if (claimed.length === 0) {
    if (onlyNew) return done({ skipped: true, people: 0, found: [], searches: 0, notes: [] });
    return fail(429, "These people were researched less than a minute ago. Wait a minute, then try again.");
  }

  let result;
  try {
    result = await research(apiKey, company, people);
  } catch (e) {
    return fail(502, `Founder research failed. ${describeModelError(e)}`);
  }

  // Fill only empty fields, so nothing a lookup or the user saved is replaced.
  const found: string[] = [];
  for (const f of result.findings) {
    const person = contacts.find((c) => c.id === f.key)!;
    for (const kind of ["school", "hometown"] as const) {
      const fact = f[kind];
      if (!fact) continue;
      const { data: updated, error } = await supabase
        .from("contacts")
        .update({ [kind]: fact.value, [`${kind}_source_url`]: fact.url, [`${kind}_quote`]: fact.quote })
        .eq("id", f.key)
        .is(kind, null)
        .select("id");
      if (error) return fail(500, `Couldn't save what was found for ${person.name} (${error.message}).`);
      if (updated.length > 0) found.push(`${person.name}: ${kind === "school" ? "went to" : "is from"} ${fact.value}`);
    }
  }

  const notes = [...result.notes];
  if (found.length === 0) notes.push("No page found by the search stated a school or hometown for these people.");

  if (found.length > 0) {
    const bumped = await bumpFactsVersion(supabase, id);
    if (bumped.error) return fail(500, `Saved what was found, but the score couldn't be updated. ${bumped.error}`);
    const scored = await rescore(supabase, id);
    if (scored.error) return fail(500, `Saved what was found, but the score couldn't be updated. ${scored.error}`);
  }

  return done({ people: Math.min(people.length, MAX_PEOPLE), found, searches: result.searches, notes });
}

function leaderRank(title: string | null) {
  if (!title) return 2;
  if (/\b(founder|co-?founder)\b/i.test(title)) return 0;
  if (/\b(ceo|cto|coo|chief|president|head)\b/i.test(title)) return 1;
  return 2;
}
