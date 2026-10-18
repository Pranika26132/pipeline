// Draft emails (SPEC.md "Email drafting"). Pure helpers: the facts a draft
// may use, the checks every draft must pass, and the Gmail compose link.
// The app never sends anything.

import { currentFits, fitFor, fitKey } from "./fit";
import { roleTiming } from "./roles";
import type { Reason } from "./scoring";

export const MAX_WORDS = 120;
// How much of the resume a draft sees.
const RESUME_CHARS = 5000;

// Phrases that make a cold email read as generic (SPEC.md, CLAUDE.md).
export const STOCK_PHRASES = [
  "hope this finds you well",
  "hope this email finds you",
  "hope you are doing well",
  "hope you're doing well",
  "passionate about",
  "seamless",
  "i am writing to",
  "i'm writing to",
  "reach out",
  "reaching out",
  "touch base",
  "synergy",
  "game-changer",
  "game changer",
  "cutting-edge",
  "cutting edge",
  "leverage",
  "thrilled",
  "excited to",
  "i came across",
  "pick your brain",
  "at your earliest convenience",
  "do not hesitate",
  "don't hesitate",
  "to whom it may concern",
  "dear sir or madam",
  "innovative",
  "revolutionize",
  "i wanted to",
  "looking forward to hearing from you",
];

export type Hook = "auto" | "alumni" | "hometown" | "role" | "product";

export const HOOKS: { value: Hook; label: string }[] = [
  { value: "auto", label: "Best available" },
  { value: "product", label: "What they build" },
  { value: "role", label: "An internship role" },
  { value: "alumni", label: "Same school" },
  { value: "hometown", label: "Same hometown" },
];

// "company": what they build, a role, stage or size (a draft uses exactly
// one). "connection": a shared school or hometown (at most one, optional).
// "recipient" says who the email is to. "me": the student's own facts.
export type DraftFact = {
  id: string;
  kind: "company" | "connection" | "recipient" | "me";
  hook?: Exclude<Hook, "auto">;
  text: string;
  source?: string | null;
};

export type DraftInput = {
  company: {
    name: string;
    summary: string | null;
    stage: string | null;
    size: string | null;
    open_roles: unknown;
    score_reasons: unknown;
    field_sources: unknown;
    role_fit?: unknown;
  };
  contact: { name: string; title: string | null; school: string | null; hometown: string | null; schoolCounts: boolean; hometownCounts: boolean } | null;
  profile: {
    school: string | null;
    hometown: string | null;
    interests: string[];
    role_targets: string[];
    grad_year?: number | null;
    degree?: string | null;
    major?: string | null;
    resume?: string | null;
  } | null;
  // Roles whose dates are before this are treated as past.
  today: Date;
};

// Every fact a draft may use, numbered, with where it came from. Only facts
// that came from a lookup (with a source), the user's own additions, or the
// user's profile go in; a researched fact that isn't "stated" doesn't.
export function draftFacts({ company, contact, profile, today }: DraftInput): DraftFact[] {
  const facts: DraftFact[] = [];
  const sources = (company.field_sources ?? {}) as Record<string, string | undefined>;
  const add = (f: Omit<DraftFact, "id">) => facts.push({ ...f, id: `F${facts.length + 1}` });

  if (company.summary) add({ kind: "company", hook: "product", text: `What ${company.name} builds: ${company.summary}`, source: sources.summary });
  const roles = (Array.isArray(company.open_roles) ? company.open_roles : []) as { title?: unknown; location?: unknown; source_url?: unknown }[];
  // Roles Claude judged not to fit this profile aren't offered as hooks.
  const fits = profile ? currentFits(company.role_fit, fitKey(profile)) : null;
  const usable = roles.filter(
    (r) => typeof r.title !== "string" || fitFor(fits, { title: r.title, source_url: String(r.source_url) })?.verdict !== "no_fit",
  );
  for (const r of usable.slice(0, 5)) {
    if (typeof r.title !== "string") continue;
    const where = typeof r.location === "string" && r.location ? ` (${r.location})` : "";
    const source = typeof r.source_url === "string" ? r.source_url : null;
    // A role whose dates have passed isn't open: it shows they hire interns.
    const text =
      roleTiming(r.title, today) === "past"
        ? `${company.name} hired for "${r.title}"; those dates have passed, so it is not open now. It shows they hire interns of this kind: ask about upcoming internships, never present this role as open.`
        : `${company.name} lists an open role: ${r.title}${where}`;
    add({ kind: "company", hook: "role", text, source });
  }
  if (company.stage) add({ kind: "company", text: `${company.name}'s stage: ${company.stage}`, source: sources.stage });
  if (company.size) add({ kind: "company", text: `${company.name}'s size: ${company.size}`, source: sources.size });

  // Score reasons are already checked facts with their sources.
  const reasons = (Array.isArray(company.score_reasons) ? company.score_reasons : []) as Reason[];
  for (const r of reasons) {
    if (r.factor === "school") add({ kind: "connection", hook: "alumni", text: r.text, source: r.source_url });
    if (r.factor === "hometown") add({ kind: "connection", hook: "hometown", text: r.text, source: r.source_url });
  }

  if (contact) {
    add({ kind: "recipient", text: `The email is to ${contact.name}${contact.title ? `, ${contact.title} at ${company.name}` : ` at ${company.name}`}` });
    if (contact.school && contact.schoolCounts) add({ kind: "connection", hook: "alumni", text: `${contact.name} went to ${contact.school}` });
    if (contact.hometown && contact.hometownCounts) add({ kind: "connection", hook: "hometown", text: `${contact.name} is from ${contact.hometown}` });
  }

  if (profile?.school) add({ kind: "me", text: `I go to ${profile.school}` });
  if (profile?.hometown) add({ kind: "me", text: `I'm from ${profile.hometown}` });
  const degree = profile?.degree?.trim();
  const major = profile?.major?.trim();
  const year = profile?.grad_year ? `class of ${profile.grad_year}` : null;
  const study = major ? `I'm studying ${degree ? `${degree} in ` : ""}${major}` : degree ? `My degree: ${degree}` : null;
  if (study || year) add({ kind: "me", text: [study, year].filter(Boolean).join(", ") });
  if (profile?.resume?.trim()) {
    add({
      kind: "me",
      text: `My resume (use at most one line from it, the one most related to this company, in one short sentence; add nothing it doesn't say): ${profile.resume.trim().slice(0, RESUME_CHARS)}`,
    });
  }
  if (profile?.role_targets.length) {
    add({ kind: "me", text: `Internships I'm looking for (name at most one that fits this company; never list them): ${profile.role_targets.join(", ")}` });
  }
  return facts;
}

// The hooks the facts can support, in the order the menu shows them.
export function availableHooks(facts: DraftFact[]): Exclude<Hook, "auto">[] {
  const order: Exclude<Hook, "auto">[] = ["product", "role", "alumni", "hometown"];
  return order.filter((h) => facts.some((f) => f.hook === h && (f.kind === "company" || f.kind === "connection")));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Everything a draft must pass before it's shown. Returns the problems, in
// plain words, so they can be fixed (by a retry) or shown.
// `used`: the company fact the draft names (required) and the connection fact
// (optional). `extraKnown`: other text the student wrote (writing samples),
// where a number or detail about them may come from.
export function checkDraft(
  draft: { subject: string; body: string },
  facts: DraftFact[],
  used: { company: string; connection?: string | null },
  extraKnown = "",
): string[] {
  const problems: string[] = [];
  const words = wordCount(draft.body);
  if (words >= MAX_WORDS) problems.push(`The body is ${words} words; it must be under ${MAX_WORDS}.`);
  if (!draft.subject.trim()) problems.push("The subject is empty.");
  if (draft.subject.length > 120) problems.push("The subject is too long.");
  const lower = `${draft.subject}\n${draft.body}`.toLowerCase().replace(/[’]/g, "'");
  const stock = STOCK_PHRASES.filter((p) => lower.includes(p));
  if (stock.length) problems.push(`It uses stock phrases: ${stock.map((p) => `"${p}"`).join(", ")}.`);
  if (/\[[^\]]*\]|\{[^}]*\}|<[^>]*>/.test(draft.body + draft.subject)) problems.push("It has a placeholder in brackets.");
  // A number the facts don't contain was made up ("5 million users").
  // Numbers are compared as whole tokens, so "20" isn't found inside "2027".
  const known = `${facts.map((f) => f.text).join(" ")} ${extraKnown}`;
  const tokens = (t: string) => new Set((t.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[.,]+$/, "").replace(/,/g, "")));
  const knownNumbers = tokens(known);
  // Durations in the ask ("a 15-minute call", "15–20 minutes") aren't claims.
  const text = (draft.subject + " " + draft.body).replace(/\b\d+(?:\s*[-–]\s*\d+)?[- ]?(?:minutes?|mins?)\b/gi, " ");
  const invented = [...tokens(text)].filter((n) => n && !knownNumbers.has(n));
  if (invented.length) problems.push(`It has numbers not in the facts: ${invented.join(", ")}.`);
  const scale = (text.match(/\b(hundreds?|thousands?|millions?|billions?)\b/gi) ?? []).filter((w) => !new RegExp(`\\b${w}\\b`, "i").test(known));
  if (scale.length) problems.push(`It has amounts not in the facts: ${[...new Set(scale)].join(", ")}.`);
  // Links and addresses only come from the user, never from page text.
  const links = [...(draft.subject + " " + draft.body).matchAll(/\bhttps?:\/\/\S+|\bwww\.\S+|[^\s@]+@[^\s@]+\.[^\s@]+/gi)].map((m) => m[0]);
  if (links.length) problems.push(`It has a link or email address: ${links.join(", ")}.`);
  // Exactly one company fact, and at most one shared school or hometown.
  if (facts.find((f) => f.id === used.company)?.kind !== "company") problems.push("It doesn't name which company fact it uses.");
  if (used.connection && facts.find((f) => f.id === used.connection)?.kind !== "connection") {
    problems.push("The connection it names isn't a shared school or hometown from the facts.");
  }
  return problems;
}

// Opens Gmail's compose window with the draft filled in. Nothing is sent:
// the user reviews it there and presses Send themselves. Spaces are encoded
// as %20, not "+".
export function gmailComposeUrl(draft: { to?: string | null; subject: string; body: string }): string {
  const parts = ["view=cm", "fs=1"];
  if (draft.to) parts.push(`to=${encodeURIComponent(draft.to)}`);
  parts.push(`su=${encodeURIComponent(draft.subject)}`, `body=${encodeURIComponent(draft.body)}`);
  return `https://mail.google.com/mail/?${parts.join("&")}`;
}

// Gmail rejects very long compose links; past this, offer Copy instead.
export const GMAIL_URL_LIMIT = 1800;
