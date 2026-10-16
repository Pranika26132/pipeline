-- Per-item limits for profile arrays, matching the /profile form, so a direct
-- API call can't store a huge writing sample that later goes into a prompt.
-- Check constraints can't use subqueries, hence the helper.
create function public.max_item_length(items text[])
  returns integer
  language sql
  immutable
  set search_path = ''
as $$
  select coalesce(max(char_length(item)), 0) from unnest(items) as item
$$;

-- The constraint runs as the writing user, so authenticated keeps execute.
revoke execute on function public.max_item_length(text[]) from public, anon;
grant execute on function public.max_item_length(text[]) to authenticated;

alter table public.profiles
  add constraint profiles_writing_samples_length check (public.max_item_length(writing_samples) <= 3000),
  add constraint profiles_role_targets_length check (public.max_item_length(role_targets) <= 80);
