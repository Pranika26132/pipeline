-- Columns filled by enrichment. No new tables: the existing per-user
-- companies policies (user_id = auth.uid()) cover these columns.

alter table public.companies
  -- [{ "title": text, "location": text|null, "source_url": text }]
  add column open_roles jsonb not null default '[]'
    check (jsonb_typeof(open_roles) = 'array'),
  -- Page each company fact came from: { "summary": url, "stage": url, "size": url }
  add column field_sources jsonb not null default '{}'
    check (jsonb_typeof(field_sources) = 'object'),
  -- Time of the last enrichment attempt, successful or not.
  add column enriched_at timestamptz,
  -- Why the last attempt failed or came back incomplete, shown to the user.
  add column enrich_error text;
