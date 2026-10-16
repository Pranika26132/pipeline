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
  sample: 3000,
  samples: 3,
  weightMax: 10,
} as const;

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
