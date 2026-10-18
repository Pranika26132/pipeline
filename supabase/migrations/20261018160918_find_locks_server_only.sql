-- The Find lock can't be cleared by the user: with their own row writable,
-- anyone could reset it through the API and run Finds in parallel. The table
-- now has RLS with no policies (no direct access at all), and only these two
-- functions touch it. The claim returns a token that only the server route
-- holds; the release needs that token.
drop policy "find_locks_select_own" on public.find_locks;
drop policy "find_locks_insert_own" on public.find_locks;
drop policy "find_locks_update_own" on public.find_locks;
revoke all on public.find_locks from authenticated;

alter table public.find_locks add column token uuid;

drop function public.claim_find_slot();

-- Claims the caller's slot; returns a token, or null when a Find is already
-- running (a claim older than 3 minutes has expired).
create function public.claim_find_slot()
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  claimed uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.find_locks as l (user_id, started_at, token)
  values (auth.uid(), now(), gen_random_uuid())
  on conflict (user_id) do update set started_at = now(), token = gen_random_uuid()
    where l.started_at is null or l.started_at < now() - interval '3 minutes'
  returning l.token into claimed;
  return claimed;
end;
$$;

-- Frees the caller's slot, only with the token from their claim.
create function public.release_find_slot(claim uuid)
  returns boolean
  language sql
  security definer
  set search_path = ''
as $$
  with freed as (
    update public.find_locks set started_at = null, token = null
    where user_id = auth.uid() and token = claim
    returning 1
  )
  select exists (select 1 from freed)
$$;

revoke execute on function public.claim_find_slot() from public, anon;
revoke execute on function public.release_find_slot(uuid) from public, anon;
grant execute on function public.claim_find_slot() to authenticated;
grant execute on function public.release_find_slot(uuid) to authenticated;
