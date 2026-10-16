import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { describeModelError } from "./enrich/errors";
import { describeFetchError } from "./enrich/safe-fetch";
import { API_KEY_MESSAGE, isWellFormedApiKey, REDACTED, redactSecrets } from "./redact";

// Made-up keys only. Never put a real key in a test.
const FAKE = "sk-ant-api03-FAKEfakeFAKEfake_0123456789-abcdefABCDEF";

describe("redactSecrets", () => {
  it("removes a key quoted in an HTTP client error", () => {
    // The message Node's Headers.append threw for a key with a newline in it.
    const message = `Headers.append: "${FAKE}\nsk-ant-SECONDLINE" is an invalid header value.`;
    const out = redactSecrets(message);
    expect(out).not.toContain("sk-ant");
    expect(out).not.toContain("FAKEfake");
    expect(out).toContain(REDACTED);
  });

  it("removes every key-shaped string, in any case", () => {
    const out = redactSecrets(`first ${FAKE} then SK-ANT-UPPER123 and (sk-ant-x).`);
    expect(out).toBe(`first ${REDACTED} then ${REDACTED} and (${REDACTED}).`);
  });

  it("removes each line of the configured secret even if it isn't key-shaped", () => {
    const configured = "  not-a-key-but-secret-123\nsecond-line-of-secret-456  ";
    const out = redactSecrets("a not-a-key-but-secret-123 b second-line-of-secret-456 c", [configured]);
    expect(out).toBe(`a ${REDACTED} b ${REDACTED} c`);
  });

  it("leaves ordinary text alone and ignores short or missing secrets", () => {
    const text = "example.com: the site answered 404.\nNo team members were named.";
    expect(redactSecrets(text, [undefined, "", "the"])).toBe(text);
  });
});

describe("isWellFormedApiKey", () => {
  it("accepts a trimmed, single-line key", () => {
    expect(isWellFormedApiKey(FAKE)).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["trailing newline", `${FAKE}\n`],
    ["leading space", ` ${FAKE}`],
    ["two lines", `${FAKE}\n${FAKE}`],
    ["wrapped in quotes", `"${FAKE}"`],
    ["smart quotes", `“${FAKE}”`],
    ["wrong prefix", "sk-proj-0123456789abcdef0123"],
    ["too short", "sk-ant-abc"],
  ])("rejects a key that is %s", (_, key) => {
    expect(isWellFormedApiKey(key)).toBe(false);
  });
});

describe("describeModelError", () => {
  it("never repeats the message of an unexpected error", () => {
    const out = describeModelError(new TypeError(`Headers.append: "${FAKE}" is an invalid header value.`));
    expect(out).toBe("The lookup failed unexpectedly (TypeError). Try again.");
  });

  it("maps a rejected key to the fixed key message", () => {
    const e = new Anthropic.AuthenticationError(401, { message: FAKE }, `401 ${FAKE}`, new Headers());
    expect(describeModelError(e)).toBe(API_KEY_MESSAGE);
  });

  it("gives only the status for other API errors", () => {
    const e = new Anthropic.InternalServerError(500, { message: FAKE }, `500 ${FAKE}`, new Headers());
    expect(describeModelError(e)).toBe("The Claude API returned an error (status 500). Try again.");
  });
});

describe("describeFetchError", () => {
  it("never repeats a raw Node error message", () => {
    const e = Object.assign(new Error(`getaddrinfo ENOTFOUND ${FAKE}.example`), { code: "ENOTFOUND" });
    expect(describeFetchError(e)).toBe("The site's address couldn't be found.");
    expect(describeFetchError(new Error(FAKE))).toBe("The page couldn't be read.");
  });
});
