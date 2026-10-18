-- About me: graduation year, degree, major, and resume text (never the PDF).
alter table public.profiles
  add column grad_year smallint,
  add column degree text,
  add column major text,
  add column resume text,
  add constraint profiles_grad_year_range check (grad_year between 2000 and 2100),
  add constraint profiles_degree_length check (char_length(degree) <= 100),
  add constraint profiles_major_length check (char_length(major) <= 200),
  add constraint profiles_resume_length check (char_length(resume) <= 20000);

-- Claude's per-role fit verdicts for a company, with the profile key they
-- were judged against (stale once the profile changes).
alter table public.companies
  add column role_fit jsonb,
  add constraint companies_role_fit_shape check (role_fit is null or jsonb_typeof(role_fit) = 'object');

-- No new policies: the existing profiles and companies policies cover the new columns.
