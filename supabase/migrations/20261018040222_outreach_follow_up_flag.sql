-- A follow-up draft written after an email was sent lives on its own row
-- and carries the company's status. This flag marks it as a draft not yet
-- sent, so edits update that row instead of adding new ones; marking the
-- follow-up sent clears it.
alter table public.outreach
  add column is_follow_up boolean not null default false;

-- No new policies: the existing outreach policies cover the new column.
