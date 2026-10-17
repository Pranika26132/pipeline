// The list page's filters live in the URL (?f=alumni&status=sent&contacted=1),
// so chips are plain links and a filtered list can be bookmarked or shared.

import type { Factor } from "./scoring";

export const FACTOR_CHIPS = [
  { slug: "alumni", factor: "school", label: "Alumni" },
  { slug: "hometown", factor: "hometown", label: "Hometown" },
  { slug: "role", factor: "open_role", label: "Role open" },
] as const satisfies readonly { slug: string; factor: Factor; label: string }[];

export const STATUSES = [
  { value: "to_contact", label: "To contact" },
  { value: "drafted", label: "Drafted" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "interview", label: "Interview" },
  { value: "rejected", label: "Rejected" },
  { value: "ghosted", label: "Ghosted" },
] as const;

export type Status = (typeof STATUSES)[number]["value"];

// Anything past drafting means the company has been contacted.
export const CONTACTED: ReadonlySet<Status> = new Set(["sent", "replied", "interview", "rejected", "ghosted"]);

export type Filters = {
  factors: Factor[];
  status: Status | null;
  showContacted: boolean;
};

type Params = { [key: string]: string | string[] | undefined };

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// Unknown values are ignored rather than shown as an error: a stale bookmark
// still opens the list.
export function parseFilters(params: Params): Filters {
  const slugs = new Set(list(params.f));
  const status = list(params.status)[0];
  return {
    factors: FACTOR_CHIPS.filter((c) => slugs.has(c.slug)).map((c) => c.factor),
    status: STATUSES.some((s) => s.value === status) ? (status as Status) : null,
    showContacted: list(params.contacted)[0] === "1",
  };
}

export function filtersHref(filters: Filters): string {
  const q = new URLSearchParams();
  for (const c of FACTOR_CHIPS) if (filters.factors.includes(c.factor)) q.append("f", c.slug);
  if (filters.status) q.set("status", filters.status);
  if (filters.showContacted) q.set("contacted", "1");
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

export function toggleFactor(filters: Filters, factor: Factor): Filters {
  const on = filters.factors.includes(factor);
  return { ...filters, factors: on ? filters.factors.filter((f) => f !== factor) : [...filters.factors, factor] };
}

export function isFiltered(filters: Filters): boolean {
  return filters.factors.length > 0 || filters.status !== null;
}

type Row = { factors: Factor[]; status: Status };

// Every chosen factor must have counted toward the score. Contacted
// companies are hidden unless asked for, or unless a status filter picks one.
export function matchesFilters(row: Row, filters: Filters): boolean {
  if (!filters.factors.every((f) => row.factors.includes(f))) return false;
  if (filters.status) return row.status === filters.status;
  return filters.showContacted || !CONTACTED.has(row.status);
}
