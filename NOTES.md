# Notes

## Finished (branch `setup/scaffold`, 2026-10-14)
- Scaffolded Next.js 16.4.0 (App Router, TypeScript, Tailwind 4) with create-next-app.
- Replaced the template homepage with a plain "Pipeline" heading, set page metadata, removed the demo SVGs.
- Reviewed the branch against SPEC.md and CLAUDE.md: no secrets in any commit, `.env*` is gitignored, build and lint pass, `npm audit` reports 0 vulnerabilities, no dependencies beyond the scaffold.
- Removed the Arial `font-family` override in `app/globals.css` so the Geist font applies.

## Finished (branch `setup/supabase-auth`, 2026-10-14)
- Added `@supabase/supabase-js` 2.117.3 and `@supabase/ssr` 0.12.7.
- `lib/supabase/client.ts`, `server.ts`, `proxy.ts` and root `proxy.ts`, following the official Supabase SSR guide. The proxy refreshes the session with `getClaims()` and redirects signed-out users to `/login`.
- `/login`: sign in and create account, pending state on the button, plain-language auth errors. `/auth/confirm` handles the sign-up confirmation link.
- `/` shows "Signed in as <email>" and Sign out. `app/error.tsx` shows unexpected errors.
- `.env.example` is committed. `.env.local` stays ignored.
- Fixed `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`: it ended in `/rest/v1/`, which made every auth call 404.
- Confirmation-link errors reach `/login` as a code (`lib/auth-link-errors.ts`) shown in our own wording; raw query text is never shown. Sign-up shows the same neutral message when the email is taken. The proxy allows exactly `/login` and paths under `/auth/`.

## Decisions
- Supabase tables with RLS and the Vercel deploy go on the next branch, not `setup/supabase-auth`.
- No test runner yet. Add vitest with the scoring step (CLAUDE.md updated to say so).
- Use Geist as the font (removed the Arial override rather than dropping the Geist imports).

## Open questions
- README.md is still the create-next-app text. Replace it, and with what?
- Supabase dashboard: set the Site URL and add `/auth/confirm` to the redirect URLs, for localhost and the Vercel domain. Optionally change the "Confirm signup" template to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` so the link also works on another device.
- `npm audit`: 5 high (`braces` through `eslint-config-next`, dev only). The suggested fix downgrades to eslint-config-next 14, so it is not applied.
- No PR opened for `setup/scaffold` yet.
