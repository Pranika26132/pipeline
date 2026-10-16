// Shared by the /profile form (client) and its server action. No server-only
// imports here.

export const INTERESTS = [
  { value: "tech", label: "Tech" },
  { value: "quant", label: "Quant" },
] as const;

// Common internship tracks; anything else goes in "Other roles".
export const ROLE_PRESETS = [
  "Software engineering",
  "Machine learning",
  "Data science",
  "Quant research",
  "Quant trading",
  "Quant development",
] as const;

export const WEIGHTS = [
  { key: "weight_school", label: "Someone on the team went to my school", fallback: 3 },
  { key: "weight_hometown", label: "Someone on the team is from my hometown or region", fallback: 2 },
  { key: "weight_open_role", label: "They have an open role I'm targeting", fallback: 2 },
  { key: "weight_early_stage", label: "Early stage (under about 50 people)", fallback: 1 },
] as const;

export type WeightKey = (typeof WEIGHTS)[number]["key"];

export const LIMITS = {
  text: 200,
  role: 80,
  roles: 20,
  // The whole "Other roles" field: 20 roles plus separators.
  otherRoles: 20 * 82,
  sample: 3000,
  samples: 3,
  weightMax: 10,
} as const;

// The form's fields as typed, so they can be shown again after an error.
export type ProfileValues = {
  school: string;
  hometown: string;
  interests: string[];
  roles: string[];
  otherRoles: string;
  samples: string[];
  weights: Record<WeightKey, string>;
};

export function readProfileForm(formData: FormData): ProfileValues {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    school: text("school"),
    hometown: text("hometown"),
    interests: formData.getAll("interests").map(String),
    roles: formData.getAll("roles").map(String),
    otherRoles: text("otherRoles"),
    samples: Array.from({ length: LIMITS.samples }, (_, i) => text(`sample${i}`)),
    weights: Object.fromEntries(WEIGHTS.map((w) => [w.key, text(w.key)])) as Record<WeightKey, string>,
  };
}

export type Profile = {
  school: string | null;
  hometown: string | null;
  interests: string[];
  role_targets: string[];
  writing_samples: string[];
} & Record<WeightKey, number>;

// True when there's nothing to score or draft with yet.
export function isProfileEmpty(p: Partial<Profile> | null | undefined): boolean {
  if (!p) return true;
  return (
    !p.school?.trim() &&
    !p.hometown?.trim() &&
    !p.interests?.length &&
    !p.role_targets?.length &&
    !p.writing_samples?.length
  );
}
