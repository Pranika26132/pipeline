import Anthropic from "@anthropic-ai/sdk";

import { API_KEY_MESSAGE } from "../redact";
import { BadModelOutputError } from "./extract";

// Messages from the Anthropic client can quote request details (a malformed
// key ended up in one), so only fixed messages are returned, never e.message.
export function describeModelError(e: unknown): string {
  if (e instanceof BadModelOutputError) return `${e.message} The company was kept as it was; try again.`;
  if (e instanceof Anthropic.AuthenticationError) return API_KEY_MESSAGE;
  if (e instanceof Anthropic.PermissionDeniedError) return "The Claude API key isn't allowed to use this model.";
  if (e instanceof Anthropic.RateLimitError) return "Too many lookups at once. Wait a minute and try again.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The Claude API took too long to answer. Try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Try again.";
  if (e instanceof Anthropic.APIError) {
    return `The Claude API returned an error (status ${e.status ?? "unknown"}). Try again.`;
  }
  const name = e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? ` (${e.name})` : "";
  return `The lookup failed unexpectedly${name}. Try again.`;
}
