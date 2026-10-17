-- Where each person fact came from. Founder research finds a school or
-- hometown on a different page than the team page, so each fact keeps its
-- own source link and the sentence that states it.
alter table public.contacts
  add column school_source_url text,
  add column school_quote text,
  add column hometown_source_url text,
  add column hometown_quote text,
  -- Typed by the user on the company page rather than found by a lookup.
  add column added_by_user boolean not null default false,
  add constraint contacts_name_length check (char_length(name) between 1 and 200),
  add constraint contacts_title_length check (char_length(title) <= 200),
  add constraint contacts_school_length check (char_length(school) <= 200),
  add constraint contacts_hometown_length check (char_length(hometown) <= 200),
  add constraint contacts_email_length check (char_length(email) <= 320),
  add constraint contacts_source_url_length check (char_length(source_url) <= 2000),
  add constraint contacts_school_source_url_length check (char_length(school_source_url) <= 2000),
  add constraint contacts_hometown_source_url_length check (char_length(hometown_source_url) <= 2000),
  add constraint contacts_school_quote_length check (char_length(school_quote) <= 1000),
  add constraint contacts_hometown_quote_length check (char_length(hometown_quote) <= 1000);

-- A tag from an imported list (CSV "connection" column), e.g. "Duke" for a
-- list of Duke-founded companies, with the page the list came from.
alter table public.companies
  add column connection text,
  add column connection_source_url text,
  -- Last founder research run; also its cooldown claim.
  add column researched_at timestamptz,
  add constraint companies_connection_length check (char_length(connection) <= 200),
  add constraint companies_connection_source_url_length check (char_length(connection_source_url) <= 2000);

-- No new policies: the existing contacts and companies policies
-- (user_id = auth.uid(), and contacts only for the user's own companies)
-- cover the new columns.
