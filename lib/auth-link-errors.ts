// Errors from the sign-up confirmation link reach /login as ?error=<code>.
// Only these codes are shown, in our own wording. Never show raw query text.
export const LINK_ERRORS = {
  link_expired:
    "That confirmation link has expired. Create your account again to get a new link.",
  link_invalid:
    "That confirmation link didn't work. Sign in, or create your account again to get a new link.",
  link_other_browser:
    "That confirmation link didn't work here. Open it in the browser you signed up in, or sign in.",
  link_missing:
    "That confirmation link is missing its token. Open the link from the email again.",
} as const;

export type LinkErrorCode = keyof typeof LINK_ERRORS;

export function linkErrorMessage(code: unknown): string | undefined {
  return typeof code === "string" && Object.hasOwn(LINK_ERRORS, code)
    ? LINK_ERRORS[code as LinkErrorCode]
    : undefined;
}
