# Pipeline
Web app for finding startups and small firms to cold-email for tech/quant internships, scoring them (alumni, hometown, open roles), and drafting emails the user reviews and sends. See SPEC.md.

## Commands
- Run: npm run dev
- Test: npm test (vitest)
- Build/typecheck: npm run build

## Stack
Next.js (App Router, TypeScript), Supabase (auth, Postgres), Vercel, Claude API from server routes only.

## Rules
- Phone first. Large tap targets.
- RLS on every table, scoped to user_id = auth.uid(). Show me each policy you write.
- Secret keys and the Claude API key never go in client code or the repo. Only NEXT_PUBLIC_ variables reach the browser.
- Never guess a person's school, hometown, or email. If it is not on a source page, leave it empty.
- The app never sends email. Drafts only.
- Do not scrape LinkedIn or sites that forbid it.
- Show every error to the user. Do not log and continue.
- Draft emails: under 120 words, no stock phrases, only facts from enrichment or the user's profile.
- Visual design: follow the frontend-design skill. No purple gradients, no three-icon feature row, no emoji icons, no invented stats or placeholder copy.
- Ask before adding a dependency, and check it exists.
- One branch per step, small commits, open a PR with a clear description.
