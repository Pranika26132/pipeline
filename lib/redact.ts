// Keeps secrets out of anything shown to the user or saved to the database.
// Pure (no imports) so it can be tested on its own.

export const API_KEY_MESSAGE = "Claude API key is missing or invalid — check ANTHROPIC_API_KEY.";

export const REDACTED = "[redacted]";

// Anthropic keys start with "sk-ant-". Everything up to the next whitespace,
// quote or bracket goes (a trailing comma or period too), so a malformed key
// is covered and too much is removed rather than too little.
const KEY_PATTERN = /sk-ant-[^\s"'`<>()[\]{}]*/gi;

// A well-formed key: trimmed, one line, only the characters real keys use.
export function isWellFormedApiKey(key: string | undefined): key is string {
  return typeof key === "string" && /^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key);
}

// Removes anything shaped like an Anthropic key, plus each line of the given
// secrets (the configured key, which may be malformed and not look like one).
export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    for (const part of (secret ?? "").split(/[\r\n]+/)) {
      const piece = part.trim();
      // Short fragments would wipe out ordinary words.
      if (piece.length >= 12) out = out.split(piece).join(REDACTED);
    }
  }
  return out.replace(KEY_PATTERN, REDACTED);
}
