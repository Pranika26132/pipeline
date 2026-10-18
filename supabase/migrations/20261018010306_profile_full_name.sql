-- The user's name, used to sign drafts.
alter table public.profiles
  add column full_name text,
  add constraint profiles_full_name_length check (char_length(full_name) <= 100);

-- No new policies: the existing profiles policies cover the new column.
