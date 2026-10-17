# Pipeline: internship outreach for tech and quant roles

A web app that helps me find startups and small firms worth emailing, ranks them by how likely I am to get a reply, and drafts a cold email for each one that I review and send myself.

## Who uses it
Me first. Other Duke students second (requirement: someone other than me can use it, so it has real sign-up and every user only sees their own data).

## Core loop
1. **Add targets**: paste a company URL, or import a CSV. Sources I will feed it: YC company directory, Work at a Startup, Wellfound, quant firm lists, Duke Career Hub / DukeHub alumni exports, my own lists.
2. **Enrich**: a serverless function fetches the company's public pages (about, team, careers) and asks Claude to extract: what they do, size/stage, roles open, founders/team names with background if stated on the page. Then **founder research** (see below) looks for each person's school and hometown on other public pages.
3. **Tag and score**: each company gets tags and a "reply likelihood" score from my filters.
4. **Draft**: pick a target, pick a contact, generate a cold email in my voice, edit it, copy it or open it as a Gmail draft.
5. **Track**: status per target (to contact, drafted, sent, replied, interview, rejected, ghosted) plus follow-up date.

## Filters and scoring (the part that makes it mine)
Each user sets a profile once: school, hometown/region, interests (tech, quant), target roles.
On /profile the weights below are set under a collapsed "Customize ranking" section as three choices per factor: "Doesn't matter" (0), "Matters", "Matters a lot". Points per choice: school, hometown and open role 0 / 2 / 3; early stage 0 / 1 / 2. The defaults ("Matters a lot" for school, "Matters" for the rest) give the points below.
Score is a plain weighted sum I can see and change, not a black box:
- Founder or team member went to my school: +3
- Founder or team member from my hometown/region: +2
- Company has a matching open role: +2
- Early stage (under ~50 people): +1
- Already contacted: excluded by default
Every score shows its reasons ("Founder went to Duke: found on /about page") with the source link. If the enrichment did not find something on the page, the tag is simply absent. Never guess a school or hometown.

## People
- **Founder research.** After a lookup (and during "Look up all", or from a "Research founders" button on the company page), the Claude API web search tool looks for public pages about the people found. At most 3 searches per company (about 2 to 4 cents), never LinkedIn (blocked in the tool). A school (a college, never a high school) or hometown is saved only when a page found by the search states it: the API's citation quote must name the person and contain the school or place, and the quote and its page link are saved with it. Only empty fields are filled. Never guessed.
- **Add a person** on the company page: name, title, school, hometown, a source link, and an email only if typed by the user. What the user types counts toward the score ("from what you added" when there's no link).
- **CSV import** takes two optional columns: `connection` (e.g. "Duke" for a list of Duke-founded companies) and `source_url` (the page the list came from). A connection that matches the profile's school or hometown counts toward the score with that page as its source. An already-saved company gets the tag if it has none.

## Fit (next, `feature/fit`)
- **About me** on /profile, all optional: graduation year, degree and major, and a resume. The resume can be pasted, or uploaded as a PDF (max 5 MB): a server route sends the PDF to Claude as a PDF document input (no new dependency), and the extracted plain text fills the resume box for review and editing before saving. Only the text is stored, never the file. Wrong file type, too big, or unreadable each show a clear error.
- **Role fit.** "Hiring for a role I want" only counts roles that fit: internship or new-grad level (not senior, PhD-only, or "X+ years"), matching the target roles, and plausibly the user's skills and major. Claude decides per role from the role text on the page plus the profile, and the reason says why ("Hiring SWE interns — fits your CS major, class of 2028") with the source link. When it can't tell, it says "unclear" rather than guessing, and an unclear role doesn't count.
- Drafts (later) use the resume for one relevant line about the user.

## Email drafting
- Input: company summary, contact (if any), my profile, 2-3 samples of my own writing, which hook to use (alumni, hometown, a specific thing they built).
- Output: short email (under 120 words), one specific reference to the company, one clear ask.
- Must sound like me: samples are included in the prompt, and the prompt forbids stock phrases ("I hope this finds you well", "passionate about", "seamless").
- Writing samples are optional. If the profile has none, drafts use a clear, friendly, professional tone instead (still no stock phrases).
- Only uses facts that came from the enrichment or my profile. No invented compliments or numbers.
- **The app never sends anything.** It produces a draft; I read it and send it.

## Discover (Saturday morning, before drafts)
A way to find new targets without leaving the app.
- Pull the current Hacker News "Who is hiring?" thread through the official APIs only: the Algolia HN Search API to find this month's thread (posted by `whoishiring`), and the HN Firebase API or Algolia items endpoint for its top-level comments. No HTML scraping.
- Send the posts to Claude with my profile (interests: tech, quant; target roles: internships). Claude picks the posts that match and, for each, pulls out only what the post states: company, a short description, location, roles, website. Anything not in the post stays empty. Post text is untrusted data, the same as company pages in enrichment: instructions inside it are ignored.
- Show the matches as a checklist: company, short description, location, roles, website, and a link to the original HN post. Every match starts ticked; I can untick any row. An "Add all" button adds the ticked ones (its label shows how many).
- **Nothing is added without my click** on that button. Adding goes through the same path as `/add`: dedupe on domain (already-saved ones are reported, not added twice), `source` = `hn:<thread id>`. A match without a website can't be added and says so.
- Companies just added are queued for enrichment automatically, in the same queue as "Look up all" on the list page (one at a time, progress shown, errors per company), and scored as each lookup finishes.
- Errors (API down, thread not found, bad model output) are shown on the page, like everywhere else.

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
- **Sat**, in order, one branch each: people (founder research, add person, CSV connection), fit (About me, resume, role fit), Discover (HN "Who is hiring?" matches, select and add, auto-queued for lookup), drafts, status tracking
- **Sun**: second-user test for RLS, phone pass, security pass, fresh-session review against this spec
- **Mon**: record the <3 min video, submit

Each step = one branch, one PR, small commits.

## Done means
A friend signs up with a different account, adds a company, gets a scored entry and a draft, and cannot see any of my data.
