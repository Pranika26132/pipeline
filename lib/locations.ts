// Company locations (offices, HQ, role locations) with their sources. Saved
// by lookups and by Find; a new list is merged into the old one, never
// replacing it, so a lookup can't erase what Find saved.

export type CompanyLocation = {
  value: string;
  // The exact sentence from the source page; null for a role's location
  // field (checked to appear on the page instead).
  quote: string | null;
  source_url: string;
  kind: "office" | "role";
  from: "lookup" | "find";
};

const MAX = 30;

export function readLocations(raw: unknown): CompanyLocation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is CompanyLocation =>
      typeof l?.value === "string" &&
      l.value.trim() !== "" &&
      typeof l.source_url === "string" &&
      /^https?:\/\//i.test(l.source_url) &&
      (l.quote === null || typeof l.quote === "string") &&
      (l.kind === "office" || l.kind === "role") &&
      (l.from === "lookup" || l.from === "find"),
  );
}

// Old entries first, then new ones that aren't already there (same place,
// same page). Capped so the column stays small.
export function mergeLocations(old: unknown, added: CompanyLocation[]): CompanyLocation[] {
  const out = readLocations(old);
  const key = (l: CompanyLocation) => `${l.value.trim().toLowerCase()}\n${l.source_url}`;
  const seen = new Set(out.map(key));
  for (const l of added) {
    if (seen.has(key(l))) continue;
    seen.add(key(l));
    out.push(l);
  }
  return out.slice(0, MAX);
}
