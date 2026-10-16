-- Score weights each user can change on /profile. Defaults are SPEC.md's:
-- school +3, hometown/region +2, matching open role +2, early stage +1.
alter table public.profiles
  add column weight_school smallint not null default 3
    constraint profiles_weight_school_range check (weight_school between 0 and 10),
  add column weight_hometown smallint not null default 2
    constraint profiles_weight_hometown_range check (weight_hometown between 0 and 10),
  add column weight_open_role smallint not null default 2
    constraint profiles_weight_open_role_range check (weight_open_role between 0 and 10),
  add column weight_early_stage smallint not null default 1
    constraint profiles_weight_early_stage_range check (weight_early_stage between 0 and 10),
  add column updated_at timestamptz not null default now();

-- The same limits the /profile form enforces, so a direct API call can't
-- store more than the app would.
alter table public.profiles
  add constraint profiles_school_length check (char_length(school) <= 200),
  add constraint profiles_hometown_length check (char_length(hometown) <= 200),
  add constraint profiles_interests_allowed check (interests <@ array['tech', 'quant']::text[]),
  add constraint profiles_role_targets_count check (cardinality(role_targets) <= 20),
  add constraint profiles_writing_samples_count check (cardinality(writing_samples) <= 3);

-- No new policies: the existing "profiles: * own" policies (user_id = auth.uid())
-- cover the new columns.
