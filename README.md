# Pipeline

Find startups and small firms to cold-email for tech and quant internships, rank them by what you share with them, and draft emails you review and send yourself. Phone first. Pipeline never sends email.

The full spec is in [SPEC.md](SPEC.md); build notes and decisions are in [NOTES.md](NOTES.md).

## What it does

- **Add companies** by link or CSV (optional `connection` and `source_url` columns), or **Find companies** by typing a request in plain English. Find uses Claude with web search (up to 10 searches, about 10 to 20 cents). Every result's own website is fetched and checked before it's shown, and nothing is added without your tap.
- **Look up** reads each company's own pages (honoring robots.txt, never LinkedIn) and saves what they state, with a source link for every fact: summary, stage, size, open roles, people, office and role locations.
- **Founder research** uses web search, at most 4 searches per company. A school or hometown is saved only when a quoted sentence about that person states it.
- **Scoring** is a plain weighted sum you can see and change on /profile:
  - founder went to your school;
  - founder is from your hometown or region;
  - office nearby;
  - hiring for a role that fits you (judged by Claude against your major, class year and resume);
  - early stage.

  Every point shows its reason and source.
- **Drafts:** under 120 words, built from one sourced fact plus your profile, in the tone of your writing samples. They're checked for stock phrases and invented numbers, and open in Gmail for you to send.
- **Status:** to contact, drafted, sent, replied, interview, rejected or ghosted, with follow-up dates.

## Stack

Next.js 16 (App Router, TypeScript), Supabase (auth and Postgres, with row-level security on every table), Vercel, and the Claude API, called only from server routes.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest
npm run build    # typecheck and build
npm run lint
```

Environment variables (in `.env.local` locally, and in Vercel project settings):

| Name | Where it's used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server (publishable key; RLS protects the data) |
| `ANTHROPIC_API_KEY` | Server routes only; never sent to the browser or saved |

Database changes are in `supabase/migrations/`. Every table's policies limit rows to `user_id = auth.uid()`. The Find lock table has no policies at all and is reached only through two functions.

## Known limitations and next steps

- **Region and hometown matching is narrow.**
  - A connection, such as a Minnesota office or a founder from Minneapolis, counts only when a page states it in a sentence that Pipeline can quote. Many real connections are never stated that way, so Find often shows no connection for a company that has one. Its "why it matches" line is dropped whenever it would claim your area without a quote.
  - Find checks only the company's home page (top and footer) and the search tool's citations, not its about or contact pages.
  - "Nearby" means the same city, or the same US state as your city. It doesn't know metro areas that cross state lines (for example New York and New Jersey, or Kansas City), non-US regions, or a bare city with no state.
  - A two-letter code written the same way as yours counts as the same state, so "Toronto, CA" matches a "San Jose, CA" hometown.
  - **Next:** read the about and contact pages in Find, add a small metro-area table, support non-US regions, and ask for structured addresses.
- Founder research depends on what web search returns, so results vary between runs. The same person can appear under two names (Rudransh and Rudy).
- Contacted companies are hidden by default, so a due follow-up shows only with the toggle or the Sent chip.
- Find's 120-second limit relies on Vercel's Fluid compute.
