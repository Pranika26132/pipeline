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

// Up to 10 web searches (about 55 s), home page reads (capped at 20 s), then
// one short model call, all inside one deadline. 120 s needs Vercel's Fluid
// compute (on by default for new projects).
export const maxDuration = 120;
// Leaves room to answer before the platform stops the function.
const BUDGET_MS = 108_000;

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
  // The token stays on the server, so only this request can free the slot.
  const deadline = Date.now() + BUDGET_MS;
  const { data: token, error: claimError } = await supabase.rpc("claim_find_slot");
  if (claimError) return fail(500, `Couldn't start the search (${claimError.message}).`);
  if (!token) {
    return fail(429, "A Find is already running for you (maybe in another tab), or one stopped less than 3 minutes ago. Wait for it to finish, then try again.");
  }

  const response = await find(supabase, apiKey, request, deadline);
  const released = await supabase.rpc("release_find_slot", { claim: token });
  if (released.error || released.data !== true) {
    // Shown with the results: the next Find may be refused for up to 3 minutes.
    const note = `Couldn't free your Find slot${released.error ? ` (${released.error.message})` : ""}, so the next Find may have to wait up to 3 minutes.`;
    const body = (await response.json()) as FindResponse;
    return Response.json(body.ok ? { ...body, notes: [...body.notes, note] } : { ...body, error: `${body.error}\n${note}` }, {
      status: response.status,
    });
  }
  return response;
}

async function find(supabase: Awaited<ReturnType<typeof createClient>>, apiKey: string, request: string, deadline: number) {
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
    const searched = await searchCandidates(apiKey, request, profile as FindProfile | null, Math.min(55_000, deadline - Date.now() - 35_000));
    const { checked, leftOut } = await checkCandidates(searched.candidates, searched.resultUrls, existing, Math.min(20_000, deadline - Date.now() - 15_000));
    const verifyTime = Math.min(25_000, deadline - Date.now());
    if (checked.length > 0 && verifyTime < 8_000) return fail(504, "Couldn't find companies. The search ran out of time. Try a narrower request.");
    const verified = await verifyCompanies(apiKey, request, profile as FindProfile | null, checked, verifyTime);
    return Response.json({
      ok: true,
      companies: verified.companies,
      searches: searched.searches,
      leftOut: [...leftOut, ...verified.leftOut].map((t) => redactSecrets(t, [apiKey])),
      notes: searched.notes,
    } satisfies FindResponse);
  } catch (e) {
    // Fixed messages only, never the raw error text.
    const why = e instanceof BadModelOutputError ? e.message : describeModelError(e);
    return fail(502, `Couldn't find companies. ${why}`);
  }
}
