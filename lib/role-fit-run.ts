import Anthropic from "@anthropic-ai/sdk";

import { describeModelError } from "./enrich/errors";
import { BadModelOutputError } from "./enrich/extract";
import { canCheckFit, checkRoleFit, fitKey, type FitProfile, type FitRole, type RoleFitRecord } from "./fit";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// The profile fields fit is judged against. Null when there's no profile.
export async function loadFitProfile(supabase: Supabase): Promise<{ profile: FitProfile | null } | { error: string }> {
  const { data, error } = await supabase.from("profiles").select("role_targets, degree, major, grad_year, resume").maybeSingle();
  if (error) return { error: `Couldn't load your profile (${error.message}).` };
  return { profile: data };
}

// Judges a company's roles against the profile. Returns the record to save,
// or a message for the user (with fixed text for API errors).
export async function judgeRoles(
  apiKey: string,
  roles: unknown,
  profile: FitProfile | null,
  timeoutMs: number,
): Promise<{ record: RoleFitRecord } | { error: string; status: number }> {
  if (!canCheckFit(profile)) return { status: 422, error: "Add the internship roles you want on your profile first." };
  const list = (Array.isArray(roles) ? roles : []).filter(
    (r): r is FitRole => typeof r?.title === "string" && typeof r?.source_url === "string",
  );
  if (list.length === 0) return { status: 422, error: "There are no open roles to check. Look the company up first." };
  try {
    const now = new Date();
    const fits = await checkRoleFit(apiKey, list, profile, now, timeoutMs);
    return { record: { key: fitKey(profile), checked_at: now.toISOString(), roles: fits } };
  } catch (e) {
    const why =
      e instanceof BadModelOutputError
        ? e.message
        : e instanceof Anthropic.APIError
          ? describeModelError(e)
          : "Something went wrong while checking. Try again.";
    return { status: 502, error: `Role fit wasn't checked. ${why}` };
  }
}
