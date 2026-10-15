import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

// Fetches public web pages for enrichment without letting a company URL reach
// internal services (SSRF). Every connection goes through `safeLookup`, so the
// address that is checked is the address that is dialed, and DNS rebinding
// between check and connect is not possible.

export const USER_AGENT = "PipelineBot/0.1 (student internship research; reads public pages only)";
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

// Sites we never fetch (CLAUDE.md: never scrape LinkedIn).
const FORBIDDEN_HOSTS = ["linkedin.com", "lnkd.in"];

// Separate lists: one BlockList matches IPv4 addresses against IPv4-mapped
// IPv6 rules, so "::ffff:0:0/96" there would block every IPv4 address.
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  // Unspecified, loopback and IPv4-compatible (::a.b.c.d) addresses.
  ["::", 96],
  // IPv4-mapped, NAT64 and 6to4 addresses can wrap a private IPv4 address.
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(addr, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

export class FetchBlockedError extends Error {}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 4);
      return;
    }
    const bad = addresses.find((a) => !isPublicAddress(a.address));
    if (bad || addresses.length === 0) {
      callback(new FetchBlockedError(`${hostname} points to a private or reserved address.`), "", 4);
      return;
    }
    if ((options as dns.LookupOptions).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

function checkUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchBlockedError("Only http and https links can be fetched.");
  }
  if (url.username || url.password) {
    throw new FetchBlockedError("Links with a username or password can't be fetched.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new FetchBlockedError("Only standard web ports can be fetched.");
  }
  // "linkedin.com." is the same host as "linkedin.com".
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.+$/, "");
  // IP literals skip DNS lookup, so check them directly.
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new FetchBlockedError("That address is private or reserved.");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchBlockedError("That address is private.");
  }
  if (FORBIDDEN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new FetchBlockedError("LinkedIn pages are never fetched.");
  }
}

export type FetchedPage = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

export type FetchOptions = {
  accept?: string;
  // Runs before every request, including each redirect hop; throw to stop.
  beforeRequest?: (url: URL) => Promise<void>;
};

// GET a URL with a timeout, a size cap, and manual redirect handling.
// Resolves for any HTTP status; rejects on blocked targets and network errors.
export async function safeFetch(input: string, options: FetchOptions = {}): Promise<FetchedPage> {
  const accept = options.accept ?? "text/html,text/plain";
  let url = new URL(input);
  const deadline = Date.now() + TIMEOUT_MS;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    checkUrl(url);
    await options.beforeRequest?.(url);
    const res = await request(url, accept, deadline);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = new URL(res.location, url);
      continue;
    }
    return { url: url.href, status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new Error("Too many redirects.");
}

type RawResponse = { status: number; contentType: string; location?: string; body: string };

function request(url: URL, accept: string, deadline: number): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error("Timed out."));
      return;
    }
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        headers: {
          "user-agent": USER_AGENT,
          accept,
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        res.on("error", reject);
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          resolve({ status, contentType, location: res.headers.location, body: "" });
          return;
        }
        if (status >= 400) {
          res.resume();
          resolve({ status, contentType, body: "" });
          return;
        }

        let stream: NodeJS.ReadableStream = res;
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());

        // Keeps the first MAX_BYTES of decompressed text and stops downloading,
        // so a huge page or a small compressed bomb can't exhaust memory.
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          if (size + chunk.length >= MAX_BYTES) {
            chunks.push(chunk.subarray(0, MAX_BYTES - size));
            size = MAX_BYTES;
            resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
            req.destroy();
            return;
          }
          size += chunk.length;
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        stream.on("error", reject);
      },
    );
    // A hard deadline for the whole exchange, not just idle time, so a server
    // that trickles bytes can't hold the request open.
    const timer = setTimeout(() => req.destroy(new Error("Timed out.")), remaining);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}
