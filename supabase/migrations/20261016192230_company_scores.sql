-- Saves scores computed in the app (lib/scoring.ts) for many companies in one
-- call, e.g. after a profile change. security invoker: the caller's RLS
-- policies apply, so only their own companies can change.
create function public.set_company_scores(scores jsonb)
  returns integer
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  updated integer;
begin
  if jsonb_typeof(scores) is distinct from 'array' then
    raise exception 'scores must be a JSON array';
  end if;
  update public.companies as c
     set score = (s.item ->> 'score')::integer,
         score_reasons = s.item -> 'reasons'
    from jsonb_array_elements(scores) as s(item)
   where c.id = (s.item ->> 'id')::uuid;
  get diagnostics updated = row_count;
  return updated;
end;
$$;

revoke execute on function public.set_company_scores(jsonb) from public, anon;
grant execute on function public.set_company_scores(jsonb) to authenticated;

-- Reasons are always a list.
alter table public.companies
  add constraint companies_score_reasons_array check (jsonb_typeof(score_reasons) = 'array');

-- The list page sorts by score.
create index companies_user_score_idx
  on public.companies (user_id, score desc nulls last, created_at desc);
