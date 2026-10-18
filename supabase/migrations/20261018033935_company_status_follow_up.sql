-- The list shows each company's status and follow-up date from its newest
-- outreach row. New columns are added at the end, so the view can be replaced.
create or replace view public.company_status
  with (security_invoker = true)
as
select distinct on (o.company_id)
       o.company_id,
       o.status,
       o.follow_up_on,
       o.sent_at
  from public.outreach as o
 order by o.company_id, o.created_at desc, o.id desc;

revoke all on public.company_status from public, anon;
grant select on public.company_status to authenticated;

-- No new policies: security_invoker keeps the outreach RLS policies in force.
