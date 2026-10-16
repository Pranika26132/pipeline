// Scores a company as a plain weighted sum (SPEC.md "Filters and scoring").
// Pure: it reads only facts enrichment saved with a source page, plus the
// user's profile. Nothing is guessed; a factor without a stated fact on a
// page simply doesn't count.

export type Factor = "school" | "hometown" | "open_role" | "early_stage";

export type Reason = {
  factor: Factor;
  points: number;
  // Plain English, without the source; the page adds "found on <path>".
  text: string;
  source_url: string;
};

export type ScoreInput = {
  company: {
    stage: string | null;
    size: string | null;
    open_roles: unknown;
    field_sources: unknown;
  };
  contacts: {
    name: string;
    title: string | null;
    school: string | null;
    hometown: string | null;
    source_url: string | null;
  }[];
  profile: {
    school: string | null;
    hometown: string | null;
    role_targets: string[];
    weight_school: number;
    weight_hometown: number;
    weight_open_role: number;
    weight_early_stage: number;
  };
};

export type ScoreResult = { score: number; reasons: Reason[] };

export const FACTOR_LABELS: Record<Factor, string> = {
  school: "Alumni",
  hometown: "Hometown",
  open_role: "Role open",
  early_stage: "Early stage",
};

export function scoreCompany({ company, contacts, profile }: ScoreInput): ScoreResult {
  const reasons: Reason[] = [];
  const add = (factor: Factor, weight: number, found: Omit<Reason, "factor" | "points"> | null) => {
    // A weight of 0 means "doesn't matter": no points and no reason shown.
    if (found && weight > 0) reasons.push({ factor, points: weight, ...found });
  };

  const sourced = contacts.filter((c) => isHttpUrl(c.source_url));

  if (profile.school?.trim()) {
    const matches = sourced.filter((c) => c.school && schoolsMatch(profile.school!, c.school));
    add("school", profile.weight_school, matches.length ? personReason(matches, (c) => `went to ${c.school}`) : null);
  }

  if (profile.hometown?.trim()) {
    const matches = sourced.filter((c) => c.hometown && placesMatch(profile.hometown!, c.hometown));
    add("hometown", profile.weight_hometown, matches.length ? personReason(matches, (c) => `is from ${c.hometown}`) : null);
  }

  add("open_role", profile.weight_open_role, roleReason(company.open_roles, profile.role_targets));
  add("early_stage", profile.weight_early_stage, earlyStageReason(company));

  // Strongest reason first, so the list can show the top one.
  reasons.sort((a, b) => b.points - a.points);
  return { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

// "Jane Doe (CEO) went to Duke", or "Jane Doe (CEO) and 2 others went to Duke".
// The source is the first person's page.
function personReason<C extends ScoreInput["contacts"][number]>(matches: C[], what: (c: C) => string) {
  const first = matches[0];
  const who = first.title ? `${first.name} (${first.title})` : first.name;
  const others = matches.length - 1;
  const more = others === 0 ? "" : others === 1 ? ` and 1 other` : ` and ${others} others`;
  return { text: `${who}${more} ${what(first)}`, source_url: first.source_url! };
}

// Schools -----------------------------------------------------------------------

// Words that don't tell schools apart: "Duke" and "Duke University" are the same.
const SCHOOL_FILLER = new Set(["the", "university", "college", "of", "at", "in", "and", "school"]);
// A school within the university still counts: "Duke Law" is Duke.
const PROGRAM_WORDS = new Set([
  "law", "business", "engineering", "medicine", "medical", "graduate", "management", "divinity", "nursing",
  "public", "policy", "arts", "sciences", "science", "fuqua", "pratt", "trinity", "sanford", "wharton",
]);
// Common short names, so "MIT" matches "Massachusetts Institute of Technology".
const SCHOOL_ALIASES: Record<string, string> = {
  mit: "massachusetts institute technology",
  cmu: "carnegie mellon",
  unc: "north carolina chapel hill",
  "unc chapel hill": "north carolina chapel hill",
  "nc state": "north carolina state",
  ncsu: "north carolina state",
  nyu: "new york",
  ucla: "california los angeles",
  "uc berkeley": "california berkeley",
  berkeley: "california berkeley",
  "cal berkeley": "california berkeley",
  usc: "southern california",
  upenn: "pennsylvania",
  penn: "pennsylvania",
  caltech: "california institute technology",
  "georgia tech": "georgia institute technology",
  gatech: "georgia institute technology",
  uiuc: "illinois urbana champaign",
  "ut austin": "texas austin",
  umich: "michigan",
};

function schoolCore(name: string): string[] {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    // "Duke's Fuqua School" names Duke.
    .replace(/['\u2019]s\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const alias = SCHOOL_ALIASES[words.join(" ")];
  return (alias ? alias.split(" ") : words).filter((w) => !SCHOOL_FILLER.has(w));
}

// True when both name the same school. A person's school can name a school
// within the university ("Duke University School of Law"); the profile's
// school must be the whole of the rest. Several schools in one field
// ("Duke; Stanford") are checked one by one. "and", "&" and commas aren't
// separators: "William and Mary", "Texas A&M", "University of California, Berkeley".
export function schoolsMatch(profileSchool: string, personSchool: string): boolean {
  const mine = schoolCore(profileSchool);
  if (mine.length === 0) return false;
  return personSchool.split(/[;/|]/).some((part) => {
    const theirs = schoolCore(part);
    if (theirs.length < mine.length) return false;
    for (let start = 0; start + mine.length <= theirs.length; start++) {
      if (mine.every((w, i) => theirs[start + i] === w)) {
        const rest = [...theirs.slice(0, start), ...theirs.slice(start + mine.length)];
        if (rest.every((w) => PROGRAM_WORDS.has(w))) return true;
      }
    }
    return false;
  });
}

// Places ------------------------------------------------------------------------

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan",
  mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota",
  oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina",
  sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington",
  wv: "west virginia", wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};

function placeParts(place: string): string[] {
  return place
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[,;]/)
    .map((p) => p.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim())
    .filter((p) => p && p !== "usa" && p !== "us" && p !== "united states")
    .map((p) => US_STATES[p] ?? p);
}

// "Raleigh, NC" matches "Raleigh, North Carolina" and "Raleigh". A profile
// that names only a region ("North Carolina", "Bay Area") matches anyone from
// that region. A city match needs the states to agree when both are given, so
// Portland, OR isn't Portland, ME. Different cities in the same state don't
// match a city profile.
export function placesMatch(profilePlace: string, personPlace: string): boolean {
  const mine = placeParts(profilePlace);
  const theirs = placeParts(personPlace);
  if (mine.length === 0 || theirs.length === 0) return false;
  if (mine.length === 1) return theirs.includes(mine[0]);
  if (mine[0] !== theirs[0]) return false;
  const myRest = mine.slice(1);
  const theirRest = theirs.slice(1);
  return theirRest.length === 0 || myRest.some((p) => theirRest.includes(p));
}

// Roles -------------------------------------------------------------------------

// Title patterns for the role presets on /profile. A custom role matches a
// title that contains it as whole words.
const ROLE_PATTERNS: Record<string, RegExp> = {
  "Software engineering":
    /\b(software|swe|back[- ]?end|front[- ]?end|full[- ]?stack|web developer|mobile (engineer|developer)|ios|android|platform engineer|infrastructure engineer)\b/i,
  "Machine learning": /\b(machine learning|ml|ai|deep learning|computer vision|nlp|llm)\b/i,
  "Data science": /\b(data scien(ce|tist)|data analyst|data engineer(ing)?|analytics)\b/i,
  "Quant research": /\bquant(itative)? research(er)?\b/i,
  "Quant trading": /\b(trader|trading)\b/i,
  "Quant development": /\b(quant(itative)? (developer|development|dev|engineer)|strategy developer)\b/i,
};

export function roleMatches(target: string, title: string): boolean {
  const pattern = ROLE_PATTERNS[target];
  if (pattern) return pattern.test(title);
  const words = target.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return !!words && new RegExp(`(^|[^\\p{L}\\p{N}])${words}($|[^\\p{L}\\p{N}])`, "iu").test(title);
}

type Role = { title: string; location: string | null; source_url: string };

function roleReason(openRoles: unknown, targets: string[]) {
  if (!Array.isArray(openRoles) || targets.length === 0) return null;
  const roles = openRoles.filter(
    (r): r is Role => typeof r?.title === "string" && isHttpUrl(r?.source_url),
  );
  const matching = roles.filter((r) => targets.some((t) => roleMatches(t, r.title)));
  if (matching.length === 0) return null;
  // An internship is the most relevant opening to name.
  const best = matching.find((r) => /\bintern(ship)?s?\b/i.test(r.title)) ?? matching[0];
  const others = matching.length - 1;
  const more = others === 0 ? "" : others === 1 ? " and 1 more matching role" : ` and ${others} more matching roles`;
  return { text: `Hiring: ${best.title}${more}`, source_url: best.source_url };
}

// Early stage ---------------------------------------------------------------------

const EARLY_MAX_PEOPLE = 50;
const EARLY_STAGES = /\b(pre[- ]?seed|seed|series a|angel|y ?combinator|yc ?[wsfx]?\d{2,4}|yc)\b/i;
const LATE_STAGES = /\b(series [b-z]|public|ipo|acquired|nasdaq|nyse)\b/i;

function earlyStageReason(company: ScoreInput["company"]) {
  const sources = isObject(company.field_sources) ? company.field_sources : {};
  // Headcount decides when it's stated; otherwise the funding stage.
  const size = company.size?.trim();
  const sizeSource = sources.size;
  if (size && isHttpUrl(sizeSource)) {
    const numbers = [...size.replace(/,/g, "").matchAll(/\d+/g)].map((m) => Number(m[0]));
    if (numbers.length > 0) {
      const most = Math.max(...numbers);
      // "200+" or "1,000 employees" is not small, whatever else is stated.
      return most <= EARLY_MAX_PEOPLE && !/\+/.test(size) ? { text: `Small team: ${size}`, source_url: sizeSource } : null;
    }
  }
  const stage = company.stage?.trim();
  const stageSource = sources.stage;
  if (stage && isHttpUrl(stageSource) && EARLY_STAGES.test(stage) && !LATE_STAGES.test(stage)) {
    return { text: `Early stage: ${stage}`, source_url: stageSource };
  }
  return null;
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
