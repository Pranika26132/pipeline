-- Where a company is: offices, HQ and role locations, each with the page it
-- came from and, when there is one, the exact sentence quoted from it.
-- [{value, quote, source_url, kind: "office" | "role", from: "lookup" | "find"}]
-- Lookups add to this list and never remove entries.
alter table public.companies
  add column locations jsonb not null default '[]'
    constraint companies_locations_check check (jsonb_typeof(locations) = 'array' and pg_column_size(locations) <= 20000);

-- "Office or roles near my hometown or region": 0, 1 (default) or 2 points.
alter table public.profiles
  add column weight_region smallint not null default 1
    constraint profiles_weight_region_range check (weight_region between 0 and 10);

-- No new policies: the existing companies and profiles policies cover the new columns.
