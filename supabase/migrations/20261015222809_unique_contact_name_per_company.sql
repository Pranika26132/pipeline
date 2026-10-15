-- One contact per name per company, so two overlapping enrichment runs
-- can't save the same person twice. Names compare case-insensitively.
create unique index contacts_company_id_name_key
  on public.contacts (company_id, lower(btrim(name)));
