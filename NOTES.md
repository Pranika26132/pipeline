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
- Supabase dashboard: Site URL and the `/auth/confirm` redirect URLs are set (done).

## Finished (branch `setup/database`, 2026-10-14)
- Migration `supabase/migrations/20261014200135_create_core_tables.sql`, applied through the Supabase MCP (remote version matches the filename).
- Tables `profiles`, `companies`, `contacts`, `outreach`. `user_id` defaults to `auth.uid()` and cascades on user delete. `companies.domain` is required and lowercase, unique per user.
- RLS on all four, separate select/insert/update/delete policies for `authenticated`. contacts/outreach inserts and updates also check the company (and contact) belong to the user, and outreach's contact belongs to that company. `anon` has no grants.
- Composite foreign keys stop bad links even for the service role: contacts and outreach `(company_id, user_id)` -> companies, and outreach `(contact_id, company_id, user_id)` -> contacts, so an outreach row's contact belongs to the same user and the same company. A contact cannot move to another company while outreach rows point at it; deleting a contact clears `contact_id` and keeps the outreach row.
- Tested as two simulated users in SQL (rolled back, test users deleted): B saw 0 of A's rows, changed and deleted 0, and every insert/update pointing at A's data was rejected.
- Security advisor: only "Leaked Password Protection disabled" (dashboard setting, not SQL).
- Migration `20261014203854_harden_grants_and_outreach_contact.sql`: revoked TRUNCATE (it ignores RLS), REFERENCES and TRIGGER from `anon` and `authenticated`, and added the outreach-contact-company foreign key above.
- Reran the two-user test for contacts and outreach (one transaction, rolled back, no test rows or users left): B saw, changed and deleted 0 of A's rows; every insert/update pointing at A's data and B's TRUNCATE were rejected; A could not link a contact to an outreach row for a different company or move a referenced contact, and the service-role equivalent was rejected by the foreign key too.

## Finished (branch `feature/add-company`, 2026-10-14)
- `/add`: paste one link (optional name, defaults to the domain) or import a CSV with `name` and `url` headers (case-insensitive; other columns ignored). Linked from `/`.
- `lib/domain.ts` normalizes to a lowercase host without `www.` (bare `acme.com` gets https). Rejects non-http(s) schemes, user:password links, IPs, `localhost`, malformed hostnames, LinkedIn, and directory/job-board hosts (YC, Work at a Startup, Wellfound, Lever, Greenhouse, Ashby, etc.), because those would collapse many companies into one domain.
- `lib/csv.ts`: small in-repo parser (quotes, multi-line fields, CRLF, BOM) instead of a dependency. Reports the file's real line numbers.
- Dedupe on domain within the file and against the user's saved rows; the `(user_id, domain)` unique constraint catches races. Results show added / already saved / skipped per row with the reason.
- `source` is `link` or `csv:<filename>`. No schema change; existing `companies` RLS policies cover it.
- Limits: 500 KB and 500 rows per CSV (server actions cap bodies at 1 MB), names 200 characters.
- Fresh-context review: no security issues. Fixed: directory URLs collapsing to one domain, invalid hostnames breaking the duplicate lookup, line-number drift, auth checked after parsing, stale error after picking a new file, uncapped names.

## Finished (branch `feature/list`, 2026-10-14)
- `/` is the target list: the user's companies newest first (same-import ties A to Z), up to 500 with "Showing the newest 500 of N" past that. Each row links to `/company/[id]` and shows a "Needs info" flag. Empty state points to Add companies. Signed-in email and Sign out moved to a footer at the bottom.
- `/company/[id]`: name, website link, About (summary, stage, size, source, added date in the viewer's time zone), People (contacts with title, school, hometown, email, source link). Missing fields say "Unknown" or "Not looked up yet". Malformed or other users' ids show a not-found page (RLS returns no row).
- Stored URLs are only rendered as links if they are http(s); external links use `noopener noreferrer`.
- Fresh-context review: no cross-user leak or security issue. Fixed: rows from one CSV import showed in random order.
- Known and left: the not-found page returns HTTP 200 because it renders inside Suspense after streaming starts (Next docs); the list runs an exact count each load. Both fine at this scale.

## Finished (branch `feature/enrich`, 2026-10-15)
- `ANTHROPIC_API_KEY` was set by the user in `.env.local` and Vercel (Production + Preview). `.env.example` lists the name with no value. A scan of `.next/static` found no key, model id or `ANTHROPIC` string in client bundles.
- Added `@anthropic-ai/sdk` 0.134.0 (user approved). Model `claude-haiku-5-5`, effort `low`, structured output via `output_config.format` (plain JSON schema, no zod). 25 s timeout, no retries.
- Migrations, applied through the Supabase MCP (remote versions match the filenames):
  - `20261015220416_add_enrichment_columns.sql` adds `companies.open_roles` (jsonb array), `field_sources` (jsonb object), `enriched_at` and `enrich_error`.
  - `20261015222809_unique_contact_name_per_company.sql` adds a unique index on `contacts (company_id, lower(btrim(name)))`.
  - No new tables or policies; the existing per-user RLS policies cover both.
- `lib/enrich/safe-fetch.ts` (SSRF guard):
  - Only http/https on ports 80/443; no credentials in the URL; trailing dots are stripped before host checks.
  - Blocks LinkedIn, localhost/.local/.internal names, and private/reserved IPv4 and IPv6 ranges, including `::/96`, IPv4-mapped, NAT64 and 6to4 addresses.
  - The address check runs in the socket's own DNS lookup, so DNS rebinding can't get past it.
  - Redirects are followed by hand (at most 3). Every hop is re-checked and passes through a `beforeRequest` hook.
  - 8 s hard deadline per page. Pages are cut off at 1 MB of decompressed text.
- `lib/enrich/pages.ts`:
  - robots.txt is read per host and checked on every hop, including redirects. Rules match path and query string, and empty `User-agent` lines are ignored.
  - Off-site redirects stop before anything downloads.
  - Reads the home page, then one about, team and careers page each (linked from the home page, else `/about`, `/team` or `/careers`), then second links if there's room, up to 5 pages.
  - Every failure is reported, except a 404/410 on a guessed path.
- `lib/enrich/extract.ts`:
  - Page text is untrusted data and can't close or forge the `<page>` wrapper.
  - Every fact must cite a page we fetched. Names and role titles must appear on that page as whole words.
  - A school or hometown is kept only if the model quotes a sentence that is on the page, names the person, and contains that school or hometown as whole words.
- `POST /api/companies/[id]/enrich`:
  - Origin must match the host (a malformed Origin gets a 403), then auth. Uses the user's own Supabase client (RLS), no service key.
  - Checks the UUID. Claims the run with an atomic conditional update on `enriched_at`; the cooldown is 60 s, as long as `maxDuration`.
  - A re-run fills in or updates summary, stage, size, sources and roles but never blanks one an earlier run found.
  - `needs_manual_info` is true while the company has no contacts. New contacts are inserted; existing ones are left alone.
  - If nothing can be read: flags the company and saves the reasons. If the model output is bad: keeps the row and saves and shows the error.
- The proxy answers signed-out `/api/*` calls with a JSON 401 that keeps session cookies; pages still redirect to `/login`.
- `/company/[id]`:
  - A "Look up company" / "Look up again" button with pending, success and error states, followed by a refresh.
  - The last lookup time, notes from the last lookup, a source link on summary, stage and size, and an Open roles section.

Verified:
- **SSRF and robots (by script):**
  - Blocked: 127.0.0.1, localhost:3000, 169.254.169.254, [::1], [::ffff:127.0.0.1], [::127.0.0.1], 10.0.0.1, file:, ftp:, linkedin.com and `linkedin.com.`, port 8080, 127.0.0.1.nip.io, localtest.me, and an httpbin redirect to 169.254.169.254.
  - Allowed: example.com and 8.8.8.8.
  - robots.txt precedence, empty user-agent lines and query-string rules behave correctly.
- **Live runs:**
  - oxide.computer: 3 pages, a summary and 16 roles with sources, in about 5 s.
  - posthog.com: renders with JavaScript, so only a summary came back.
- **Injection tests on synthetic pages:** a stated school and hometown were kept. An unstated one stayed null. An injected extra person was ignored. "Offices in New York" and the word "submit" were not attached to anyone.
- **Route guards (curl):** signed-out POSTs get a JSON 401; signed-out pages still redirect to sign-in.
- **Supabase advisors:** nothing new (only the known Leaked Password Protection setting, plus an unused-index note because no contacts exist yet).

Fresh-context review fixes:
- The school/hometown check was a plain substring match ("MIT" matched "submit").
- The time budget could exceed 60 s.
- The cooldown wasn't atomic, and contact names weren't unique.
- A re-run blanked earlier facts.
- A malformed Origin crashed the route.
- An exception while reading pages skipped the needs-info save.
- Careers could be crowded out of the page set.
- robots.txt was checked on only one host, and not on redirects.
- An empty User-agent line was misread.
- Trailing-dot hosts got past the name checks.
- `::/96` wasn't blocked.
- Real failures on guessed paths were dropped silently.
- The API 401 dropped session cookies.

Known limits:
- Sites rendered with JavaScript give little text and usually end up flagged "needs info". A headless browser would be a new dependency; ask first.
- A sentence on the company's own page that names a person and a school counts as stated, even if the site planted it.
- A failed lookup also starts the 60 s cooldown.
- The proxy returns 401 for every `/api/*` path. A future webhook or cron route would need an exception.

## Decisions
- Supabase tables with RLS go on `setup/database`. The Vercel deploy was done on main in step 8 (live at pipeline-three-delta.vercel.app).
- Confirm email is off in Supabase, so a new sign-up is logged in directly. Sign-up keeps the neutral message for an existing email, even though it differs from a new sign-up's response.
- No test runner yet. Add vitest with the scoring step (CLAUDE.md updated to say so).
- Use Geist as the font (removed the Arial override rather than dropping the Geist imports).

## Open questions
- README.md is still the create-next-app text. Replace it, and with what?
- `npm audit`: 5 high (`braces` through `eslint-config-next`, dev only). The suggested fix downgrades to eslint-config-next 14, so it is not applied.
- Leaked Password Protection: Requires a paid Supabase plan; left off on the free tier.
- No column for score weights yet. Add with the scoring step.
