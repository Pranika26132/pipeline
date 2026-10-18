-- One "Find companies" request at a time per user. A row holds the start of
-- the user's running request; a claim older than 3 minutes counts as ended
-- (a crashed request can't lock the user out).
create table public.find_locks (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  started_at timestamptz
);

alter table public.find_locks enable row level security;

create policy "find_locks_select_own" on public.find_locks
  for select to authenticated using (user_id = (select auth.uid()));
create policy "find_locks_insert_own" on public.find_locks
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "find_locks_update_own" on public.find_locks
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.find_locks from anon;

-- Claims the user's slot in one statement; true when claimed, false when a
-- request is already running. Runs as the caller, so RLS applies.
create function public.claim_find_slot()
  returns boolean
  language sql
  security invoker
  set search_path = ''
as $$
  with claimed as (
    insert into public.find_locks as l (user_id, started_at)
    values (auth.uid(), now())
    on conflict (user_id) do update set started_at = now()
      where l.started_at is null or l.started_at < now() - interval '3 minutes'
    returning 1
  )
  select exists (select 1 from claimed)
$$;

revoke execute on function public.claim_find_slot() from public, anon;
grant execute on function public.claim_find_slot() to authenticated;
