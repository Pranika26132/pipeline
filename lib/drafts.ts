// Draft emails (SPEC.md "Email drafting"). Pure helpers: the facts a draft
// may use, the checks every draft must pass, and the Gmail compose link.
// The app never sends anything.

import type { Reason } from "./scoring";

export const MAX_WORDS = 120;

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
  { value: "alumni", label: "Same school" },
  { value: "hometown", label: "Same hometown" },
  { value: "role", label: "An open role" },
  { value: "product", label: "What they build" },
];

export type DraftFact = { id: string; kind: "company" | "person" | "me"; hook?: Exclude<Hook, "auto">; text: string; source?: string | null };

export type DraftInput = {
  company: {
    name: string;
    summary: string | null;
    stage: string | null;
    size: string | null;
    open_roles: unknown;
    score_reasons: unknown;
    field_sources: unknown;
  };
  contact: { name: string; title: string | null; school: string | null; hometown: string | null; schoolCounts: boolean; hometownCounts: boolean } | null;
  profile: { school: string | null; hometown: string | null; interests: string[]; role_targets: string[] } | null;
};

// Every fact a draft may use, numbered, with where it came from. Only facts
// that came from a lookup (with a source), the user's own additions, or the
// user's profile go in; a researched fact that isn't "stated" doesn't.
export function draftFacts({ company, contact, profile }: DraftInput): DraftFact[] {
  const facts: DraftFact[] = [];
  const sources = (company.field_sources ?? {}) as Record<string, string | undefined>;
  const add = (f: Omit<DraftFact, "id">) => facts.push({ ...f, id: `F${facts.length + 1}` });

  if (company.summary) add({ kind: "company", hook: "product", text: `What ${company.name} does: ${company.summary}`, source: sources.summary });
  if (company.stage) add({ kind: "company", text: `${company.name}'s stage: ${company.stage}`, source: sources.stage });
  if (company.size) add({ kind: "company", text: `${company.name}'s size: ${company.size}`, source: sources.size });
  const roles = (Array.isArray(company.open_roles) ? company.open_roles : []) as { title?: unknown; location?: unknown; source_url?: unknown }[];
  for (const r of roles.slice(0, 5)) {
    if (typeof r.title !== "string") continue;
    const where = typeof r.location === "string" && r.location ? ` (${r.location})` : "";
    add({ kind: "company", hook: "role", text: `${company.name} lists an open role: ${r.title}${where}`, source: typeof r.source_url === "string" ? r.source_url : null });
  }
  // Score reasons are already checked facts with their sources.
  const reasons = (Array.isArray(company.score_reasons) ? company.score_reasons : []) as Reason[];
  for (const r of reasons) {
    if (r.factor === "school") add({ kind: "company", hook: "alumni", text: r.text, source: r.source_url });
    if (r.factor === "hometown") add({ kind: "company", hook: "hometown", text: r.text, source: r.source_url });
  }

  if (contact) {
    add({ kind: "person", text: `The email is to ${contact.name}${contact.title ? `, ${contact.title} at ${company.name}` : ` at ${company.name}`}` });
    if (contact.school && contact.schoolCounts) add({ kind: "person", hook: "alumni", text: `${contact.name} went to ${contact.school}` });
    if (contact.hometown && contact.hometownCounts) add({ kind: "person", hook: "hometown", text: `${contact.name} is from ${contact.hometown}` });
  }

  if (profile?.school) add({ kind: "me", text: `I go to ${profile.school}` });
  if (profile?.hometown) add({ kind: "me", text: `I'm from ${profile.hometown}` });
  if (profile?.interests.length) add({ kind: "me", text: `My interests: ${profile.interests.join(", ")}` });
  if (profile?.role_targets.length) add({ kind: "me", text: `Internship roles I'm looking for: ${profile.role_targets.join(", ")}` });
  return facts;
}

// The hooks the facts can support, best first: a shared school or hometown
// beats an open role, which beats what they build.
export function availableHooks(facts: DraftFact[]): Exclude<Hook, "auto">[] {
  const order: Exclude<Hook, "auto">[] = ["alumni", "hometown", "role", "product"];
  return order.filter((h) => facts.some((f) => f.hook === h && f.kind !== "me"));
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// Everything a draft must pass before it's shown. Returns the problems, in
// plain words, so they can be fixed (by a retry) or shown.
export function checkDraft(draft: { subject: string; body: string }, facts: DraftFact[], companyFact: string): string[] {
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
  const known = facts.map((f) => f.text).join(" ");
  // Durations in the ask ("a 15-minute call") aren't claims about anyone.
  const text = (draft.subject + " " + draft.body).replace(/\b\d+[- ]?(?:minutes?|mins?)\b/gi, " ");
  const invented = [...new Set(text.match(/\d[\d,.]*/g) ?? [])]
    .map((n) => n.replace(/[.,]+$/, ""))
    .filter((n) => n && !known.includes(n));
  if (invented.length) problems.push(`It has numbers not in the facts: ${invented.join(", ")}.`);
  const used = facts.find((f) => f.id === companyFact);
  if (!used || used.kind === "me") problems.push("It doesn't name which company fact it uses.");
  return problems;
}

// Opens Gmail's compose window with the draft filled in. Nothing is sent:
// the user reviews it there and presses Send themselves.
export function gmailComposeUrl(draft: { to?: string | null; subject: string; body: string }): string {
  const q = new URLSearchParams({ view: "cm", fs: "1" });
  if (draft.to) q.set("to", draft.to);
  q.set("su", draft.subject);
  q.set("body", draft.body);
  return `https://mail.google.com/mail/?${q.toString()}`;
}
