// Scores a company as a plain weighted sum (SPEC.md "Filters and scoring").
// Pure: it reads only facts saved with a source page (by a lookup or founder
// research), facts the user typed or imported themselves, and the user's
// profile. Nothing is guessed; a factor without a stated fact doesn't count.

import { currentFits, fitFor, fitKey, isSeniorTitle } from "./fit";
import { readLocations } from "./locations";
import { roleTiming } from "./roles";

export type Factor = "school" | "hometown" | "region" | "open_role" | "early_stage";

export type Reason = {
  factor: Factor;
  points: number;
  // Plain English, without the source; the page adds "found on <path>".
  text: string;
  // Null for a fact the user added or imported without a link.
  source_url: string | null;
};

export type ScoreInput = {
  company: {
    stage: string | null;
    size: string | null;
    open_roles: unknown;
    field_sources: unknown;
    // From an imported list's "connection" column, e.g. "Duke".
    connection?: string | null;
    connection_source_url?: string | null;
    // Claude's per-role verdicts (lib/fit.ts), with the profile key they were judged against.
    role_fit?: unknown;
    // Offices, HQ and role locations with sources (lib/locations.ts).
    locations?: unknown;
  };
  contacts: {
    name: string;
    title: string | null;
    school: string | null;
    hometown: string | null;
    // The page the person was found on (a team page).
    source_url: string | null;
    // Founder research finds a school or hometown on another page.
    school_source_url?: string | null;
    hometown_source_url?: string | null;
    added_by_user?: boolean;
    // From founder research: only "stated" counts. "shared" (only a sentence
    // about several people) and "conflicting" (sources disagree) don't.
    school_status?: string | null;
    hometown_status?: string | null;
  }[];
  profile: {
    school: string | null;
    hometown: string | null;
    role_targets: string[];
    weight_school: number;
    weight_hometown: number;
    weight_open_role: number;
    weight_early_stage: number;
    // Missing for profiles saved before the factor existed: the default.
    weight_region?: number;
    // Role fit is judged against these too (lib/fit.ts fitKey).
    degree?: string | null;
    major?: string | null;
    grad_year?: number | null;
    resume?: string | null;
  };
  // Roles whose dates are before this don't count. Defaults to now.
  today?: Date;
};

export type ScoreResult = { score: number; reasons: Reason[] };

export const FACTOR_LABELS: Record<Factor, string> = {
  school: "Alumni",
  hometown: "Hometown",
  region: "Nearby",
  open_role: "Role open",
  early_stage: "Early stage",
};

export function scoreCompany({ company, contacts, profile, today = new Date() }: ScoreInput): ScoreResult {
  const reasons: Reason[] = [];
  const add = (factor: Factor, weight: number, found: Omit<Reason, "factor" | "points"> | null) => {
    // A weight of 0 means "doesn't matter": no points and no reason shown.
    if (found && weight > 0) reasons.push({ factor, points: weight, ...found });
  };

  // The tag from an imported list counts like a person's fact.
  const connection = company.connection?.trim() || null;
  const connectionReason = () => ({
    text: `Tagged ${connection} in your imported list`,
    source_url: isHttpUrl(company.connection_source_url) ? company.connection_source_url : null,
  });

  if (profile.school?.trim()) {
    const matches = contacts.filter((c) => c.school && schoolsMatch(profile.school!, c.school) && factSource(c, "school") !== undefined);
    const found = matches.length
      ? personReason(matches, "school", (c) => `went to ${c.school}`)
      : connection && schoolsMatch(profile.school, connection)
        ? connectionReason()
        : null;
    add("school", profile.weight_school, found);
  }

  if (profile.hometown?.trim()) {
    const matches = contacts.filter(
      (c) => c.hometown && placesMatch(profile.hometown!, c.hometown) && factSource(c, "hometown") !== undefined,
    );
    const found = matches.length
      ? personReason(matches, "hometown", (c) => `is from ${c.hometown}`)
      : connection && placesMatch(profile.hometown, connection)
        ? connectionReason()
        : null;
    add("hometown", profile.weight_hometown, found);
  }

  if (profile.hometown?.trim()) {
    add("region", profile.weight_region ?? 1, regionReason(company.locations, profile.hometown));
  }

  add("open_role", profile.weight_open_role, roleReason(company, profile, today));
  add("early_stage", profile.weight_early_stage, earlyStageReason(company));

  // Strongest reason first, so the list can show the top one.
  reasons.sort((a, b) => b.points - a.points);
  return { score: reasons.reduce((sum, r) => sum + r.points, 0), reasons };
}

type Contact = ScoreInput["contacts"][number];

// The page a person's school or hometown came from: its own source when
// founder research found it, else the page the person was found on. Null for
// a person the user added without a link (their own word, still counted).
// Undefined when the fact has no usable source, so it doesn't count.
function factSource(c: Contact, fact: "school" | "hometown"): string | null | undefined {
  const status = fact === "school" ? c.school_status : c.hometown_status;
  if (status && status !== "stated") return undefined;
  const own = fact === "school" ? c.school_source_url : c.hometown_source_url;
  if (isHttpUrl(own)) return own;
  if (isHttpUrl(c.source_url)) return c.source_url;
  return c.added_by_user ? null : undefined;
}

// "Jane Doe (CEO) went to Duke", or "Jane Doe (CEO) and 2 others went to Duke".
// The source is the first person's page.
function personReason(matches: Contact[], fact: "school" | "hometown", what: (c: Contact) => string) {
  const first = matches[0];
  const who = first.title ? `${first.name} (${first.title})` : first.name;
  const others = matches.length - 1;
  const more = others === 0 ? "" : others === 1 ? ` and 1 other` : ` and ${others} others`;
  return { text: `${who}${more} ${what(first)}`, source_url: factSource(first, fact) ?? null };
}

// Schools -----------------------------------------------------------------------

// "University" and "College" are kept apart from the name: "Duke" matches
// "Duke University", but "Boston College" isn't "Boston University" and
// "University of Miami" isn't "Miami University".
const SCHOOL_TYPES = new Set(["university", "college"]);
const SCHOOL_FILLER = new Set(["the", "of", "at", "in", "and", "school"]);
// Degrees and class years say nothing about which school: "Duke '19 (BS)".
const DEGREE = /^(ba|bs|bse|bsc|ms|msc|ma|mba|meng|mfa|bfa|phd|jd|md|class|alum|alumna|alumnus|alumni|undergrad|undergraduate|grad|\d{2,4})$/;
// A school within the university still counts: "Duke Law" is Duke.
const PROGRAM_WORDS = new Set([
  "law", "business", "engineering", "medicine", "medical", "graduate", "management", "divinity", "nursing",
  "public", "policy", "arts", "sciences", "science", "fuqua", "pratt", "trinity", "sanford", "wharton", "sloan",
  "stern", "kellogg", "booth", "haas", "ross", "tuck", "kenan", "flagler",
]);
// Common short names, so "MIT" matches "Massachusetts Institute of Technology".
const SCHOOL_ALIASES: Record<string, string> = {
  mit: "massachusetts institute of technology",
  cmu: "carnegie mellon university",
  unc: "university of north carolina at chapel hill",
  "unc chapel hill": "university of north carolina at chapel hill",
  "nc state": "north carolina state university",
  ncsu: "north carolina state university",
  nyu: "new york university",
  ucla: "university of california los angeles",
  "uc berkeley": "university of california berkeley",
  berkeley: "university of california berkeley",
  "cal berkeley": "university of california berkeley",
  usc: "university of southern california",
  upenn: "university of pennsylvania",
  penn: "university of pennsylvania",
  caltech: "california institute of technology",
  "georgia tech": "georgia institute of technology",
  gatech: "georgia institute of technology",
  uiuc: "university of illinois urbana champaign",
  "ut austin": "university of texas at austin",
  umich: "university of michigan",
};

type SchoolName = { words: string[]; type: string | null; typeFirst: boolean };

function parseSchool(name: string): SchoolName {
  let tokens = name
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
  if (tokens[0] === "the") tokens = tokens.slice(1);
  const whole = SCHOOL_ALIASES[tokens.join(" ")];
  if (whole) tokens = whole.split(" ");
  // "MIT Sloan", "NYU Stern": a short name followed by a program.
  else if (SCHOOL_ALIASES[tokens[0]]) tokens = [...SCHOOL_ALIASES[tokens[0]].split(" "), ...tokens.slice(1)];
  const typeAt = tokens.findIndex((w) => SCHOOL_TYPES.has(w));
  return {
    words: tokens.filter((w) => !SCHOOL_TYPES.has(w) && !SCHOOL_FILLER.has(w) && !DEGREE.test(w)),
    type: typeAt === -1 ? null : tokens[typeAt],
    typeFirst: typeAt === 0,
  };
}

function sameSchool(mine: SchoolName, theirs: SchoolName): boolean {
  if (mine.words.length === 0 || theirs.words.length < mine.words.length) return false;
  // Both say what kind of school: it must be the same kind, said the same way.
  if (mine.type && theirs.type && (mine.type !== theirs.type || mine.typeFirst !== theirs.typeFirst)) return false;
  for (let start = 0; start + mine.words.length <= theirs.words.length; start++) {
    if (!mine.words.every((w, i) => theirs.words[start + i] === w)) continue;
    const rest = [...theirs.words.slice(0, start), ...theirs.words.slice(start + mine.words.length)];
    if (rest.length === 0) return true;
    // Extra program words only count when the person's school says it's a
    // university or college, or the profile doesn't: "New York Law School"
    // is not NYU.
    if (rest.every((w) => PROGRAM_WORDS.has(w)) && (theirs.type !== null || mine.type === null)) return true;
  }
  return false;
}

// True when both name the same school. A person's field may list several
// ("Duke; Stanford", "Duke, Stanford"); the whole field and each part are
// checked, so "University of California, Berkeley" still reads as one school.
export function schoolsMatch(profileSchool: string, personSchool: string): boolean {
  const mine = parseSchool(profileSchool);
  const parts = [personSchool, ...personSchool.split(/[;/|,]/)];
  return parts.some((part) => sameSchool(mine, parseSchool(part)));
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
// State codes that people also write after foreign cities: "Mumbai, IN" is
// India, "Berlin, DE" Germany, "Toronto, CA" Canada, "Perth, WA" Western
// Australia. Rarer collisions (NC is also New Caledonia) still expand.
const AMBIGUOUS_CODES = new Set(["ar", "ca", "co", "de", "id", "il", "in", "ma", "mt", "wa"]);

function placeParts(place: string, expandAmbiguous: boolean): string[] {
  return place
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[,;]/)
    .map((p) => p.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim())
    // Zip codes and street numbers say nothing about the place: "MN 55401" is MN.
    .map((p) => p.split(" ").filter((w) => !/\d/.test(w)).join(" "))
    .filter((p) => p && p !== "usa" && p !== "us" && p !== "united states")
    .map((p) => (US_STATES[p] && (expandAmbiguous || !AMBIGUOUS_CODES.has(p)) ? US_STATES[p] : p));
}

// "Raleigh, NC" matches "Raleigh, North Carolina", but not a bare "Raleigh"
// (which Raleigh isn't stated) or "Durham, NC". A profile that names only a
// region ("North Carolina", "Bay Area") matches anyone from that region; a
// person's code that is also a country code ("Mumbai, IN") only matches the
// same code, never the state's name.
export function placesMatch(profilePlace: string, personPlace: string): boolean {
  const mine = placeParts(profilePlace, true);
  if (mine.length === 0) return false;
  if (mine.length === 1) {
    const raw = placeParts(profilePlace, false)[0];
    return placeParts(personPlace, false).some((p) => p === mine[0] || p === raw);
  }
  // Same city: the state codes can be read as states.
  const theirs = placeParts(personPlace, true);
  if (theirs.length < 2 || mine[0] !== theirs[0]) return false;
  return mine.slice(1).some((p) => theirs.slice(1).includes(p));
}

// The words a place goes by, for spotting it in text: "Minneapolis, MN" ->
// ["minneapolis", "minnesota", "mn"].
// Two-letter codes are left out: "in" or "me" would match ordinary words.
export function placeTerms(place: string): string[] {
  return [...new Set([...placeParts(place, true), ...placeParts(place, false)])].filter((t) => t.length >= 3);
}

export const US_STATE_NAMES: readonly string[] = [...new Set(Object.values(US_STATES))];

// "Nearby": an office, HQ or role location in the profile's place, or in the
// same state as the profile's city ("Minneapolis, MN" counts for "St. Paul,
// Minnesota"). A location needs a source page.
export function regionsMatch(profilePlace: string, place: string): boolean {
  if (placesMatch(profilePlace, place)) return true;
  const mine = placeParts(profilePlace, true);
  if (mine.length < 2) return false;
  const state = mine[mine.length - 1];
  // Only a US state is a region here; a country ("Mumbai, India") is too broad.
  if (!US_STATE_NAMES.includes(state)) return false;
  // The code as the user wrote it ("MA"), so "Cambridge, MA" matches "Boston, MA".
  const myCode = placeParts(profilePlace, false).at(-1);
  const theirs = placeParts(place, false);
  // The state is after the city: "Washington, DC" is not Washington state.
  const tail = theirs.length >= 2 ? theirs.slice(1) : theirs;
  return tail.some((p) => p === state || (myCode !== state && p === myCode));
}

function regionReason(locations: unknown, home: string) {
  const match = readLocations(locations).find((l) => isHttpUrl(l.source_url) && regionsMatch(home, l.value));
  if (!match) return null;
  return { text: match.kind === "office" ? `Office in ${match.value}` : `Role located in ${match.value}`, source_url: match.source_url };
}

// Roles -------------------------------------------------------------------------

// Title patterns for the role presets on /profile: the field and the kind of
// work, so "Software Sales Representative" isn't software engineering. A
// custom role matches a title that contains it as whole words.
const ROLE_PATTERNS: Record<string, RegExp[]> = {
  "Software engineering": [
    /\b(software|back[- ]?end|front[- ]?end|full[- ]?stack|web|mobile|ios|android|platform|infrastructure|systems software)\b.*\b(engineer|engineering|developer|development)\b/i,
    /\bswes?\b/i,
  ],
  "Machine learning": [
    /\b(machine learning|deep learning|computer vision|nlp|ml|ai|llm)\b.*\b(engineer|engineering|researcher|research|scientist)\b/i,
    /\b(engineer|researcher|scientist)\b.*\b(machine learning|ml|ai)\b/i,
  ],
  "Data science": [/\bdata (scien(ce|tist)|analyst|engineer(ing)?)\b/i],
  "Quant research": [/\bquant(itative)? research(er)?\b/i],
  "Quant trading": [/\b(traders?|quant(itative)? trading|trading (intern|internship|analyst|associate))\b/i],
  "Quant development": [/\b(quant(itative)? (developer|development|dev|engineer)|strategy developer)\b/i],
};

export function roleMatches(target: string, title: string): boolean {
  const patterns = ROLE_PATTERNS[target];
  if (patterns) return patterns.some((p) => p.test(title));
  const words = target.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return !!words && new RegExp(`(^|[^\\p{L}\\p{N}])${words}($|[^\\p{L}\\p{N}])`, "iu").test(title);
}

type Role = { title: string; location: string | null; details?: string | null; source_url: string };

// Once Claude has checked fit against the current profile, roles it says
// fit count, with its reason. Roles without a current verdict (never
// checked, the profile changed since, or a later lookup found them) count
// when their title matches a target role, except senior titles and roles
// whose dates have passed, and the reason says the fit wasn't checked.
function roleReason(company: ScoreInput["company"], profile: ScoreInput["profile"], today: Date) {
  const targets = profile.role_targets;
  if (!Array.isArray(company.open_roles) || targets.length === 0) return null;
  const roles = company.open_roles.filter(
    (r): r is Role => typeof r?.title === "string" && isHttpUrl(r?.source_url),
  );
  // An internship is the most relevant opening to name.
  const pick = (list: Role[]) => list.find((r) => /\bintern(ship)?s?\b/i.test(r.title)) ?? list[0];

  const fits = currentFits(company.role_fit, fitKey(profile));
  const fitting = roles.filter((r) => fitFor(fits, r)?.verdict === "fits");
  if (fitting.length > 0) {
    const best = pick(fitting);
    return { text: `Hiring: ${best.title}${more(fitting.length - 1, "role that fits", "roles that fit")}. ${fitFor(fits, best)!.reason}`, source_url: best.source_url };
  }

  const matching = roles.filter(
    (r) =>
      !fitFor(fits, r) &&
      targets.some((t) => roleMatches(t, r.title)) &&
      roleTiming(r.title, today) !== "past" &&
      !isSeniorTitle(r.title),
  );
  if (matching.length === 0) return null;
  const best = pick(matching);
  return { text: `Hiring: ${best.title}${more(matching.length - 1, "matching role", "matching roles")} (fit not checked yet)`, source_url: best.source_url };
}

function more(n: number, one: string, many: string) {
  return n === 0 ? "" : n === 1 ? ` and 1 more ${one}` : ` and ${n} more ${many}`;
}

// Early stage ---------------------------------------------------------------------

const EARLY_MAX_PEOPLE = 50;
// YC isn't here: a YC company can be ten years old and large.
const EARLY_STAGES = /\b(pre[- ]?seed|seed|series a|angel)\b/i;
const LATE_STAGES = /\b(series [b-z]|public|ipo|acquired|nasdaq|nyse)\b/i;

// Headcounts stated in a size text: "11-50" -> [11, 50], "1.2k" -> [1200].
// Years ("Founded 2015, 30 people") are not headcounts.
export function headcounts(size: string): number[] {
  const out: number[] = [];
  for (const m of size.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/(\d+(?:\.\d+)?)\s*(k|thousand)?\b/gi)) {
    const n = Number(m[1]) * (m[2] ? 1000 : 1);
    const before = size.slice(0, m.index).toLowerCase();
    if (!m[2] && n >= 1900 && n <= 2099 && /\b(founded|since|established|est|in)\.?\s*$/.test(before)) continue;
    out.push(n);
  }
  return out;
}

function earlyStageReason(company: ScoreInput["company"]) {
  const sources = isObject(company.field_sources) ? company.field_sources : {};
  // Headcount decides when it's stated; otherwise the funding stage.
  const size = company.size?.trim();
  const sizeSource = sources.size;
  if (size && isHttpUrl(sizeSource)) {
    const numbers = headcounts(size);
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
