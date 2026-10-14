# Pipeline: internship outreach for tech and quant roles

A web app that helps me find startups and small firms worth emailing, ranks them by how likely I am to get a reply, and drafts a cold email for each one that I review and send myself.

## Who uses it
Me first. Other Duke students second (requirement: someone other than me can use it, so it has real sign-up and every user only sees their own data).

## Core loop
1. **Add targets**: paste a company URL, or import a CSV. Sources I will feed it: YC company directory, Work at a Startup, Wellfound, quant firm lists, Duke Career Hub / DukeHub alumni exports, my own lists.
2. **Enrich**: a serverless function fetches the company's public pages (about, team, careers) and asks Claude to extract: what they do, size/stage, roles open, founders/team names with background if stated on the page.
3. **Tag and score**: each company gets tags and a "reply likelihood" score from my filters.
4. **Draft**: pick a target, pick a contact, generate a cold email in my voice, edit it, copy it or open it as a Gmail draft.
5. **Track**: status per target (to contact, drafted, sent, replied, interview, rejected, ghosted) plus follow-up date.

## Filters and scoring (the part that makes it mine)
Each user sets a profile once: school, hometown/region, interests (tech, quant), target roles.
Score is a plain weighted sum I can see and change, not a black box:
- Founder or team member went to my school: +3
- Founder or team member from my hometown/region: +2
- Company has a matching open role: +2
- Early stage (under ~50 people): +1
- Already contacted: excluded by default
Every score shows its reasons ("Founder went to Duke: found on /about page") with the source link. If the enrichment did not find something on the page, the tag is simply absent. Never guess a school or hometown.

## Email drafting
- Input: company summary, contact (if any), my profile, 2-3 samples of my own writing, which hook to use (alumni, hometown, a specific thing they built).
- Output: short email (under 120 words), one specific reference to the company, one clear ask.
- Must sound like me: samples are included in the prompt, and the prompt forbids stock phrases ("I hope this finds you well", "passionate about", "seamless").
- Only uses facts that came from the enrichment or my profile. No invented compliments or numbers.
- **The app never sends anything.** It produces a draft; I read it and send it.

## Data (Postgres on Supabase, RLS on every table)
- `profiles`: user_id, school, hometown, interests, role_targets, writing_samples
- `companies`: id, user_id, name, url, summary, stage, size, source, score, score_reasons (jsonb), created_at
- `contacts`: id, company_id, user_id, name, title, school, hometown, source_url, email (optional, user-entered)
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
- **Fri**: scoring, filters, profile page
- **Sat**: draft generation + status tracking
- **Sun**: second-user test for RLS, phone pass, security pass, fresh-session review against this spec
- **Mon**: record the <3 min video, submit

Each step = one branch, one PR, small commits.

## Done means
A friend signs up with a different account, adds a company, gets a scored entry and a draft, and cannot see any of my data.
