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

## Security fix: API key leaked into lookup errors (branch `feature/enrich`, 2026-10-16)
- **What happened:** a key with a newline inside it made Node's `Headers.append` throw a `TypeError` that quoted the whole key. The route's catch-all (`Lookup failed: ${e.message}`) showed it on the company page and saved it in `companies.enrich_error`. The user revoked that key and set a new one in `.env.local` and Vercel.
- **Fix:**
  - Anthropic and fetch errors map to fixed messages (`lib/enrich/errors.ts` `describeModelError`, `lib/enrich/safe-fetch.ts` `describeFetchError`); `e.message` from either is never shown or saved. A rejected key shows "Claude API key is missing or invalid — check ANTHROPIC_API_KEY."
  - The route checks the key first (`isWellFormedApiKey`: `sk-ant-`, trimmed, one line, key characters only) and passes it to the client explicitly.
  - `lib/redact.ts` `redactSecrets` removes anything `sk-ant-`-shaped and each line of the configured key. Every error the route returns or saves goes through it, and the company page redacts `enrich_error` again when rendering.
- **Database:** `update companies set enrich_error = null where enrich_error ilike '%sk-ant%'` cleared 2 rows (run through the Supabase MCP; queries returned ids and counts only). No other `companies` column contained `sk-ant`.
- **Tests:** added vitest 4.1.11 (user approved; 5.x needs `@types/node` 22+, the project is on 20). `npm test` runs `lib/redact.test.ts`: redaction, key validation, and that model and fetch errors never repeat their message.
- Fresh-context review: no remaining path where a raw error message reaches the page, the database or the client bundle; real keys pass the format check; no key-shaped string in git history apart from the made-up test key. Its one real issue (rows already holding the key) was already handled by the cleanup above and the key rotation. Added its suggested end-to-end test: a key with a newline really does throw an error quoting it, and the message shown has no key.
- Known limit: pieces of the configured key shorter than 12 characters aren't redacted by exact match (`sk-ant-` shapes always are). Moot while no raw message is shown.
- SPEC.md has a new "Discover" section (HN Who is hiring, Saturday, only if drafts and status are done).

## Finished (branch `feature/profile`, 2026-10-16)
- `/profile`: school, hometown or region, interests (Tech, Quant), internship roles (six presets plus "Other roles", comma-separated), three writing-sample boxes, and the four score weights with "Use the defaults". One Save button in a bar pinned to the bottom on phones.
- Server action `saveProfile` (app/profile/actions.ts): checks the session first, then trims, dedupes and validates against `LIMITS` in `lib/profile.ts`. Upserts on `user_id` taken from the session, never the form. After a save the form shows what was stored; after an error it keeps what was typed. A dropped connection is caught in the browser and shown in the form.
- `/` has a Profile link next to the heading, and a "Your profile is empty" prompt until any field is filled.
- Migrations, applied through the Supabase MCP (remote versions match the filenames):
  - `20261016182041_profile_score_weights.sql`: `weight_school` 3, `weight_hometown` 2, `weight_open_role` 2, `weight_early_stage` 1 (each 0 to 10), `updated_at`, and limits on school/hometown length, allowed interests, and the number of roles (20) and samples (3).
  - `20261016182625_profile_item_lengths.sql`: each writing sample at most 3000 characters and each role at most 80, through `public.max_item_length(text[])` (immutable, empty search_path, execute revoked from anon).
  - No new policies: the existing `profiles: * own` policies (`user_id = auth.uid()`) cover the new columns.
- Tested by script with throwaway users (deleted afterwards): the DB rejects out-of-range weights, unknown interests, 4 samples, long school, long samples and roles; a user can't write a row with another user's id (42501), sees 0 of another user's rows and updates 0; a no-JS form post saved trimmed, deduped values and returned errors for bad input; the home prompt shows when empty and goes away once saved.
- Fresh-context review: no RLS hole or client leak. Fixed: per-item lengths were only checked in the app; an oversized paste or dropped connection replaced the page with the error screen and lost the form; a stale error showed while saving; the form showed untrimmed input after saving; Sample 3 was marked optional though none are required.
- Changed before merge (user request):
  - All three writing samples are optional, with one sentence above them about copying your tone. SPEC.md says drafts use a clear, friendly, professional tone when there are none.
  - The weights moved under a collapsed "Customize ranking" section, closed by default. Each factor offers three choices: "Doesn't matter", "Matters" or "Matters a lot". The number inputs are gone, and the columns and limits are unchanged. School, hometown and open role score 0/2/3; early stage scores 0/1/2. The defaults (school "Matters a lot", the rest "Matters") store 3/2/2/1. A stored number that matches no choice shows as the nearest one (`levelFor` in `lib/profile.ts`, tested in `lib/profile.test.ts`).
  - The form's Save goes through a small browser-side wrapper, so it needs JavaScript; a plain form post without JS no longer saves. The save was tested by calling the action with React's own `encodeReply`, as the browser does.
- Known: `updated_at` is set by the app, not a trigger; nothing reads it yet. Saving the profile doesn't rescore companies yet; that comes with `feature/scoring`.

## Finished (branch `feature/scoring`, 2026-10-16)
- `lib/scoring.ts` `scoreCompany`: a plain weighted sum of four factors (school, hometown, open role, early stage), using the profile's weights. Each factor counts once and only from a fact enrichment saved with an http(s) source page. Each reason has plain text, its points and `source_url`; the strongest comes first.
- Matching:
  - **School:** "Duke" matches "Duke University", "Duke Law" and "Duke '19 (BS)". Short names cover MIT, UNC, NYU, CMU, UC Berkeley and similar. "University"/"College" and their position must agree when both sides say them, so Boston College isn't Boston University and University of Miami isn't Miami University. NYU doesn't match New York Law School.
  - **Place:** "Raleigh, NC" matches "Raleigh, North Carolina". A region-only profile ("North Carolina") matches anyone from there. A bare "Raleigh" doesn't match a city with a state, because which Raleigh isn't stated. Codes people also use for countries (IN, DE, CA, WA, IL, ...) aren't read as US states on the person's side.
  - **Roles:** presets need both the field and the kind of work ("Software Sales Representative" isn't software engineering). Custom roles match as whole words.
  - **Early stage:** a stated headcount of 50 or fewer decides first ("1.2k" and "200+" are large; years are ignored). Otherwise pre-seed, seed, Series A or angel. YC alone doesn't count, since old YC companies are large.
- `lib/rescore.ts` recomputes and saves through `set_company_scores(jsonb)`:
  - Runs for one company after each lookup (including failed ones) and for all companies after each profile save.
  - Each score carries the `facts_version` and profile `updated_at` it was computed from. The function only writes rows where both still match, and skipped rows are retried up to 3 times. This stops a profile save during a lookup from leaving a stale score.
  - The lookup saves people first, then the facts with `facts_version + 1`.
- Migrations, applied through the Supabase MCP (remote versions match the filenames):
  - `20261016192230_company_scores.sql`: `set_company_scores` (security invoker, empty search_path, execute only for authenticated), a check that `score_reasons` is an array, and an index on `(user_id, score desc nulls last, created_at desc)`.
  - `20261016193736_company_score_versions.sql`: `companies.facts_version`; the function writes only when the versions match.
  - `20261016193749_company_status_view.sql`: view `company_status` (`security_invoker = true`, select only for authenticated) giving the newest outreach status per company.
  - No new policies: the function and view run with the caller's rights, so the existing per-user RLS applies.
- `/`:
  - Sorted by score; companies not looked up go last. Each row shows the score and its top reason.
  - Filter chips (Alumni, Hometown, Role open; Status) live in the URL. Contacted companies (sent and later) are hidden by default, with a toggle that shows how many.
  - Filters apply to the top 500, and the page says so when there are more.
- "Look up all":
  - Looks up every company not looked up yet, one at a time in the browser, with "N of M done", a progress bar, Stop, and errors per company. Lookups with notes are listed in a closed section.
  - The list refreshes after each one, so scores appear as they finish.
  - Calls the lookup route with `{ onlyNew: true }`, so a company looked up meanwhile is skipped rather than looked up again. Asks once before starting, because each lookup is a Claude call.
- `/company/[id]`: "Why it ranks here" shows the total and every reason with its points and a "found on /path" link.
- Tests (vitest, 102 total): scoring, school/place/role/size matching (including every false match the review found), filters, and profile weights.
- Tested by script with throwaway users (deleted afterwards): a profile save rescored seeded companies (8/0/3/not looked up); list order, hidden contacted, chips and company-page reasons all checked; stale-version writes refused (0 rows) and current ones accepted; `onlyNew` skipped a looked-up company; a failed lookup got score 0; a real lookup of oxide.computer saved score 2 with a sourced role reason.
- Fresh-context review: RLS and the function were fine. Fixed:
  - false matches (school type words, country codes, bare city, one-word roles, "1.2k", YC);
  - stale-score races;
  - "Look up all" double start, repeat lookups, a refresh ending the run, and notes not shown;
  - the outreach read cut off at 1000 rows;
  - the contacted count ignoring chips;
  - "Not scored yet" after a failed lookup;
  - small tap targets.
- Known:
  - Companies looked up before this branch show "Not scored yet" until the profile is saved once.
  - Statuses are all "To contact" until drafting and status tracking exist.
  - "Look up all" runs only while the page is open.
- SPEC.md: Discover is now Saturday morning, before drafts. All matches start ticked, "Add all" adds the ticked ones, and added companies go into the same lookup queue.

## Finished (branch `feature/people`, 2026-10-17)
- **Founder research** (`lib/enrich/research.ts`, `POST /api/companies/[id]/research`):
  - Uses Haiku 5.5 with `web_search_20250305`, `max_uses: 3`. Blocked domains: LinkedIn plus people-data sites built from LinkedIn (rocketreach, zoominfo, apollo, contactout, signalhire, lusha, seamless.ai, peopledatalabs, theorg). Up to 5 people, founders first.
  - The API's citation quotes (`cited_text` + url) are the evidence. A second structured-output Haiku call maps quotes to people.
  - `acceptFacts` keeps a fact only if the quote names the person (full name, last name or first name; never a particle) and contains the value as whole words. If the quote names several of the people, the value goes to the person named closest before it. Colleges only, no high schools. Only empty fields are filled.
  - The quote and its page are saved per fact (`school_source_url`/`school_quote`, `hometown_*`).
  - Runs after a lookup, during "Look up all" (`onlyNew`), and from "Research founders" on the company page. "Look up again" only re-runs it when the lookup found someone new, so repeat lookups don't repeat the searches.
  - It's a separate route from the lookup so each stays under 60 s. The cooldown is 60 s on `companies.researched_at`.
- Measured cost on TurboAI: 2 searches, about 28k input and 2.3k output tokens, about $0.024 a company (max about $0.036). "Look up all" shows an estimate before it starts.
- TurboAI test: Sarthak Dhawan → Duke University, with a quote that names him. Rudy Arora → Northwestern University, and once Frisco, Texas. Each was saved with its quote and page and scored for a Duke profile.
- **Add a person** (company page): name, title, school, hometown, source link (http/https only), and an email only if the user typed it (shape-checked). Saved with `added_by_user`; it counts toward the score with "from what you added" when there's no link.
- **CSV import:** optional `connection` and `source_url` columns. New companies get the tag. Already-saved untagged ones are tagged in batches with one rescore. A bad `source_url` skips the row. The tag shows under About on the company page and scores like a person's fact once the company is looked up.
- **Scoring:** a school or hometown uses its own source when research found it. User-added facts count with no link. A list connection counts when no person matches.
- Migration `20261017173628_people_sources.sql` adds the per-fact source and quote columns, `added_by_user` and length checks on contacts, plus `connection`, `connection_source_url` and `researched_at` on companies. No new policies: the existing per-user contacts and companies policies cover the new columns.
- 114 tests pass, including the research checks: wrong person, particles, high school, made-up numbers.
- Tested by script with throwaway users (deleted afterwards): research route, add person (including duplicate and bad link), and CSV tags (new, re-tag, keep an existing tag, bad link). The company page shows the quotes and source sites.
- Fresh-context review: no RLS issue, key leak, unsafe link or LinkedIn leak. Fixed:
  - a quote naming two founders could give one's school to the other, and name particles counted as names;
  - "Look up again" re-charged research;
  - CSV re-tag ran about 8 queries per row and its error wording was wrong;
  - a cut-off research answer looked like "nothing found";
  - the 3-search cap showed as an error;
  - long citation URLs failed the save after the searches were paid for;
  - CSV tags weren't visible.
- I also blocked rocketreach.co and similar people-data sites after a test run cited one.
- Known:
  - The check is textual, so "worked at Duke Energy" could read as Duke. The saved quote on the page lets the user check.
  - A joint statement ("Sarthak and Rudy are from Frisco") only credits the person named last.
  - A "…respectively" sentence can pass if it names the person.
  - Re-tagging from a CSV doesn't bump `facts_version` (a tiny race with a concurrent profile save; the next rescore fixes it).
- **Leaders found by search** (after "Turbo AI test failed: the site names no one"):
  - When no saved person is a founder or CEO, research first searches for who founded or leads the company, within the same 3 searches.
  - `acceptLeaders` keeps a person only if the quote names them in full and calls them founder, co-founder or CEO. "Founded" counts only as "founded by …<name>" or "<name> … founded", not if "hired"/"joined"/"later" comes in between. The quote, the page title or the URL must name this company (its name, website, website label, or the name run together).
  - Saved with `title`, `source_url` and `source_quote` (migration `20261017221923_contact_source_quote.sql`, no new policies), then researched for school and hometown like everyone else. "Needs info" clears.
  - "Look up all" now researches companies whose site named no one.
- **End-to-end runs, as the button does** (throwaway users, deleted afterwards):
  - turbo.ai: the lookup found 0 people. Research found "Turbo AI was founded by Sarthak Dhawan" (getlatka.com) and saved him as Founder. Then Duke University from brut.media ("Arora and Dhawan were students at Duke University…"), scoring 3 for a Duke profile. An earlier run found Rudy Arora instead; results vary.
  - restor3d.com: the lookup found 6 leaders on its own site, including the CEO, so no leader search was needed. Research used 3 searches and found no school or hometown stated, so nothing was saved.
- **Fix: Rudy Arora tagged Duke.** He went to Northwestern; the source was "Arora and Dhawan were students at Duke".
  - Research now keeps every accepted sentence (`school_evidence`/`hometown_evidence`, with links and a `single` flag), and gives each fact a status: `stated` (scored), `shared` (only a sentence about several people) or `conflicting` (different values; the page shows "Sources disagree" with each source). Only `stated` scores.
  - A sentence is "about one person" if a part of it (split by "while", "whereas", "but" or ";") names only that person and the value, with no "they/both/respectively" or "X and Y"; or if the value is a description attached to the name ("former Duke University student Sarthak Dhawan").
  - Facts that are shared or conflicting are researched again on the next run, and new sentences are merged with earlier ones. Search now looks up each person by name.
  - Migration `20261017223529_person_fact_status.sql` adds the status and evidence columns. It also cleared the one earlier research fact in the user's data (Rudy's Duke at turbo.ai), dropped its points and reset `researched_at`, so research runs again under the new rules.
  - Turbo AI retest (both founders known), run as the button does. Run 1: Rudy → Northwestern (stated); nothing found for Sarthak. Run 2: Sarthak → Duke University from a sentence about him alone (stated, +3), Rudy → Northwestern (stated), Rudy's Frisco hometown shared (not counted). Full flow from a bare turbo.ai: leader search found Rudy; his only Duke sentence was about both founders, so it was shared and not scored. A seeded conflict renders "Sources disagree" with both sources and "Not counted toward the score."
- **Fix: only Rudy Arora was saved from "Founded by Sarthak Dhawan and Rudy Arora".**
  - `founderNames` now reads founders from the quotes themselves, not only from the picker:
    - the list after "founded by" or "co-founders";
    - a role right next to a name ("The CEO of Turbo AI is Sarthak Dhawan", "Rudy Arora, co-founder of …", "founder and CEO Jane Doe");
    - anyone in the same name list as a founder the picker named.
  - Each name still has to pass `acceptLeaders`, and organization names (University, College, AI, Labs, …) are never people. A multi-person sentence is fine for who founded the company, just not for schools.
  - The founder search also runs when the only saved founder was itself found by search. Once two or more founders are saved, the searches go to their schools and hometowns.
  - "Look up again" now always runs founder research afterwards (anyone without a school or hometown is searched again), not only after finding new people.
  - Timeout: a "Look up again" research call ran past the 35 s client timeout after several per-name searches. The search call now uses low effort, a 2500-token answer limit, an instruction to answer in short cited lines, and a 40 s timeout. 40 s plus the 15 s picker stays under the route's 60 s limit.
  - Narrowed the "X and Y" group-sentence check to two names joined as the subject of a shared verb ("Arora and Dhawan were …"). Before, "Mathematics and Computer Science @ Duke University" counted as a group sentence.
  - Turbo AI retest (bare turbo.ai, lookup then "Look up again" a minute later, as the button runs it):
    - Both founders were saved from one founder sentence (Yahoo, and in another run kfor.com).
    - Rudy Arora → Northwestern University (stated).
    - Research took 13–19 s; no timeouts.
    - Sarthak Dhawan's school was not saved in these runs. The Duke sources the searches returned were first-person ("I got into Duke University" in an interview; his own blog post on turbo.ai) or RocketReach (blocked). A first-person quote doesn't name him, so it isn't used.
    - One earlier run found a sentence about him alone on Starter Story and scored Duke +3. Results depend on what each search returns.
- **Search budget split:** 1 search to find founders (only when the site names none; founders are read from the quotes by `founderNames`, with no extra model call), then up to 3 to research people. At most 4 per company, about 2 to 5 cents. Timeouts are 15 s for the founder search, 30 s for research and 12 s for the picker, which keeps the route under 60 s. Turbo AI retest: 4 searches in 20 s. Sarthak Dhawan and Rudy Arora were both saved from Yahoo's founder sentence, and Rudy → Northwestern was stated. Sarthak's school wasn't found in this run (accepted by the user).
- Known: the same person under two names (e.g. "Rudransh Arora" and "Rudy Arora") is saved twice; the app can't tell they're one person.
- **Order for the rest** (user, 2026-10-17): drafts, then status, then fit (resume PDF, graduation year, role fit, flagging internships whose dates have passed like "Summer 2026"), then Discover only if time remains. About me (graduation year, degree and major, resume pasted or uploaded as a PDF up to 5 MB through Claude's PDF input; text only is stored), and role fit judged by Claude with "unclear" when unsure.

## Finished (branch `feature/drafts`, 2026-10-18)
- `lib/drafts.ts`:
  - `draftFacts` builds a numbered list of facts: the company (summary, stage, size, open roles, score reasons), the person (name and title; school and hometown only if they count, so "shared" and "conflicting" are left out), and the profile.
  - `checkDraft` requires the body to be under 120 words, with no stock phrases (list in `STOCK_PHRASES`), no bracket placeholders, no number missing from the facts (durations like "15-minute" are allowed), and a named company fact.
  - `gmailComposeUrl` builds the `mail.google.com/mail/?view=cm` link.
- `lib/draft-writer.ts`: Opus 5.5 at low effort with structured output and server-side fallbacks (`fallbacks: "default"`). One retry, appended to the conversation, when a check fails; then the problems are shown. The prompt allows exactly one company fact and nothing outside the facts (it rules out nicknames like "Blue Devil", and anything about the student that isn't in their profile). With no samples, the tone is clear, friendly and professional. The email ends "Best," with no name.
- `POST /api/companies/[id]/draft`: same origin, auth and key checks as the other routes. A person from another company or user isn't found (RLS plus `eq company_id`). Saves through `lib/outreach.ts` `saveDraft`, which updates the newest outreach row or creates one; "to_contact" becomes "drafted" and a later status is kept. A company with no company facts gets "Look it up first."
- Company page: "Draft an email" section with To (people or the team), Lead with, Write a draft, editable subject and body, live word count, a stock-phrase warning, Save changes (server action), Copy, and Open in Gmail. Gmail fills in the address only if the user typed one. The page says Pipeline never sends email.
- Migration `20261018004223_outreach_drafts.sql`: `outreach.subject`, `updated_at`, and length checks. No new policies: the existing outreach policies (own company, and a contact from that company) cover them.
- Tested by script (throwaway users, deleted): drafts to a person and to the team, with and without samples, 83 to 94 words, about 5 to 7 s each, saved with status "drafted". The first version said "fellow Blue Devil" and used three company facts in one email; the prompt was tightened and the retest used one fact and nothing invented. 135 tests pass.

- **Fresh-context review:** nothing can send email; no RLS hole, key leak or redirectable link. Fixed:
  - a saved "team" draft reopened addressed to the first person;
  - changing "To" silently re-addressed an existing draft (the draft now remembers its recipient and says so);
  - the recipient line counted as "the company fact";
  - the number check matched substrings ("20" inside "2027") and rejected "15–20 minutes";
  - a follow-up draft overwrote the record of a sent email (it's now a new row);
  - the retry could pass the 60 s limit (now one 50 s deadline);
  - a written draft was lost if saving failed;
  - clearing the body hid the editor;
  - very long drafts broke the Gmail link (now "use Copy");
  - page text could slip a link or address into a draft (escaped, and links/addresses are rejected);
  - drafts used a person's school with no source (same rule as scoring now).
- Known: after a follow-up draft, the company's newest row is "drafted", so the list shows Drafted rather than Sent. `feature/status` should decide how status reads across rows.

- **Less generic drafts** (user, 2026-10-18):
  - A role whose dates have passed (`lib/roles.ts` `roleTiming`, e.g. "Summer 2026" in October 2026) is never presented as open; the draft asks about upcoming internships instead.
  - The interests list is no longer a fact. Target roles are given with "name at most one". The draft adds one concrete line about the student from a profile fact or something a writing sample states; sample text counts as known for the number check.
  - Drafts prefer a specific "what they build" sentence. Facts are now `company` (exactly one), `connection` (shared school or hometown, at most one), `recipient` and `me`.
  - Company names: the lookup extracts the company's name as its pages write it (it must appear on a page) and replaces a domain-style name (`looksLikeDomain`). When the name still looks like a domain, the company page shows a "Company name" field, and drafts ask for a name first.
  - "Your name" on /profile (migration `20261018010306_profile_full_name.sql`, no new policies) signs drafts.
  - Turbo AI test: the lookup renamed "turbo.ai" to "Turbo AI". Both drafts (106 and 114 words) said what Turbo AI builds, treated the Summer 2026 role as past and asked about upcoming internships, used the compilers-parser line from a sample, and signed with the name. The draft to Sarthak also mentioned the past role alongside the product.
- **Sign-off and school wording** (user):
  - Drafts always end "Best,\n<full_name>": `signOff` replaces whatever closing the model wrote. Without a name in the profile, the draft route asks for one first.
  - A shared school is worded neutrally ("I'm a Duke student and saw you studied at Duke"), never claiming the person's current status. Turbo AI retest: both drafts used that wording and ended with the name.
  - Watch: one draft said "a small team like yours", which isn't from a fact.
- **Why Turbo AI scored 0:** the user's profile has "Hiring for a role I want" set to "Doesn't matter" (`weight_open_role = 0`). The matching itself works.

## Finished (branch `fix/draft-company-name`, 2026-10-18)
- Drafts never wait on the company name. They use the name the company's pages state (found on lookup); otherwise `nameFromDomain` makes a readable one: drop the ending and capitalize words, with ".ai" said as "AI" ("oxide.computer" → "Oxide", "turbo.ai" → "Turbo AI", "acme-labs.com" → "Acme Labs"). `displayName` is used in the draft route, the company page heading and the list.
- "Edit name" on the company page is an optional, closed control instead of a required box.
- Drafts never wait on "Your name" either. With a name in the profile they end "Best,\n<name>". Without one they end with "Best," alone for the student to sign. `signOff` also drops a name the model made up. The profile field stays optional. Retest with no profile name: the oxide.computer draft generated straight away and ended with "Best,".
- Retest: a draft for a company saved as "oxide.computer", with no name set, worked straight away. It said "Oxide" throughout and was 88 words.

## Finished (branch `feature/status`, 2026-10-18)
- **Company page "Status":** chips for To contact, Drafted, Sent, Replied, Interview, Rejected and Ghosted, plus an optional follow-up date, saved by the `saveStatus` server action. Dates must be real (round-trip checked, years 2000–2100).
- **Status model:**
  - Status lives on the company's newest outreach row (view `company_status`, now with `follow_up_on` and `sent_at`).
  - `sent_at` is set when the status changes to Sent, and cleared when it goes back to To contact or Drafted. "Marked sent on" shows only while the company counts as contacted.
- **Follow-up drafts:**
  - A draft written after "sent" goes on a new row flagged `is_follow_up` that copies the status, follow-up date and send date, so the company still reads "Sent". Edits to that draft update the same row.
  - "Mark follow-up sent" records a new send date and clears the flag.
- **List (`/`):** each row shows its status badge and a follow-up badge. The badge reads "Follow up today", "Follow up (was Oct 15)" or "Follow up Oct 21", judged against the viewer's own date with a fixed en-US format. The existing status chips and the "hidden while contacted" toggle work as before.
- **Migrations:** `20261018033935_company_status_follow_up.sql` (view columns) and `20261018040222_outreach_follow_up_flag.sql` (`outreach.is_follow_up`). No new policies: the view is `security_invoker`, and the outreach policies cover the column.
- **Tested by script** (throwaway users, deleted):
  - a bad status, a bad date and Feb 30 were each rejected;
  - Sent got its send date, and the company was hidden by default and shown under the Sent chip with its badges;
  - two follow-up drafts stayed one row, and changing only the date left the send date alone;
  - "Mark follow-up sent" set a new send date, and going back to Drafted cleared it.
- **Fresh-context review:** RLS fine. Fixed:
  - a stale panel could save the old status back after a draft;
  - every follow-up draft save added a row;
  - `sent_at` was stamped on a date-only change and never cleared;
  - two hydration mismatches (dates formatted on the server);
  - impossible dates reached Postgres.
- **Known (product):** contacted companies are hidden by default, so a due follow-up only shows with the toggle or the Sent chip. A "follow-ups due" link could help later.

## Finished (branch `feature/fit`, 2026-10-18; stacked on `feature/status`)
- **About me** on /profile: class year, degree, major, and a "Your resume" section (paste, or "Upload a PDF" that fills the box for review). `/api/profile/resume` checks origin, session, key, size (4 MB: Vercel's body cap is 4.5 MB, so 5 MB uploads couldn't reach the route), type and the `%PDF-` header, then asks Haiku to copy the text. The PDF is never stored; the text is saved with the profile.
- **Role fit:** `lib/fit.ts` (prompt, schema, verdict merge, `fitKey`), `lib/role-fit-run.ts`, `/api/companies/[id]/fit`. The lookup also runs it when at least 8 s are left. Saved as `companies.role_fit` `{key, checked_at, roles[]}` with a facts_version bump (compare-and-set), so older scores are refused.
  - The extraction now also returns a `details` excerpt per role, kept only when copied from the cited page.
  - Scoring counts only "fits" for the current `fitKey`; otherwise it matches titles, minus senior and past-dated ones, labelled "(fit not checked yet)".
  - In the schema the reason comes before the verdict: with the verdict first, Haiku once returned "no_fit" with a reason saying it fits.
- **Drafts:** a "me" fact with degree, major and class year, and one with the resume (first 5,000 characters, "use at most one line"). Roles judged "Doesn't fit" are dropped.
- **Migration:** `20261018150931_profile_about_me_and_role_fit.sql` (profile columns with length and range checks, plus `companies.role_fit`). No new policies: the existing profiles and companies policies cover the columns.
- **Tested by script** (throwaway user, deleted): a .txt file and a renamed .txt were rejected; a real PDF came back as clean text. Five roles came out as follows: the 2027 SWE intern "fits" (score reason quotes it), the senior role and the PhD-only role "doesn't fit", "Software Engineer" (no level) "unclear", and Summer 2026 "dates passed". The draft used the resume line ("built a Rust CLI … 40 of my classmates use it").
- **Fresh-context review:** races, secrets, injection and RLS were fine. Fixed:
  - a lookup that found new roles but couldn't re-check fit kept the old verdicts, so the new roles silently didn't count. A lookup now clears stale verdicts when the roles changed, and scoring counts any unjudged role by title, labelled;
  - roles after the 25th were never judged (now 40, matching extraction);
  - two listings with one title shared a verdict (now matched on title, page, location and excerpt);
  - phone pickers that send `application/octet-stream` were refused (the `%PDF-` header decides now);
  - "I'm studying BS" with no major.
  - Not done: there's no cooldown on Check fit or the upload; repeat clicks only spend the user's own key budget.
- **Note:** the dev server running since Oct 17 kept old `lib/scoring.ts` in its server bundle after the branch switch; restarting it fixed it.

## Finished (branch `feature/find`, 2026-10-18; replaces Discover)
- **Find companies** box on `/`, posting to `/api/find` (maxDuration 120, with one 108 s budget across the steps):
  1. **Search** (Haiku, effort medium, up to 10 web searches, LinkedIn and people-data sites blocked, `max_tokens` 12,000): proposes up to 12 companies as JSON in `<companies>` tags.
  2. **Code checks:**
     - the source must be a URL the search tool returned;
     - the website must normalize to a company site and not be in the list;
     - the home page is read by `readHomePage` (safe fetch and robots.txt; a site that moved to a new domain is checked there once) within a 20 s cap, and must name the company;
     - a website the model supplied (no search result came from it) must state the full name.
  3. **Verify** (Haiku, structured output): confirms the page describes the company and doesn't contradict the request, and writes the description and "why" from the page.
- **Tuning, from live runs:**
  - at effort low and 6,000 output tokens it stopped after a few searches with 2 to 4 companies;
  - requiring websites that appear in the results cut 10 candidates to 4;
  - after these changes, "early-stage quant firms in NYC hiring interns" gave 8 confirmed firms, plus 4 left out with reasons, in 48 s.
- **Lock:** `find_locks` has RLS on and no policies. Only `claim_find_slot()` (returns a token) and `release_find_slot(token)` touch it; they are security definer, scoped to `auth.uid()`. The token never leaves the server, so a user can't clear their own lock and run Finds in parallel. A claim expires after 3 minutes, and a failed release is shown with the results.
- **Adding:** `addFromFind` re-validates and goes through the same `save()` as `/add`, which now also returns the added ids. Those are queued into Look up all with a window event (they join a run in progress, or start their own after a stopped one).
- **Migrations:** `20261018155621_find_locks.sql` and `20261018160918_find_locks_server_only.sql`.
- **Tested live** (throwaway users, deleted):
  - a too-short request was refused;
  - a second Find during the first got the clear 429 error;
  - direct table reads were refused, and a made-up release token freed nothing;
  - a Find right after the first one went through;
  - Add added the companies and returned ids, and adding again was reported as duplicates.
- **Fresh-context review** found 8 issues, all fixed:
  - a guessed website could attach a different company with a similar name;
  - users could bypass the lock;
  - the time budget had no shared deadline;
  - a failed release was hidden;
  - errors became generic text;
  - companies queued while a run was stopping were dropped;
  - source URL matching was too strict (scheme, www);
  - SPEC was missing the Find section.
- **Note:** 120 s needs Vercel Fluid compute; the preview build confirms whether the project allows it.
## Finished (branch `fix/sign-out`, 2026-10-18)
- **Sign out** moved from the bottom of `/` to the bottom of `/profile`, below Save, under "Signed in as <email>". It's the only Sign out. It goes to `/login`, and signed-out pages redirect there.
- **One `TopBar`** (`app/top-bar.tsx`) on every signed-in page (`/`, `/add`, `/company/[id]`, its not-found page, `/profile`): "Back to your list" on the left (except on `/`), "Profile" in the top-right corner (marked current on `/profile`). The home page's top padding now matches the other pages, so Profile sits in the same spot everywhere.
- **Tested at 390 px** in headless Chrome, with a throwaway account (deleted afterwards):
  - no sideways scrolling on `/`, `/add`, a company page or `/profile`;
  - tapping Sign out landed on `/login`, and `/profile` afterwards redirected to `/login`.

## Finished (branch `feature/find-entry`, 2026-10-18)
- "Add companies" and "Find companies" sit side by side on `/` (`app/home-actions.tsx`). Find opens the search box under them and focuses it. The box stays mounted once opened, so closing and reopening keeps the request and the results. The box's own button now says "Search".
- **Tested at 390 and 360 px** in headless Chrome:
  - both labels fit on one line (the text is a step smaller under 400 px);
  - a tap opens the box with the text field focused;
  - there's no sideways scroll.
- **Fresh-context review fixes:**
  - the panel's container is always in the page, so the button's `aria-controls` has a target;
  - closing the box mid-search no longer hides the outcome: the button reads "Searching…" or "Adding…" while one runs, and the box reopens when it finishes, showing the results or the error.

## Finished (branch `polish/final`, 2026-10-18; built on `feature/find-entry`)
- **Bug:** Find's "why it matches" showed a Minnesota connection. After Add, the lookup found none and the score didn't count it. "Why" was free text written by the model from the search step's unchecked note, and nothing from Find was saved with the company.
- **Find:**
  - The verify call returns `connections` (`school` / `hometown` / `office`, value, person, quote).
  - `acceptConnections` keeps one only if:
    - the quote is verbatim on the fetched home page (top plus footer) or in a web-search citation;
    - the quote names the value;
    - for a person fact, it passes founder research's `aboutOnly`;
    - it matches the profile (an office may instead be in a place the request names).
  - `withBackedWhy` drops a "why" that names the user's hometown, region or school with no connection backing it. The search step's note is never shown.
- **Add:**
  - `addFromFind` re-checks each connection from the browser: its kind, a quote that names the value and the person, and an http(s) source.
  - Offices go into `companies.locations`; person facts become contacts with `*_status = 'stated'`, the quote and evidence. The company is then rescored.
  - `rescore` now scores a company that hasn't been looked up when it already has sourced facts (people, locations, or a CSV tag). Before this, CSV-tagged companies waited for their lookup.
- **Lookups:**
  - extraction also returns offices with an exact sentence (checked on the page), and role locations that appear on the role's page;
  - `mergeLocations` adds to what's saved, never removes;
  - Find's contacts are kept (lookups only add new names, and research only fills empty facts).
- **Nearby factor** (`region`): an office, HQ or role location in the profile's place or state (`regionsMatch`; ambiguous codes like "Toronto, CA" aren't read as states; a bare city doesn't count). Weight `weight_region` defaults to 1. There's a "Nearby" filter chip and a Locations row on the company page.
- **Migration:** `20261018204943_company_locations_and_region_weight.sql`. No new policies.
- **Tested live** (throwaway users, deleted):
  - "tech startups with a Minnesota connection hiring software engineering interns" showed Onsetto with an office quote from start-midwest.com. Other results' unbacked "Minneapolis…" reasons were blank.
  - Add scored it right away (Nearby +1, with source). The lookup kept the location and the point, and added Early stage +1.
  - A direct Add with three quoted connections scored 6 (school 3, hometown 2, nearby 1), and a forged one with no real quote and a `javascript:` link was dropped.

- **Fresh-context review fixes:**
  - a search quote must name this company, so a list article's line about another company or founder isn't credited to it;
  - the company page and the list now show a score from saved quotes before the lookup ("so far, not looked up", with its reasons and sources);
  - region matching ignores zip codes and street numbers, treats "MA" written like the user's own code as the same state, reads the state after the city (Washington, DC isn't Washington), and doesn't treat a country as a region;
  - office quotes need office wording or an address ("we serve customers across Minnesota" doesn't count), both in Find and in lookups;
  - each lookup replaces its own role locations, so a closed role stops counting;
  - "why" checks also catch the school's short name and any US state, but not two-letter codes like "in";
  - an ellipsis inside a quote is refused (a trailing one from a citation is fine);
  - person rows from Find are merged regardless of capitalization.
- **Trade-off:** "Toronto, CA" now matches a "San Jose, CA" hometown, because a code written the same way as the user's is read as the same state.

## Feature freeze (2026-10-18)
- Merged #19 and #20 (the Find button, Find connections with quotes, Nearby factor). `main` builds, lint passes, and 201 tests pass.
- README rewritten from the create-next-app text. Region matching is listed as a known limitation in README and SPEC.

## Decisions
- Supabase tables with RLS go on `setup/database`. The Vercel deploy was done on main in step 8 (live at pipeline-three-delta.vercel.app).
- Confirm email is off in Supabase, so a new sign-up is logged in directly. Sign-up keeps the neutral message for an existing email, even though it differs from a new sign-up's response.
- vitest added on 2026-10-16 for the redaction tests; scoring tests go there too.
- Use Geist as the font (removed the Arial override rather than dropping the Geist imports).

## Open questions
- `npm audit`: 5 high (`braces` through `eslint-config-next`, dev only). The suggested fix downgrades to eslint-config-next 14, so it is not applied.
- Leaked Password Protection: Requires a paid Supabase plan; left off on the free tier.
