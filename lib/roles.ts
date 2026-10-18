// Whether an internship's dates, as written in its title, have passed:
// "Summer 2026 SWE Intern" is over by October 2026. Titles without a season
// and year are "undated" (no guess either way).

export type Timing = "past" | "upcoming" | "undated";

// The last month (1-12) of each term; winter runs into the next year.
const TERM_END: Record<string, { month: number; nextYear?: boolean }> = {
  spring: { month: 5 },
  summer: { month: 8 },
  fall: { month: 12 },
  autumn: { month: 12 },
  winter: { month: 2, nextYear: true },
};

export function roleTiming(title: string, today: Date): Timing {
  const m = title.match(/\b(spring|summer|fall|autumn|winter)\s*[-'’]?\s*(\d{4}|\d{2})\b/i);
  const yearOnly = title.match(/\b(20\d{2})\b/);
  let end: Date;
  if (m) {
    const term = TERM_END[m[1].toLowerCase()];
    let year = Number(m[2].length === 2 ? `20${m[2]}` : m[2]);
    if (term.nextYear) year += 1;
    end = new Date(Date.UTC(year, term.month, 0, 23, 59, 59)); // last day of the term's last month
  } else if (yearOnly && /\bintern(ship)?s?\b/i.test(title)) {
    end = new Date(Date.UTC(Number(yearOnly[1]), 11, 31, 23, 59, 59));
  } else {
    return "undated";
  }
  return end.getTime() < today.getTime() ? "past" : "upcoming";
}
