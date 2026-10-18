-- Founder research keeps every sentence it accepted for a school or hometown,
-- and how sure it is:
--   stated      a sentence about this person alone states it, nothing found contradicts it (scored)
--   shared      only a sentence naming several people states it (shown, not scored)
--   conflicting found sources give different values (shown as "Sources disagree", not scored)
-- Null means the fact didn't come from founder research (team page, user).
alter table public.contacts
  add column school_status text
    constraint contacts_school_status_check check (school_status in ('stated', 'shared', 'conflicting')),
  add column hometown_status text
    constraint contacts_hometown_status_check check (hometown_status in ('stated', 'shared', 'conflicting')),
  -- [{value, quote, url, single}] for each accepted sentence.
  add column school_evidence jsonb not null default '[]'
    constraint contacts_school_evidence_check check (jsonb_typeof(school_evidence) = 'array' and pg_column_size(school_evidence) <= 20000),
  add column hometown_evidence jsonb not null default '[]'
    constraint contacts_hometown_evidence_check check (jsonb_typeof(hometown_evidence) = 'array' and pg_column_size(hometown_evidence) <= 20000);

-- Facts saved by founder research before these rules (they have a quote)
-- could come from a sentence about several people. Clear them, drop their
-- points, and let research run again under the new rules.
with affected as (
  select distinct company_id from public.contacts
   where (school_quote is not null or hometown_quote is not null) and not added_by_user
)
update public.companies c
   set score_reasons = coalesce((
         select jsonb_agg(r) from jsonb_array_elements(c.score_reasons) r
          where r ->> 'factor' not in ('school', 'hometown')), '[]'::jsonb),
       score = case when c.score is null then null else coalesce((
         select sum((r ->> 'points')::integer) from jsonb_array_elements(c.score_reasons) r
          where r ->> 'factor' not in ('school', 'hometown')), 0) end,
       researched_at = null,
       facts_version = c.facts_version + 1
  from affected a
 where c.id = a.company_id;

update public.contacts
   set school = null, school_source_url = null, school_quote = null
 where school_quote is not null and not added_by_user;
update public.contacts
   set hometown = null, hometown_source_url = null, hometown_quote = null
 where hometown_quote is not null and not added_by_user;

-- No new policies: the existing contacts policies cover the new columns.
