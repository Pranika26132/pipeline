import type { NextRequest } from "next/server";

import { API_KEY_MESSAGE, isWellFormedApiKey, redactSecrets } from "@/lib/redact";
import { rescore } from "@/lib/rescore";
import { judgeRoles, loadFitProfile } from "@/lib/role-fit-run";
import { createClient } from "@/lib/supabase/server";

// One short model call, no web search.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FitResponse = { ok: true; fits: number; roles: number } | { ok: false; error: string };

function fail(status: number, error: string) {
  const safe = redactSecrets(error, [process.env.ANTHROPIC_API_KEY]);
  return Response.json({ ok: false, error: safe } satisfies FitResponse, { status });
}

// Checks which of a company's open roles fit the profile, saves the
// verdicts and re-scores the company.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/companies/[id]/fit">) {
  // Only our own pages may trigger this: each check costs money.
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

  // RLS returns nothing for another user's company or profile.
  const [companyResult, profileResult] = await Promise.all([
    supabase.from("companies").select("open_roles, facts_version").eq("id", id).maybeSingle(),
    loadFitProfile(supabase),
  ]);
  if (companyResult.error) return fail(500, `Couldn't load the company (${companyResult.error.message}).`);
  if (!companyResult.data) return fail(404, "That company isn't in your list.");
  if ("error" in profileResult) return fail(500, profileResult.error);

  const judged = await judgeRoles(apiKey, companyResult.data.open_roles, profileResult.profile, 40_000);
  if ("error" in judged) return fail(judged.status, judged.error);

  // Saved only if the roles weren't changed by a lookup meanwhile; the new
  // facts_version makes any score computed from the old verdicts stale.
  const version = companyResult.data.facts_version;
  const saved = await supabase
    .from("companies")
    .update({ role_fit: judged.record, facts_version: version + 1 })
    .eq("id", id)
    .eq("facts_version", version)
    .select("id");
  if (saved.error) return fail(500, `Couldn't save the role fit (${saved.error.message}).`);
  if (saved.data.length === 0) return fail(409, "The company changed while its roles were being checked. Check fit again.");

  const scored = await rescore(supabase, id);
  if (scored.error) return fail(500, `Saved the role fit, but the score couldn't be updated. ${scored.error}`);

  return Response.json({
    ok: true,
    fits: judged.record.roles.filter((r) => r.verdict === "fits").length,
    roles: judged.record.roles.length,
  } satisfies FitResponse);
}
