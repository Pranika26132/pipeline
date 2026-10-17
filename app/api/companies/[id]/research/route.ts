import type { NextRequest } from "next/server";

import { describeModelError } from "@/lib/enrich/errors";
import { MAX_PEOPLE, research, resolveFact, type Evidence, type ResearchPerson } from "@/lib/enrich/research";
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
      // People looked into, leaders found by search, facts found, searches used.
      people: number;
      leaders: { name: string; title: string; url: string }[];
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

function done(body: Omit<Extract<ResearchResponse, { ok: true }>, "ok" | "leaders"> & { leaders?: Extract<ResearchResponse, { ok: true }>["leaders"] }) {
  return Response.json({
    ok: true,
    ...body,
    leaders: body.leaders ?? [],
    found: body.found.map(safe),
    notes: body.notes.map(safe),
  } satisfies ResearchResponse);
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
    .select("id, name, title, school, hometown, school_status, hometown_status, school_evidence, hometown_evidence, added_by_user")
    .eq("company_id", id)
    .order("name");
  if (contactsError) return fail(500, `Couldn't load the people (${contactsError.message}).`);

  // People missing a school or hometown, or whose earlier research wasn't
  // settled (only a shared sentence, or sources disagreed); founders first.
  // Facts the user typed are never researched over.
  const open = (value: string | null, status: string | null) => !value || status === "shared" || status === "conflicting";
  const people: ResearchPerson[] = contacts
    .filter((c) => !c.added_by_user && (open(c.school, c.school_status) || open(c.hometown, c.hometown_status)))
    .sort((a, b) => leaderRank(a.title) - leaderRank(b.title))
    .map((c) => ({
      key: c.id,
      name: c.name,
      title: c.title,
      needSchool: open(c.school, c.school_status),
      needHometown: open(c.hometown, c.hometown_status),
    }));
  // The company's own pages named no founder or CEO: search for who founded
  // or leads it first (within the same 3-search cap).
  const discover = !contacts.some((c) => c.title && FOUNDER_OR_CEO.test(c.title));
  if (people.length === 0 && !discover) {
    return done({ people: 0, found: [], searches: 0, notes: ["Everyone saved already has a school and hometown."] });
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
    const researched = new Set(people.map((p) => p.key));
    const otherPeople = contacts.filter((c) => !researched.has(c.id)).map((c) => c.name);
    result = await research(apiKey, company, people, discover, otherPeople);
  } catch (e) {
    return fail(502, `Founder research failed. ${describeModelError(e)}`);
  }

  // Rescores after facts change; returns text to add to an error, if any.
  const refreshScore = async () => {
    const bumped = await bumpFactsVersion(supabase, id);
    const scored = bumped.error ? bumped : await rescore(supabase, id);
    return scored.error ? `The score couldn't be updated. ${scored.error}` : "";
  };

  // Save the leaders search found, each with the sentence naming them and its
  // page. A name saved meanwhile (unique per company) is skipped, not an error.
  const keyToId = new Map(people.map((p) => [p.key, p.key]));
  const leaders: { name: string; title: string; url: string }[] = [];
  for (const l of result.leaders) {
    const { data: inserted, error } = await supabase
      .from("contacts")
      .insert({ company_id: id, name: l.name, title: l.title, source_url: l.url, source_quote: l.quote })
      .select("id")
      .maybeSingle();
    if (error?.code === "23505") continue;
    if (error) return fail(500, `Couldn't save ${l.name}, found as ${l.title} (${error.message}).`);
    if (inserted) {
      keyToId.set(l.key, inserted.id);
      leaders.push({ name: l.name, title: l.title, url: l.url });
    }
  }
  if (leaders.length > 0) {
    // Someone to write to now.
    const flagged = await supabase.from("companies").update({ needs_manual_info: false }).eq("id", id);
    if (flagged.error) return fail(500, `Saved the people found, but couldn't update the company (${flagged.error.message}).`);
  }
  const names = new Map([
    ...contacts.map((c) => [c.id, c.name] as const),
    ...result.leaders.map((l) => [l.key, l.name] as const),
  ]);

  // Merge new sentences with those from earlier research, then save one
  // answer per fact with how sure it is. Only empty or unsettled facts are
  // written, so nothing a lookup or the user saved is replaced.
  const found: string[] = [];
  for (const f of result.findings) {
    const contactId = keyToId.get(f.key);
    if (!contactId) continue;
    const saved = contacts.find((c) => c.id === contactId);
    const person = { name: names.get(f.key) ?? "" };
    for (const kind of ["school", "hometown"] as const) {
      if (f[kind].length === 0) continue;
      const earlier = (Array.isArray(saved?.[`${kind}_evidence`]) ? saved[`${kind}_evidence`] : []) as Evidence[];
      const evidence = [...earlier];
      for (const e of f[kind]) {
        if (!evidence.some((x) => x.url === e.url && x.value.toLowerCase() === e.value.toLowerCase())) evidence.push(e);
      }
      const answer = resolveFact(kind, evidence.slice(0, 10));
      if (!answer) continue;
      const { data: updated, error } = await supabase
        .from("contacts")
        .update({
          [kind]: answer.value,
          [`${kind}_status`]: answer.status,
          [`${kind}_source_url`]: answer.url,
          [`${kind}_quote`]: answer.quote,
          [`${kind}_evidence`]: evidence.slice(0, 10),
        })
        .eq("id", contactId)
        .or(`${kind}.is.null,${kind}_status.in.(shared,conflicting)`)
        .select("id");
      if (error) {
        const done = found.length > 0 ? `Saved: ${found.join("; ")}. ${await refreshScore()}` : "";
        return fail(500, `Couldn't save what was found for ${person.name} (${error.message}). ${done}`.trim());
      }
      if (updated.length > 0) found.push(describeAnswer(person.name, kind, answer, evidence));
    }
  }

  const notes = [...result.notes];
  if (discover && leaders.length === 0) {
    notes.push(`No page found by the search named a founder or CEO of ${company.name}.`);
  }
  if (found.length === 0 && (people.length > 0 || leaders.length > 0)) {
    notes.push("No page found by the search stated a school or hometown for these people.");
  }

  if (found.length > 0 || leaders.length > 0) {
    const scoreError = await refreshScore();
    if (scoreError) return fail(500, `Saved what was found (${found.join("; ")}), but ${scoreError.charAt(0).toLowerCase()}${scoreError.slice(1)}`);
  }

  return done({ people: Math.min(people.length, MAX_PEOPLE) + leaders.length, leaders, found, searches: result.searches, notes });
}

function describeAnswer(name: string, kind: "school" | "hometown", answer: { value: string; status: string }, evidence: Evidence[]) {
  const what = kind === "school" ? "went to" : "is from";
  if (answer.status === "stated") return `${name}: ${what} ${answer.value}`;
  if (answer.status === "shared") return `${name}: ${answer.value} (only in a sentence about several people, so not counted)`;
  const values = [...new Set(evidence.map((e) => e.value))].join(" / ");
  return `${name}: sources disagree on ${kind === "school" ? "school" : "hometown"} (${values}), so not counted`;
}

const FOUNDER_OR_CEO = /\b(co-?founder|founder|ceo|chief executive)\b/i;

function leaderRank(title: string | null) {
  if (!title) return 2;
  if (/\b(founder|co-?founder)\b/i.test(title)) return 0;
  if (/\b(ceo|cto|coo|chief|president|head)\b/i.test(title)) return 1;
  return 2;
}
