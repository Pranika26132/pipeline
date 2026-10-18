export type NormalizedUrl =
  | { ok: true; url: string; domain: string }
  | { ok: false; error: string };

export const URL_MAX_LENGTH = 2048;

// Sites we must not fetch (CLAUDE.md: never scrape LinkedIn).
const FORBIDDEN_HOSTS = ["linkedin.com", "lnkd.in"];

// Directories and job boards host pages for many companies under one domain,
// so a row pointing at them would dedupe every company into one. The user
// needs the company's own website instead.
const DIRECTORY_HOSTS = [
  "ycombinator.com",
  "workatastartup.com",
  "wellfound.com",
  "angel.co",
  "crunchbase.com",
  "lever.co",
  "greenhouse.io",
  "ashbyhq.com",
  "workable.com",
  "glassdoor.com",
  "indeed.com",
  "joinhandshake.com",
  "builtin.com",
  "github.com",
  "twitter.com",
  "x.com",
];

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

function onHost(host: string, list: string[]) {
  return list.find((h) => host === h || host.endsWith(`.${h}`));
}

// Turns what a user pasted ("Acme.com", "https://www.acme.com/about") into a
// full URL and the lowercase host without "www." used to dedupe companies.
export function normalizeCompanyUrl(input: string): NormalizedUrl {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, error: "No link given." };
  }
  if (raw.length > URL_MAX_LENGTH) {
    return { ok: false, error: "That link is too long." };
  }

  // Bare domains like "acme.com" have no scheme; assume https. A colon
  // followed by digits is a port ("acme.com:8080"), not a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) {
    return { ok: false, error: "Only http and https links can be added." };
  }

  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That isn't a valid link." };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: "Links with a username or password can't be added." };
  }

  // URL() lowercases the host and converts non-ASCII names to punycode.
  let host = parsed.hostname.replace(/\.$/, "");
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  if (!HOSTNAME.test(host) || /^[\d.]+$/.test(host)) {
    return { ok: false, error: "Use the company's website address, like acme.com." };
  }

  const forbidden = onHost(host, FORBIDDEN_HOSTS);
  if (forbidden) {
    return { ok: false, error: `${forbidden} links can't be used. Use the company's own website.` };
  }
  const directory = onHost(host, DIRECTORY_HOSTS);
  if (directory) {
    return {
      ok: false,
      error: `That's a page on ${directory}, not the company's own site. Use the company's website instead.`,
    };
  }

  return { ok: true, url: parsed.href, domain: host };
}

// "turbo.ai", "www.turbo.ai" or "turbo": a company name taken from its
// website rather than a real name.
export function looksLikeDomain(name: string, domain: string): boolean {
  const n = name.trim().toLowerCase().replace(/^www\./, "");
  return n === domain || n === domain.split(".")[0] || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(n);
}

// A readable name from a website when the pages don't state one: drop the
// ending and capitalize ("oxide.computer" → "Oxide", "acme-labs.com" →
// "Acme Labs"). A ".ai" ending is part of how such names are said
// ("turbo.ai" → "Turbo AI").
export function nameFromDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/^www\./, "").split(".");
  const tld = parts.length > 1 ? parts.pop()! : "";
  const words = parts[parts.length - 1].split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (tld === "ai") words.push("AI");
  return words.join(" ") || domain;
}

// The name to show and to write drafts with: the saved name, or a readable
// one from the website when the saved name is just the website.
export function displayName(name: string, domain: string): string {
  return looksLikeDomain(name, domain) ? nameFromDomain(domain) : name;
}
