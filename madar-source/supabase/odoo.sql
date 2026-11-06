-- مدار: attendance from Odoo (hr.attendance) -> Madar attendance -> monthly commitment score.
-- Run after sync.sql and push.sql. The madar-odoo function does the work.

-- one Odoo database per Madar company. Only the server (service role) can read it: no policies on
-- purpose, so the API keys never reach a browser. The owner sets them from Madar's settings through the function.
create table if not exists public.odoo_connections (
  company_id  text primary key,   -- Madar company id
  url         text not null,
  db          text not null default '',
  login       text not null,
  api_key     text not null,
  tz          text not null default 'Africa/Cairo',
  cursor      text,               -- last hr.attendance write_date already pulled (Odoo UTC "YYYY-MM-DD HH:MM:SS")
  since       date,               -- history pulled from this day on
  last_sync   timestamptz,
  last_result jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.odoo_connections enable row level security;
revoke all on public.odoo_connections from anon, authenticated;

-- pull new check-ins/outs every 10 minutes
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule('madar-odoo') where exists (select 1 from cron.job where jobname = 'madar-odoo');
select cron.schedule('madar-odoo', '*/10 * * * *', $$ select net.http_post('https://nunkfonzbgkigrukhszt.supabase.co/functions/v1/madar-odoo', '{"tick":true}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 120000) $$);
