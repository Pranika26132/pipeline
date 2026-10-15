import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

import { BadModelOutputError, extract } from "@/lib/enrich/extract";
import { collectPages } from "@/lib/enrich/pages";
import { createClient } from "@/lib/supabase/server";

// Page fetches (8s each, mostly in parallel) plus one model call.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// As long as a whole run, so a second click can't start an overlapping one.
const COOLDOWN_MS = maxDuration * 1000;

export type EnrichResponse =
  | { ok: true; people: number; roles: number; notes: string[] }
  | { ok: false; error: string };

function fail(status: number, error: string) {
  return Response.json({ ok: false, error } satisfies EnrichResponse, { status });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/companies/[id]/enrich">) {
  // Only our own pages may trigger this: each run costs money and fetches the web.
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(500, "ANTHROPIC_API_KEY isn't set on the server, so companies can't be looked up.");
  }

  const { id } = await ctx.params;
  if (!UUID.test(id)) return fail(404, "That company isn't in your list.");

  // RLS returns nothing for another user's company.
  const { data: company, error: loadError } = await supabase
    .from("companies")
    .select("id, name, url, domain, summary, stage, size, field_sources, open_roles")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return fail(500, `Couldn't load the company (${loadError.message}).`);
  if (!company) return fail(404, "That company isn't in your list.");

  // Claims the run in one conditional update, so two quick clicks can't both start.
  const now = Date.now();
  const cutoff = new Date(now - COOLDOWN_MS).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("companies")
    .update({ enriched_at: new Date(now).toISOString() })
    .eq("id", id)
    .or(`enriched_at.is.null,enriched_at.lt.${cutoff}`)
    .select("id");
  if (claimError) return fail(500, `Couldn't start the lookup (${claimError.message}).`);
  if (claimed.length === 0) {
    return fail(429, "This company was looked up less than a minute ago. Wait a minute, then try again.");
  }

  const startUrl = company.url ?? `https://${company.domain}/`;
  let collected;
  try {
    collected = await collectPages(startUrl, company.domain);
  } catch (e) {
    collected = { pages: [], problems: [`Couldn't read the site: ${(e as Error).message}`] };
  }
  const { pages, problems } = collected;

  // Nothing readable: keep the row, flag it, and say why.
  if (pages.length === 0) {
    const error = ["None of the company's pages could be read.", ...problems].join("\n");
    const saved = await supabase
      .from("companies")
      .update({ needs_manual_info: true, enrich_error: error })
      .eq("id", id);
    if (saved.error) return fail(500, `${error}\nAlso couldn't save this result (${saved.error.message}).`);
    return fail(502, error);
  }

  let result;
  try {
    result = await extract(company.name, pages);
  } catch (e) {
    const error = describeModelError(e);
    // Keep the company row as it was; record the failure so the page shows it.
    const saved = await supabase.from("companies").update({ enrich_error: error }).eq("id", id);
    if (saved.error) return fail(500, `${error}\nAlso couldn't save this result (${saved.error.message}).`);
    return fail(502, error);
  }

  // Add people not already saved for this company. Existing contacts, which
  // may have user-entered details, are left alone.
  const { data: existing, error: contactsError } = await supabase
    .from("contacts")
    .select("name")
    .eq("company_id", id);
  if (contactsError) return fail(500, `Couldn't check saved contacts (${contactsError.message}).`);
  const known = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const fresh = result.people.filter((p) => {
    const key = p.name.trim().toLowerCase();
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });

  const notes = [...problems];
  if (result.people.length === 0) notes.unshift("No team members were named on the pages that were read.");

  // A re-run fills in or updates facts but never blanks one an earlier run
  // found: a page that times out this time shouldn't erase what it said.
  const fieldSources: Record<string, string> = { ...((company.field_sources ?? {}) as Record<string, string>) };
  for (const key of ["summary", "stage", "size"] as const) {
    if (result[key]) fieldSources[key] = result[key].source_url;
  }
  const oldRoles = Array.isArray(company.open_roles) ? company.open_roles : [];

  const update = await supabase
    .from("companies")
    .update({
      summary: result.summary?.value ?? company.summary,
      stage: result.stage?.value ?? company.stage,
      size: result.size?.value ?? company.size,
      field_sources: fieldSources,
      open_roles: result.open_roles.length > 0 ? result.open_roles : oldRoles,
      // Flagged while the company has nobody to write to.
      needs_manual_info: existing.length + fresh.length === 0,
      enrich_error: notes.length ? notes.join("\n") : null,
    })
    .eq("id", id);
  if (update.error) return fail(500, `Couldn't save what was found (${update.error.message}).`);

  if (fresh.length > 0) {
    const insert = await supabase.from("contacts").insert(
      fresh.map((p) => ({
        company_id: id,
        name: p.name,
        title: p.title,
        school: p.school,
        hometown: p.hometown,
        source_url: p.source_url,
      })),
    );
    if (insert.error) {
      const message =
        insert.error.code === "23505"
          ? "Saved the company details, but some of these people were added by another lookup at the same time. Reload to see them."
          : `Saved the company details but not the people (${insert.error.message}).`;
      return fail(500, message);
    }
  }

  return Response.json({
    ok: true,
    people: result.people.length,
    roles: result.open_roles.length,
    notes,
  } satisfies EnrichResponse);
}

function describeModelError(e: unknown): string {
  if (e instanceof BadModelOutputError) return `${e.message} The company was kept as it was; try again.`;
  if (e instanceof Anthropic.AuthenticationError) return "The Claude API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The Claude API key isn't allowed to use this model.";
  if (e instanceof Anthropic.RateLimitError) return "Too many lookups at once. Wait a minute and try again.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The Claude API took too long to answer. Try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Try again.";
  if (e instanceof Anthropic.APIError) return `The Claude API returned an error (${e.status ?? "no status"}): ${e.message}`;
  return `Lookup failed: ${(e as Error).message}`;
}
