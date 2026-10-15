import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

import { BadModelOutputError, extract } from "@/lib/enrich/extract";
import { collectPages } from "@/lib/enrich/pages";
import { createClient } from "@/lib/supabase/server";

// Page fetches (8s each, mostly in parallel) plus one model call.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOLDOWN_MS = 20_000;

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
  if (!origin || !host || new URL(origin).host !== host) {
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
    .select("id, name, url, domain, enriched_at")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return fail(500, `Couldn't load the company (${loadError.message}).`);
  if (!company) return fail(404, "That company isn't in your list.");

  if (company.enriched_at && Date.now() - new Date(company.enriched_at).getTime() < COOLDOWN_MS) {
    return fail(429, "This company was just looked up. Wait a few seconds and try again.");
  }

  const startedAt = new Date().toISOString();
  const mark = await supabase.from("companies").update({ enriched_at: startedAt }).eq("id", id);
  if (mark.error) return fail(500, `Couldn't start the lookup (${mark.error.message}).`);

  const startUrl = company.url ?? `https://${company.domain}/`;
  const { pages, problems } = await collectPages(startUrl, company.domain);

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

  const notes = [...problems];
  if (result.people.length === 0) notes.unshift("No team members were named on the pages that were read.");

  const fieldSources: Record<string, string> = {};
  for (const key of ["summary", "stage", "size"] as const) {
    if (result[key]) fieldSources[key] = result[key].source_url;
  }

  const update = await supabase
    .from("companies")
    .update({
      summary: result.summary?.value ?? null,
      stage: result.stage?.value ?? null,
      size: result.size?.value ?? null,
      field_sources: fieldSources,
      open_roles: result.open_roles,
      needs_manual_info: result.people.length === 0,
      enrich_error: notes.length ? notes.join("\n") : null,
    })
    .eq("id", id);
  if (update.error) return fail(500, `Couldn't save what was found (${update.error.message}).`);

  // Add people not already saved for this company. Existing contacts, which
  // may have user-entered details, are left alone.
  if (result.people.length > 0) {
    const { data: existing, error: contactsError } = await supabase
      .from("contacts")
      .select("name")
      .eq("company_id", id);
    if (contactsError) return fail(500, `Couldn't check saved contacts (${contactsError.message}).`);
    const known = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const fresh = result.people.filter((p) => {
      const key = p.name.toLowerCase();
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
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
      if (insert.error) return fail(500, `Saved the company details but not the people (${insert.error.message}).`);
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
