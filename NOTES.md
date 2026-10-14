# Notes

## Finished (branch `setup/scaffold`, 2026-10-14)
- Scaffolded Next.js 16.4.0 (App Router, TypeScript, Tailwind 4) with create-next-app.
- Replaced the template homepage with a plain "Pipeline" heading, set page metadata, removed the demo SVGs.
- Reviewed the branch against SPEC.md and CLAUDE.md: no secrets in any commit, `.env*` is gitignored, build and lint pass, `npm audit` reports 0 vulnerabilities, no dependencies beyond the scaffold.
- Removed the Arial `font-family` override in `app/globals.css` so the Geist font applies.

## Decisions
- No test runner yet. Add vitest with the scoring step (CLAUDE.md updated to say so).
- Use Geist as the font (removed the Arial override rather than dropping the Geist imports).

## Open questions
- Supabase tables with RLS, auth, and the Vercel deploy are part of the first step in SPEC.md but are not on this branch. Do they go on separate branches, or should this branch cover them before its PR?
- README.md is still the create-next-app text. Replace it, and with what?
- `.env*` in `.gitignore` also blocks a committed `.env.example`. Add `!.env.example` if we want one.
- No PR opened for `setup/scaffold` yet.
