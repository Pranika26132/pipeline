export type NormalizedUrl =
  | { ok: true; url: string; domain: string }
  | { ok: false; error: string };

// Turns what a user pasted ("Acme.com", "https://www.acme.com/about") into a
// full URL and the lowercase host without "www." used to dedupe companies.
export function normalizeCompanyUrl(input: string): NormalizedUrl {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, error: "No link given." };
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

  let host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) {
    return { ok: false, error: "Use the company's website address, like acme.com." };
  }

  return { ok: true, url: parsed.href, domain: host };
}
