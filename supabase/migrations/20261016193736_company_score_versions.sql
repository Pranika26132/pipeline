-- Scores are computed in the app from the profile and a company's facts.
-- A save that started from older data must not overwrite a newer score, so
-- each score carries the versions it was computed from and is only written
-- when both still match. The app retries skipped rows.

-- Bumped by the lookup each time it saves a company's facts and contacts.
alter table public.companies
  add column facts_version integer not null default 0;

create or replace function public.set_company_scores(scores jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  updated integer;
  profile_version timestamptz;
begin
  if jsonb_typeof(scores) is distinct from 'array' then
    raise exception 'scores must be a JSON array';
  end if;
  select p.updated_at into profile_version
    from public.profiles as p
   where p.user_id = (select auth.uid());
  update public.companies as c
     set score = (s.item ->> 'score')::integer,
         score_reasons = s.item -> 'reasons'
    from jsonb_array_elements(scores) as s(item)
   where c.id = (s.item ->> 'id')::uuid
     and c.facts_version = (s.item ->> 'facts_version')::integer
     and profile_version is not distinct from (s.item ->> 'profile_version')::timestamptz;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

-- create or replace keeps the earlier grants; restated for clarity.
revoke execute on function public.set_company_scores(jsonb) from public, anon;
grant execute on function public.set_company_scores(jsonb) to authenticated;
