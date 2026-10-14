-- Hardening after review of create_core_tables.

-- 1. TRUNCATE ignores RLS, so no client role gets it. REFERENCES and TRIGGER
--    are not needed by the app either.

revoke truncate, references, trigger
  on public.profiles, public.companies, public.contacts, public.outreach
  from anon, authenticated;

-- 2. An outreach row's contact must belong to the same company and user.
--    The new foreign key covers (contact_id, user_id), so the old one and
--    its unique target are dropped. ON UPDATE is the default NO ACTION, so a
--    contact cannot move to another company while outreach rows point at it.

alter table public.contacts
  add constraint contacts_id_company_id_user_id_key
  unique (id, company_id, user_id);

alter table public.outreach
  drop constraint outreach_contact_id_user_id_fkey;

alter table public.outreach
  add constraint outreach_contact_id_company_id_user_id_fkey
  foreign key (contact_id, company_id, user_id)
  references public.contacts (id, company_id, user_id)
  on delete set null (contact_id);

alter table public.contacts
  drop constraint contacts_id_user_id_key;

drop index public.outreach_contact_id_user_id_idx;
create index outreach_contact_id_company_id_user_id_idx
  on public.outreach (contact_id, company_id, user_id);
