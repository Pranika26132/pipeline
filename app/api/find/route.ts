import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

import { describeModelError } from "@/lib/enrich/errors";
import { BadModelOutputError } from "@/lib/enrich/extract";
import {
  checkCandidates,
  FIND_REQUEST_MAX,
  searchCandidates,
  verifyCompanies,
  type FindProfile,
  type FoundCompany,
} from "@/lib/find";
import { API_KEY_MESSAGE, isWellFormedApiKey, redactSecrets } from "@/lib/redact";
import { createClient } from "@/lib/supabase/server";

// Up to 10 web searches (about 60 s), home page reads (up to ~16 s), then one
// short model call.
export const maxDuration = 120;

const PAGE = 1000;

export type FindResponse =
  | { ok: true; companies: FoundCompany[]; searches: number; leftOut: string[]; notes: string[] }
  | { ok: false; error: string };

function fail(status: number, error: string) {
  const safe = redactSecrets(error, [process.env.ANTHROPIC_API_KEY]);
  return Response.json({ ok: false, error: safe } satisfies FindResponse, { status });
}

// Finds companies matching a plain-English request and the profile. Nothing
// is added here; the user picks from the results.
export async function POST(req: NextRequest) {
  // Only our own pages may trigger this: each run costs money.
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

  const body = (await req.json().catch(() => null)) as { request?: unknown } | null;
  const request = typeof body?.request === "string" ? body.request.trim().replace(/\s+/g, " ") : "";
  if (request.length < 3) return fail(400, "Type what kind of companies to find, like “early-stage quant firms in NYC hiring interns”.");
  if (request.length > FIND_REQUEST_MAX) return fail(400, `Keep the request under ${FIND_REQUEST_MAX} characters.`);

  // One Find at a time per user, claimed in the database so two tabs can't
  // both start one. A claim older than 3 minutes has expired.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_find_slot");
  if (claimError) return fail(500, `Couldn't start the search (${claimError.message}).`);
  if (!claimed) return fail(429, "A Find is already running for you, maybe in another tab. Wait for it to finish, then try again.");

  try {
    return await find(supabase, apiKey, request);
  } finally {
    // Frees the slot; if this fails, the claim simply expires after 3 minutes.
    await supabase.from("find_locks").update({ started_at: null }).eq("user_id", auth.claims.sub);
  }
}

async function find(supabase: Awaited<ReturnType<typeof createClient>>, apiKey: string, request: string) {
  // RLS returns only the user's own profile and companies.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("school, hometown, interests, role_targets, major, grad_year")
    .maybeSingle();
  if (profileError) return fail(500, `Couldn't load your profile (${profileError.message}).`);
  const existing = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("companies").select("domain").order("id").range(from, from + PAGE - 1);
    if (error) return fail(500, `Couldn't load your list to skip companies already in it (${error.message}).`);
    data.forEach((r) => existing.add(r.domain));
    if (data.length < PAGE) break;
  }

  try {
    const searched = await searchCandidates(apiKey, request, profile as FindProfile | null, 60_000);
    const { checked, leftOut } = await checkCandidates(searched.candidates, searched.resultUrls, existing);
    const verified = await verifyCompanies(apiKey, request, profile as FindProfile | null, checked, 25_000);
    return Response.json({
      ok: true,
      companies: verified.companies,
      searches: searched.searches,
      leftOut: [...leftOut, ...verified.leftOut].map((t) => redactSecrets(t, [apiKey])),
      notes: searched.notes,
    } satisfies FindResponse);
  } catch (e) {
    const why =
      e instanceof BadModelOutputError
        ? e.message
        : e instanceof Anthropic.APIError
          ? describeModelError(e)
          : "Something went wrong while searching. Try again.";
    return fail(502, `Couldn't find companies. ${why}`);
  }
}
