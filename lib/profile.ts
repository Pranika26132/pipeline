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

// How much each factor counts, as three plain choices. Each factor maps the
// choices to its own points so the defaults equal SPEC.md (school 3,
// hometown 2, open role 2, early stage 1). The database stores the points.
export const LEVELS = [
  { value: "none", label: "Doesn't matter" },
  { value: "matters", label: "Matters" },
  { value: "a_lot", label: "Matters a lot" },
] as const;

export type Level = (typeof LEVELS)[number]["value"];

export const WEIGHTS = [
  { key: "weight_school", label: "Founder or team went to my school", points: { none: 0, matters: 2, a_lot: 3 }, fallback: "a_lot" },
  { key: "weight_hometown", label: "Founder or team is from my hometown", points: { none: 0, matters: 2, a_lot: 3 }, fallback: "matters" },
  { key: "weight_open_role", label: "Hiring for a role I want", points: { none: 0, matters: 2, a_lot: 3 }, fallback: "matters" },
  { key: "weight_early_stage", label: "Small, early-stage company", points: { none: 0, matters: 1, a_lot: 2 }, fallback: "matters" },
] as const satisfies readonly { key: string; label: string; points: Record<Level, number>; fallback: Level }[];

export type WeightKey = (typeof WEIGHTS)[number]["key"];

export function isLevel(value: string): value is Level {
  return LEVELS.some((l) => l.value === value);
}

// Stored points back to a choice. Any other number (e.g. set through the API)
// shows as the nearest choice; ties go to the higher one.
export function levelFor(key: WeightKey, points: number | null | undefined): Level {
  const w = WEIGHTS.find((x) => x.key === key)!;
  if (points == null) return w.fallback;
  let best: Level = "none";
  for (const l of LEVELS) {
    if (Math.abs(w.points[l.value] - points) <= Math.abs(w.points[best] - points)) best = l.value;
  }
  return best;
}

export const LIMITS = {
  text: 200,
  role: 80,
  roles: 20,
  // The whole "Other roles" field: 20 roles plus separators.
  otherRoles: 20 * 82,
  sample: 3000,
  samples: 3,
} as const;

// The form's fields as typed, so they can be shown again after an error.
export type ProfileValues = {
  fullName: string;
  school: string;
  hometown: string;
  interests: string[];
  roles: string[];
  otherRoles: string;
  samples: string[];
  // A Level per factor, as submitted.
  weights: Record<WeightKey, string>;
};

export function readProfileForm(formData: FormData): ProfileValues {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    fullName: text("fullName"),
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
