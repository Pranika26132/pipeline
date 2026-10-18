# Pipeline: internship outreach for tech and quant roles

A web app that helps me find startups and small firms worth emailing, ranks them by how likely I am to get a reply, and drafts a cold email for each one that I review and send myself.

## Who uses it
Me first. Other Duke students second (requirement: someone other than me can use it, so it has real sign-up and every user only sees their own data).

## Core loop
1. **Add targets**: paste a company URL, or import a CSV. Sources I will feed it: YC company directory, Work at a Startup, Wellfound, quant firm lists, Duke Career Hub / DukeHub alumni exports, my own lists.
2. **Enrich**: a serverless function fetches the company's public pages (about, team, careers) and asks Claude to extract: what they do, size/stage, roles open, founders/team names with background if stated on the page. Then **founder research** (see below) looks for each person's school and hometown on other public pages.
3. **Tag and score**: each company gets tags and a "reply likelihood" score from my filters.
4. **Draft**: pick a target, pick a contact, generate a cold email in my voice, edit it, copy it or open it as a Gmail draft.
5. **Track**: status per target (to contact, drafted, sent, replied, interview, rejected, ghosted) plus follow-up date. Built: set on the company page; a follow-up draft after sending keeps the status; the list shows the status and a follow-up badge.

## Filters and scoring (the part that makes it mine)
Each user sets a profile once: school, hometown/region, interests (tech, quant), target roles.
On /profile the weights below are set under a collapsed "Customize ranking" section as three choices per factor: "Doesn't matter" (0), "Matters", "Matters a lot". Points per choice: school, hometown and open role 0 / 2 / 3; nearby and early stage 0 / 1 / 2. The defaults ("Matters a lot" for school, "Matters" for the rest) give the points below.
Score is a plain weighted sum I can see and change, not a black box:
- Founder or team member went to my school: +3
- Founder or team member from my hometown/region: +2
- **Nearby:** an office, HQ or role location in my hometown or region (same place, or same state as my city), from a page with its source (a lookup's office sentence or role location, or a Find quote): +1
- Company has a matching open role: +2
- Early stage (under ~50 people): +1
- Already contacted: excluded by default
Every score shows its reasons ("Founder went to Duke: found on /about page") with the source link. If the enrichment did not find something on the page, the tag is simply absent. Never guess a school or hometown.

## People
- **Founder research.** After a lookup (and during "Look up all", or from a "Research founders" button on the company page), the Claude API web search tool looks for public pages about the people found. At most 4 searches per company: 1 to find founders when the site names none, then up to 3 to research people (about 2 to 5 cents), never LinkedIn (blocked in the tool). When the company's own pages name no founder or CEO, it first uses its 1 founder search to find who founded or leads the company; a person is saved only if a citation quote names them in full as founder, co-founder or CEO, and the quote, its page title or its address names this company (to avoid same-name companies), with the quote and page saved. Each school or hometown keeps every accepted sentence with its link. It is **stated** (scored) only when a sentence about that person alone says it (a part of a sentence split by "while"/"but"/";" or a description attached to the name counts; "Arora and Dhawan were students at Duke" doesn't) and nothing found contradicts it. Only a sentence about several people: **shared**, shown but not scored. Different values found: **conflicting**, shown as "Sources disagree" with every source, not scored. A school (a college, never a high school) or hometown is saved only when a page found by the search states it: the API's citation quote must name the person and contain the school or place, and the quote and its page link are saved with it. Only empty fields are filled. Never guessed.
- **Add a person** on the company page: name, title, school, hometown, a source link, and an email only if typed by the user. What the user types counts toward the score ("from what you added" when there's no link).
- **CSV import** takes two optional columns: `connection` (e.g. "Duke" for a list of Duke-founded companies) and `source_url` (the page the list came from). A connection that matches the profile's school or hometown counts toward the score with that page as its source. An already-saved company gets the tag if it has none.

## Fit
- **About me** on /profile, all optional: class year, degree, major, and a resume. The resume can be pasted, or uploaded as a PDF (max 4 MB, because Vercel refuses request bodies over 4.5 MB): a server route sends the PDF to Claude (Haiku) as a PDF document input (no new dependency), and the extracted plain text fills the resume box for review and editing before saving. Only the text is stored (up to 20,000 characters), never the file. Not a PDF, a renamed file, too big, empty, or unreadable each show a clear error, with "Undo, keep what I had" after a replace.
- **Role fit.** "Hiring for a role I want" only counts roles that fit: internship or new-grad level (not senior, PhD-only, or "X+ years"), matching the target roles, and plausibly the user's major, degree and resume. Claude (Haiku, one call per company, no web search) decides per role from the title, location and an excerpt copied from the listing (level, experience, degree or dates asked for) plus the profile. Each role gets **Fits you**, **Doesn't fit**, **Unclear** or **Dates passed**, with a one-sentence reason and the source link. Unclear never counts. Senior titles and past dates ("Summer 2026" in October 2026) are decided without the model.
- Fit runs inside a lookup when there's time left, and from **Check fit** under Open roles. Verdicts are saved with a fingerprint of the profile fields they used (target roles, degree, major, class year, resume). After a profile change they're stale: the score falls back to matching role titles (minus senior and past-dated roles) and says "(fit not checked yet)" until fit is checked again.
- Drafts get the class year, degree and major, and the resume, and use at most one resume line, the one most related to the company. Roles judged "Doesn't fit" aren't offered as a draft hook.

## Email drafting
- Input: company summary, contact (if any), my profile, 2-3 samples of my own writing, which hook to use (alumni, hometown, a specific thing they built).
- Output: short email (under 120 words), one specific reference to the company, one clear ask.
- Must sound like me: samples are included in the prompt, and the prompt forbids stock phrases ("I hope this finds you well", "passionate about", "seamless").
- Writing samples are optional. If the profile has none, drafts use a clear, friendly, professional tone instead (still no stock phrases).
- Only uses facts that came from the enrichment or my profile. No invented compliments or numbers.
- **The app never sends anything.** It produces a draft; I read it and send it.
- Built (`feature/drafts`): "Draft an email" on the company page. Pick a recipient (a saved person, or the team) and what to lead with (same school, same hometown, an open role, what they build; only the ones a fact supports). Claude Opus 5.5 writes from a numbered list of facts: company facts with sources, the person's counted facts, and profile facts. Every draft is checked before it's shown (under 120 words, no stock phrases, no placeholders, no number that isn't in the facts, one named company fact), with one retry. The draft is saved on the company's outreach row and the status becomes "drafted". It can be edited (live word count and stock-phrase warning), copied, or opened in Gmail's compose window, with the address filled in only if the user typed one.

## Find companies (`feature/find`; replaces Discover, which is cut)
A way to find new targets without leaving the app.
- A **Find companies** button next to "Add companies" on `/` opens a box: type a request in plain English ("early-stage quant firms in NYC hiring interns"). The profile (target roles, interests, major, class year, school, hometown) is sent with it.
- `/api/find`: Claude (Haiku) with the web search tool, at most 10 searches per request (about 10 to 20 cents, shown under the box), LinkedIn and people-data sites blocked. It proposes up to 12 companies: name, website, why, and the search result it was found in.
- **Nothing invented.** A company is shown only when all of these hold:
  - its source is a URL the search tool actually returned;
  - its website is a company site (not a directory, job board or LinkedIn) and isn't already in the list (dedupe on domain);
  - its home page responds through the same safe fetch and robots.txt rules as lookups (a site that moved to a new domain is checked there) and names the company;
  - a second Haiku call, reading that page, confirms it describes the company and doesn't contradict the request. The one-line description and "why it matches" come from that page and the search result. Requirements the page doesn't confirm (like hiring interns) are said to be unconfirmed.
- **Connections need a quote.** A school, hometown or office connection is shown only with the exact sentence and its page, under the same rules as founder research:
  - the sentence is verbatim on the company's fetched home page (start or footer) or in a web-search citation;
  - it names the school or place;
  - for a person, it is about that person alone;
  - it matches my profile (an office may instead be in a place the request names; only my own region adds points).

  "Why it matches" may not mention my hometown, region or school without a quoted connection backing it; otherwise that line is dropped.
- **Saved on Add.** A founder's school or hometown becomes a person fact ("stated", with quote and source); an office becomes a company location. The company is scored right away, before its lookup; the list shows that score as "so far, not looked up", and the company page shows its reasons and sources. Lookups and founder research only add to these, never erase them.
- Results show as a checklist (all ticked): company, website, one-line description, why it matches, and "Found on …" linking to the source. "Add all N", or untick rows and "Add N selected". Everything left out is listed with the reason.
- **Nothing is added without a click.** Adding goes through the same checks as `/add` (`source` = `find:<request>`). The added companies queue straight into Look up all (or join a run in progress) and are scored as each lookup finishes.
- **One Find at a time per user**, claimed in the database (`find_locks`, `claim_find_slot()`; a claim expires after 3 minutes). A second one gets a clear error. Every other error (no results, API, timeouts, a cut-off answer) is shown in the box.

## Data (Postgres on Supabase, RLS on every table)
- `profiles`: user_id, school, hometown, interests, role_targets, writing_samples
- `companies`: id, user_id, name, url, summary, stage, size, source, score, score_reasons (jsonb), created_at
- `contacts`: id, company_id, user_id, name, title, school, hometown, source_url, email (optional, user-entered), school_source_url + school_quote and hometown_source_url + hometown_quote (where each fact was stated), added_by_user
- `outreach`: id, company_id, contact_id, user_id, draft, status, sent_at, follow_up_on

RLS rule on all four: `user_id = auth.uid()`.

## Stack
Next.js on Vercel, Supabase (auth + Postgres), one server route for enrichment and one for drafting that call the Claude API. API key lives only in Vercel env vars.

## Pages
- `/` target list: sortable by score, filter chips (alumni, hometown, role open, status)
- `/add` paste URL or upload CSV
- `/company/[id]` summary, contacts, score reasons, draft editor
- `/profile` my school, hometown, writing samples, score weights
- Phone first. Loading, empty, and error states for every page.

## Out of scope (deliberately)
- Auto-sending emails or auto-applying
- Scraping LinkedIn or any site that forbids it
- Finding or guessing people's email addresses
- Chrome extension, mobile app, multi-user teams

## Edge cases
- Page can't be fetched or has no team info: save the company anyway, flag "needs manual info"
- Same company added twice: dedupe on domain
- Model returns bad JSON: show the error, keep the raw company row
- Draft requested with no contact: write it to "the team" and say so

## Build plan (deadline: Mon Oct 19, 11:59pm)
- **Tue night / Wed**: repo, Next.js, Supabase tables + RLS, auth, deploy to Vercel. Empty app live on day one.
- **Thu**: add company + enrichment + list page
- **Fri**: scoring, filters, profile page, Look up all
- **Sat**, in order, one branch each: people (founder research, add person, CSV connection), fit (About me, resume, role fit), drafts, status tracking; then Find companies (plain-English request, web search, checklist, auto-queued for lookup), which replaced Discover
- **Sun**: second-user test for RLS, phone pass, security pass, fresh-session review against this spec
- **Mon**: record the <3 min video, submit

Each step = one branch, one PR, small commits.

## Done means
A friend signs up with a different account, adds a company, gets a scored entry and a draft, and cannot see any of my data.
