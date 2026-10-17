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
- **Next on the queue:** `feature/fit`. About me (graduation year, degree and major, resume pasted or uploaded as a PDF up to 5 MB through Claude's PDF input; text only is stored), and role fit judged by Claude with "unclear" when unsure.

## Decisions
- Supabase tables with RLS go on `setup/database`. The Vercel deploy was done on main in step 8 (live at pipeline-three-delta.vercel.app).
- Confirm email is off in Supabase, so a new sign-up is logged in directly. Sign-up keeps the neutral message for an existing email, even though it differs from a new sign-up's response.
- vitest added on 2026-10-16 for the redaction tests; scoring tests go there too.
- Use Geist as the font (removed the Arial override rather than dropping the Geist imports).

## Open questions
- README.md is still the create-next-app text. Replace it, and with what?
- `npm audit`: 5 high (`braces` through `eslint-config-next`, dev only). The suggested fix downgrades to eslint-config-next 14, so it is not applied.
- Leaked Password Protection: Requires a paid Supabase plan; left off on the free tier.
- No column for score weights yet. Add with the scoring step.
