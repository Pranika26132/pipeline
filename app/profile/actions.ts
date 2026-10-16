"use server";

import { revalidatePath } from "next/cache";

import { INTERESTS, LIMITS, ROLE_PRESETS, WEIGHTS, type WeightKey } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

// What the user typed, echoed back so the form keeps it after an error.
export type ProfileValues = {
  school: string;
  hometown: string;
  interests: string[];
  roles: string[];
  otherRoles: string;
  samples: string[];
  weights: Record<WeightKey, string>;
};

export type ProfileState = {
  error?: string;
  saved?: boolean;
  // Bumps on every submit so the form remounts with the echoed values.
  submittedAt?: number;
  values?: ProfileValues;
};

export async function saveProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const submittedAt = Date.now();
  const text = (name: string) => String(formData.get(name) ?? "");
  const values: ProfileValues = {
    school: text("school"),
    hometown: text("hometown"),
    interests: formData.getAll("interests").map(String),
    roles: formData.getAll("roles").map(String),
    otherRoles: text("otherRoles"),
    samples: Array.from({ length: LIMITS.samples }, (_, i) => text(`sample${i}`)),
    weights: Object.fromEntries(WEIGHTS.map((w) => [w.key, text(w.key)])) as Record<WeightKey, string>,
  };
  const fail = (error: string): ProfileState => ({ submittedAt, values, error });

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError) return fail(`Your session couldn't be checked (${authError.message}). Sign in again.`);
  if (!auth?.claims) return fail("You're signed out. Sign in again to save your profile.");

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
    const raw = values.weights[w.key].trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n > LIMITS.weightMax) {
      return fail(`Points for "${w.label}" must be a whole number from 0 to ${LIMITS.weightMax}.`);
    }
    weights[w.key] = n;
  }

  // RLS limits this to the signed-in user's own row.
  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: auth.claims.sub,
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

  revalidatePath("/");
  revalidatePath("/profile");
  return { submittedAt, saved: true, values };
}
