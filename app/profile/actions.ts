"use server";

import { revalidatePath } from "next/cache";

import {
  INTERESTS,
  isLevel,
  LIMITS,
  readProfileForm,
  ROLE_PRESETS,
  WEIGHTS,
  type ProfileValues,
  type WeightKey,
} from "@/lib/profile";
import { rescore } from "@/lib/rescore";
import { createClient } from "@/lib/supabase/server";

export type ProfileState = {
  error?: string;
  saved?: boolean;
  // Bumps on every submit so the form remounts with `values`: what was typed
  // after an error, what was stored after a save.
  submittedAt?: number;
  values?: ProfileValues;
};

export async function saveProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const submittedAt = Date.now();
  const values = readProfileForm(formData);
  const fail = (error: string): ProfileState => ({ submittedAt, values, error });

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return fail(`Your session couldn't be checked (${authError.message}). Sign in again.`);
  if (!auth?.claims) return fail("You're signed out. Sign in again to save your profile.");

  const fullName = values.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length > 100) return fail("Keep your name under 100 characters.");
  const school = values.school.trim();
  const hometown = values.hometown.trim();
  if (school.length > LIMITS.text) return fail(`Keep your school under ${LIMITS.text} characters.`);
  if (hometown.length > LIMITS.text) return fail(`Keep your hometown or region under ${LIMITS.text} characters.`);

  const allowedInterests = new Set<string>(INTERESTS.map((i) => i.value));
  const interests = INTERESTS.map((i) => i.value).filter((v) => values.interests.includes(v));
  if (values.interests.some((v) => !allowedInterests.has(v))) return fail("Pick interests from the list.");

  // Presets first, then the user's own, without repeats (case-insensitive).
  const presets = new Set<string>(ROLE_PRESETS);
  if (values.roles.some((r) => !presets.has(r))) return fail("Pick roles from the list, or add them under Other roles.");
  if (values.otherRoles.length > LIMITS.otherRoles) return fail("Other roles is too long. List at most 20 roles.");
  const roleTargets: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...values.roles, ...values.otherRoles.split(/[,\n]/)]) {
    const role = raw.trim().replace(/\s+/g, " ");
    if (!role || seen.has(role.toLowerCase())) continue;
    if (role.length > LIMITS.role) return fail(`Keep each role under ${LIMITS.role} characters: "${role.slice(0, 40)}…"`);
    seen.add(role.toLowerCase());
    roleTargets.push(role);
  }
  if (roleTargets.length > LIMITS.roles) return fail(`Pick at most ${LIMITS.roles} roles.`);

  const samples = values.samples.map((s) => s.trim()).filter(Boolean);
  const long = values.samples.findIndex((s) => s.trim().length > LIMITS.sample);
  if (long !== -1) {
    return fail(`Writing sample ${long + 1} is ${values.samples[long].trim().length} characters. Keep each under ${LIMITS.sample}.`);
  }

  const weights = {} as Record<WeightKey, number>;
  for (const w of WEIGHTS) {
    const level = values.weights[w.key];
    if (!isLevel(level)) return fail(`Choose how much "${w.label}" matters.`);
    weights[w.key] = w.points[level];
  }

  // RLS limits this to the signed-in user's own row.
  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: auth.claims.sub,
      full_name: fullName || null,
      school: school || null,
      hometown: hometown || null,
      interests,
      role_targets: roleTargets,
      writing_samples: samples,
      ...weights,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return fail(`Couldn't save your profile (${error.message}). Nothing was changed.`);

  // School, hometown, roles and weights all change scores.
  const scored = await rescore(supabase);
  revalidatePath("/", "layout");
  const scoreError = scored.error && `Profile saved, but your list couldn't be re-ranked. ${scored.error} Save again to retry.`;
  // Show what was stored: trimmed, without repeats, samples moved up.
  const presetRoles = roleTargets.filter((r) => presets.has(r));
  return {
    submittedAt,
    saved: true,
    error: scoreError,
    values: {
      fullName,
      school,
      hometown,
      interests,
      roles: presetRoles,
      otherRoles: roleTargets.filter((r) => !presets.has(r)).join(", "),
      samples: Array.from({ length: LIMITS.samples }, (_, i) => samples[i] ?? ""),
      weights: values.weights,
    },
  };
}
