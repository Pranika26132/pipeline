-- Drafts: one outreach row per company holds the current draft (subject and
-- body) and who it's addressed to. The app never sends anything.
alter table public.outreach
  add column subject text,
  add column updated_at timestamptz not null default now(),
  add constraint outreach_subject_length check (char_length(subject) <= 200),
  add constraint outreach_draft_length check (char_length(draft) <= 5000);

-- No new policies: the existing outreach policies (user_id = auth.uid(), and
-- the company and contact must be the user's own) cover the new columns.
