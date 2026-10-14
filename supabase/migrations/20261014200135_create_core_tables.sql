-- Core tables: profiles, companies, contacts, outreach.
-- Every row belongs to one user. RLS limits each user to their own rows.

-- profiles: one row per user ------------------------------------------------

create table public.profiles (
  user_id uuid primary key default auth.uid()
    references auth.users (id) on delete cascade,
  school text,
  hometown text,
  interests text[] not null default '{}',
  role_targets text[] not null default '{}',
  writing_samples text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- companies ---------------------------------------------------------------

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  url text,
  -- Lowercase host without "www.", e.g. "example.com". Used to dedupe.
  domain text not null check (domain <> '' and domain = lower(domain)),
  summary text,
  stage text,
  size text,
  source text,
  score integer,
  score_reasons jsonb not null default '[]',
  needs_manual_info boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, domain),
  -- Target for the composite foreign keys below.
  unique (id, user_id)
);

-- contacts ----------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  company_id uuid not null,
  name text not null,
  title text,
  school text,
  hometown text,
  source_url text,
  email text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  -- The company must belong to the same user.
  foreign key (company_id, user_id)
    references public.companies (id, user_id) on delete cascade
);

create index contacts_company_id_user_id_idx on public.contacts (company_id, user_id);
create index contacts_user_id_idx on public.contacts (user_id);

-- outreach ----------------------------------------------------------------

create table public.outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  company_id uuid not null,
  -- Null means the draft is addressed to "the team".
  contact_id uuid,
  draft text,
  status text not null default 'to_contact' check (status in (
    'to_contact', 'drafted', 'sent', 'replied', 'interview', 'rejected', 'ghosted'
  )),
  sent_at timestamptz,
  follow_up_on date,
  created_at timestamptz not null default now(),
  -- The company and the contact must belong to the same user.
  foreign key (company_id, user_id)
    references public.companies (id, user_id) on delete cascade,
  foreign key (contact_id, user_id)
    references public.contacts (id, user_id) on delete set null (contact_id)
);

create index outreach_company_id_user_id_idx on public.outreach (company_id, user_id);
create index outreach_contact_id_user_id_idx on public.outreach (contact_id, user_id);
create index outreach_user_id_idx on public.outreach (user_id);

-- Row level security ------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.outreach enable row level security;

-- Signed-out visitors get no access at all.
revoke all on public.profiles, public.companies, public.contacts, public.outreach from anon;

-- profiles

create policy "profiles: select own" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles: insert own" on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "profiles: delete own" on public.profiles
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- companies

create policy "companies: select own" on public.companies
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "companies: insert own" on public.companies
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "companies: update own" on public.companies
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "companies: delete own" on public.companies
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- contacts

create policy "contacts: select own" on public.contacts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "contacts: insert own, for own company" on public.contacts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.user_id = (select auth.uid())
    )
  );

create policy "contacts: update own, for own company" on public.contacts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.user_id = (select auth.uid())
    )
  );

create policy "contacts: delete own" on public.contacts
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- outreach

create policy "outreach: select own" on public.outreach
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "outreach: insert own, for own company and contact" on public.outreach
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.user_id = (select auth.uid())
    )
    and (
      contact_id is null
      or exists (
        select 1 from public.contacts ct
        where ct.id = contact_id
          and ct.user_id = (select auth.uid())
          and ct.company_id = outreach.company_id
      )
    )
  );

create policy "outreach: update own, for own company and contact" on public.outreach
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.user_id = (select auth.uid())
    )
    and (
      contact_id is null
      or exists (
        select 1 from public.contacts ct
        where ct.id = contact_id
          and ct.user_id = (select auth.uid())
          and ct.company_id = outreach.company_id
      )
    )
  );

create policy "outreach: delete own" on public.outreach
  for delete to authenticated
  using (user_id = (select auth.uid()));
