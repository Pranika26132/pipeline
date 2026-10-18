-- A person found by founder research (when the company's own pages name no
-- one) keeps the sentence that names them as founder or CEO of this company.
alter table public.contacts
  add column source_quote text,
  add constraint contacts_source_quote_length check (char_length(source_quote) <= 1000);

-- No new policies: the existing contacts policies cover the new column.
