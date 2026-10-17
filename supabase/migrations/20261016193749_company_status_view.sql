-- The newest outreach status per company, so the list reads one row per
-- company instead of every outreach row. security_invoker makes the view
-- run with the caller's rights, so the outreach RLS policies still apply.
create view public.company_status
  with (security_invoker = true)
as
select distinct on (o.company_id)
       o.company_id,
       o.status
  from public.outreach as o
 order by o.company_id, o.created_at desc, o.id desc;

revoke all on public.company_status from public, anon;
grant select on public.company_status to authenticated;
