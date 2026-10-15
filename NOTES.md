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

## In progress (branch `feature/enrich`, WIP, paused 2026-10-15)
Pushed as WIP. No PR yet. Build and lint pass.

Done:
- `ANTHROPIC_API_KEY` set by the user in `.env.local` and Vercel (Production + Preview). `.env.example` lists the name with no value. A scan of `.next/static` found no key, model id or `ANTHROPIC` string in client bundles.
- Added `@anthropic-ai/sdk` 0.134.0 (user approved). Model `claude-haiku-5-5`, effort `low`, structured output via `output_config.format` (plain JSON schema, no zod).
- Migration `20261015220416_add_enrichment_columns.sql`, applied through the Supabase MCP (remote version matches the filename). It adds `companies.open_roles` (jsonb array), `field_sources` (jsonb object), `enriched_at` and `enrich_error`. There are no new tables or policies; the existing `companies` RLS policies cover these columns.
- `lib/enrich/safe-fetch.ts`:
  - Only http/https on ports 80/443; no credentials in the URL.
  - Blocks LinkedIn, localhost/.local/.internal names, and private/reserved IPv4 and IPv6 ranges, including IPv4-mapped, NAT64 and 6to4 addresses.
  - The address check runs in the socket's own DNS lookup, so DNS rebinding can't get past it.
  - Redirects are followed by hand (at most 3) and re-checked at every hop.
  - 8 s hard deadline per page. Pages are cut off at 1 MB of decompressed text (gzip, deflate, br).
- `lib/enrich/pages.ts`:
  - Reads robots.txt (a PipelineBot group, else `*`; longest match wins). A missing robots.txt allows everything; a 5xx or unreachable one blocks the fetch.
  - Reads the home page, then up to 4 about/team/careers pages it links to on the same domain, falling back to guessing `/about`, `/team` and `/careers`.
  - Turns HTML into text, capped at 15k characters per page.
- `lib/enrich/extract.ts`:
  - The system prompt treats page text as untrusted data, and the text can't close or forge the `<page>` wrapper.
  - The code checks every fact: its source_url must be a page we fetched. Role titles, names, schools and hometowns must appear word for word on that page or they're dropped.
  - Bad JSON, refusal or a cut-off answer raise `BadModelOutputError`.
- `POST /api/companies/[id]/enrich`:
  - Checks that Origin matches the host, then auth; uses the user's own Supabase client (RLS), no service key.
  - Checks the UUID, then a 20 s cooldown using `enriched_at`.
  - Saves summary, stage, size, `field_sources`, `open_roles`, `needs_manual_info` (true when no people were found) and `enrich_error`.
  - Inserts new contacts only; existing contacts are left alone, and duplicate names are skipped.
  - If no pages could be read, sets `needs_manual_info` and saves the reasons. If the model output is bad, it keeps the row, saves the error and shows it. `maxDuration` is 60.
- `/company/[id]` additions:
  - A "Look up company" button with pending, success and error states, followed by a refresh.
  - The last lookup time, notes from the last lookup, a source link on summary, stage and size, and an Open roles section.

Verified by script (not in the browser yet):
- Blocked: 127.0.0.1, localhost:3000, 169.254.169.254, [::1], [::ffff:127.0.0.1], 10.0.0.1, file:, ftp:, linkedin.com, port 8080, 127.0.0.1.nip.io, localtest.me, and an httpbin redirect to 169.254.169.254.
- Allowed: example.com and 8.8.8.8.
- robots.txt Allow/Disallow precedence works.
- A live run on posthog.com read 4 pages and returned a summary in about 4 s. Its pages are rendered with JavaScript, so no people or roles came back.

Fixed during the build:
- One BlockList blocked every IPv4 address because of the `::ffff:0:0/96` rule; IPv4 and IPv6 now use separate lists.
- Pages over 1 MB were thrown away; they're now cut off at 1 MB.
- The model summarized the pages' gaps instead of returning null; the prompt now says to return null.

Left to do:
1. Live test on a server-rendered site with a team page and job listings, to check people and roles extraction and the school/hometown check. The paused run was on oxide.computer and modal.com.
2. Test in the browser at localhost: the button, the not-looked-up / success / error states, the bad-JSON path keeping the row, and the cooldown message.
3. Fresh-context subagent review of the branch against SPEC.md and CLAUDE.md, then fix anything real.
4. Run the Supabase security advisor after the migration.
5. Finish this NOTES entry, open the PR, and give the user the hand-test list (localhost and the Vercel preview, including the 60 s function limit there).

Open questions for this step:
- JS-rendered sites (like posthog.com) give little text and will usually be flagged "needs info". Is that acceptable, or should a headless browser be added? A headless browser would be a new dependency.
- `enriched_at` marks the attempt before it finishes, so a failed run also starts the 20 s cooldown.

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
