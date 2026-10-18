import { describeFetchError, safeFetch, USER_AGENT } from "./safe-fetch";

const MAX_PAGES = 5;
const MAX_TEXT_PER_PAGE = 15_000;

export type PageText = { url: string; text: string };

export type CollectResult = {
  pages: PageText[];
  // Plain-language notes on pages that couldn't be read, shown to the user.
  problems: string[];
};

// Link paths that usually hold what enrichment needs.
const WANTED = [
  { pattern: /\/(about|about-us|company|our-story|mission)(\/|$)/i, guess: "/about" },
  { pattern: /\/(team|our-team|people|founders|leadership)(\/|$)/i, guess: "/team" },
  { pattern: /\/(careers|jobs|join|join-us|work-with-us|hiring)(\/|$)/i, guess: "/careers" },
] as const;

// A page skipped on purpose (robots.txt, another site). Always reported.
class SkipError extends Error {}

// Reads the homepage, then the about, team and careers pages it links to
// (or the usual paths when it links to none), honoring each host's robots.txt.
export async function collectPages(startUrl: string, domain: string): Promise<CollectResult> {
  const problems: string[] = [];
  const home = new URL(startUrl);
  home.pathname = "/";
  home.search = "";
  home.hash = "";

  const robotsByHost = new Map<string, Promise<Robots>>();
  const robotsFor = (url: URL) => {
    const key = url.origin;
    if (!robotsByHost.has(key)) robotsByHost.set(key, loadRobots(url));
    return robotsByHost.get(key)!;
  };

  // Checked before the first request and before every redirect hop, so an
  // off-site or disallowed page is never downloaded.
  async function beforeRequest(url: URL) {
    if (!onDomain(url.hostname, domain)) {
      throw new SkipError(`leads to ${url.hostname}, a different site, so it was skipped.`);
    }
    const robots = await robotsFor(url);
    if (robots.error) throw new SkipError(robots.error);
    if (!robots.allows(url.pathname + url.search)) {
      throw new SkipError("the site's robots.txt asks bots not to read it.");
    }
  }

  const pages: PageText[] = [];
  const seen = new Set<string>();

  // `guessed` pages are paths we tried without a link; a 404 there is normal.
  async function read(url: URL, guessed: boolean): Promise<string | null> {
    const key = url.href.replace(/\/$/, "");
    if (seen.has(key)) return null;
    seen.add(key);
    try {
      const res = await safeFetch(url.href, { beforeRequest });
      if (res.status >= 400) {
        if (!(guessed && (res.status === 404 || res.status === 410))) {
          problems.push(`${url.href}: the site answered ${res.status}.`);
        }
        return null;
      }
      if (!res.contentType.includes("text/html") && !res.contentType.includes("text/plain")) {
        problems.push(`${url.href}: not a web page (${res.contentType || "unknown type"}).`);
        return null;
      }
      if (pages.length >= MAX_PAGES) return null;
      pages.push({ url: res.url, text: htmlToText(res.body).slice(0, MAX_TEXT_PER_PAGE) });
      return res.body;
    } catch (e) {
      // Only our own messages are shown, never a raw Node error.
      problems.push(`${url.href}: ${e instanceof SkipError ? e.message : describeFetchError(e)}`);
      return null;
    }
  }

  const homeHtml = await read(home, false);
  const links = homeHtml ? extractLinks(homeHtml, home, domain) : [];

  // One page of each kind first, so careers is never crowded out by two
  // about pages; second links of a kind fill any room left.
  const first: { url: URL; guessed: boolean }[] = [];
  const extra: { url: URL; guessed: boolean }[] = [];
  for (const want of WANTED) {
    const found = links.filter((l) => want.pattern.test(l.pathname));
    if (found.length === 0) {
      first.push({ url: new URL(want.guess, home), guessed: true });
    } else {
      first.push({ url: found[0], guessed: false });
      if (found[1]) extra.push({ url: found[1], guessed: false });
    }
  }
  const targets = [...first, ...extra].slice(0, MAX_PAGES - 1);
  await Promise.all(targets.map((t) => read(t.url, t.guessed)));

  return { pages, problems };
}

// Reads only a site's home page, with the same checks as collectPages
// (robots.txt, same site on every redirect hop). Used by Find to confirm a
// company's website responds and to see what it says. Resolves to the text,
// or to a plain reason it couldn't be read.
// A redirect to another site (a company that moved to a new domain) comes
// back as `movedTo`, so the caller can check that site instead.
export async function readHomePage(
  startUrl: string,
  domain: string,
): Promise<{ page: PageText } | { problem: string } | { movedTo: string }> {
  const home = new URL(startUrl);
  home.pathname = "/";
  home.search = "";
  home.hash = "";
  const robotsByHost = new Map<string, Promise<Robots>>();
  try {
    const res = await safeFetch(home.href, {
      async beforeRequest(url) {
        if (!onDomain(url.hostname, domain)) throw new MovedError(url.href);
        if (!robotsByHost.has(url.origin)) robotsByHost.set(url.origin, loadRobots(url));
        const robots = await robotsByHost.get(url.origin)!;
        if (robots.error) throw new SkipError(robots.error);
        if (!robots.allows(url.pathname + url.search)) throw new SkipError("Its robots.txt asks bots not to read it.");
      },
    });
    if (res.status >= 400) return { problem: `The site answered ${res.status}.` };
    if (!res.contentType.includes("text/html") && !res.contentType.includes("text/plain")) {
      return { problem: `It isn't a web page (${res.contentType || "unknown type"}).` };
    }
    const text = htmlToText(res.body).slice(0, MAX_TEXT_PER_PAGE);
    if (!text.trim()) return { problem: "Its home page has no readable text." };
    return { page: { url: res.url, text } };
  } catch (e) {
    if (e instanceof MovedError) return { movedTo: e.message };
    return { problem: e instanceof SkipError ? e.message : describeFetchError(e) };
  }
}

class MovedError extends Error {}

function onDomain(host: string, domain: string) {
  const h = host.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}

function extractLinks(html: string, base: URL, domain: string): URL[] {
  const out = new Map<string, URL>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), base);
      if ((u.protocol === "https:" || u.protocol === "http:") && onDomain(u.hostname, domain)) {
        u.hash = "";
        out.set(u.href, u);
      }
    } catch {
      // Not a usable link; skip it.
    }
  }
  return [...out.values()];
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return safeChar(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return safeChar(parseInt(lower.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[lower] ?? "";
  });
}

function safeChar(code: number) {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

// robots.txt ------------------------------------------------------------------

type Robots = { allows: (path: string) => boolean; error?: string };

async function loadRobots(origin: URL): Promise<Robots> {
  const allowAll: Robots = { allows: () => true };
  const robotsUrl = new URL("/robots.txt", origin);
  let body: string;
  try {
    // No beforeRequest hook here: it would need robots.txt itself. safeFetch
    // still blocks private addresses and LinkedIn on every hop.
    const res = await safeFetch(robotsUrl.href, { accept: "text/plain" });
    // No robots.txt (4xx) means no restrictions.
    if (res.status >= 400 && res.status < 500) return allowAll;
    if (res.status >= 500) {
      return { allows: () => false, error: `${origin.host}'s robots.txt couldn't be read (${res.status}), so its pages were not fetched.` };
    }
    body = res.body;
  } catch (e) {
    return { allows: () => false, error: `${origin.host} couldn't be reached. ${describeFetchError(e)}` };
  }
  const rules = parseRobots(body);
  return { allows: (path) => isAllowed(rules, path) };
}

type Rule = { allow: boolean; path: string };

// Picks the most specific group: one naming our bot, else "*".
export function parseRobots(text: string): Rule[] {
  const ourAgent = USER_AGENT.split("/")[0].toLowerCase();
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      if (value) current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const ours = groups.filter((g) => g.agents.some((a) => a !== "*" && ourAgent.includes(a)));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

// Longest matching rule wins; Allow wins a tie. Supports * and $.
// `path` includes the query string, so rules like "Disallow: /*?" apply.
export function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (matches(rule.path, path) && (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow))) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}
