-- مدار: notifications on the phone with the app closed (Web Push). Run after sync.sql.

-- one row per device that turned notifications on
create table if not exists public.push_subs (
  endpoint   text primary key,
  auth_uid   uuid not null,
  p256dh     text not null,
  auth       text not null,
  ua         text,
  created_at timestamptz not null default now()
);
-- which notification already went to which device
create table if not exists public.push_sent (
  notification_id text not null,
  endpoint        text not null,
  at              timestamptz not null default now(),
  primary key (notification_id, endpoint)
);
alter table public.push_subs enable row level security;
alter table public.push_sent enable row level security;
-- (no policies: only the functions below and the server touch these)

-- a device saves itself under whoever is signed in on it now
create or replace function public.save_push_sub(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member() then raise exception 'not a member'; end if;
  insert into push_subs (endpoint, auth_uid, p256dh, auth, ua) values (p_endpoint, auth.uid(), p_p256dh, p_auth, p_ua)
  on conflict (endpoint) do update set auth_uid = excluded.auth_uid, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua;
end $$;
revoke all on function public.save_push_sub(text, text, text, text) from public, anon;
grant execute on function public.save_push_sub(text, text, text, text) to authenticated;

-- the signing key for push, readable by the server only
create schema if not exists private;
create table if not exists private.settings (key text primary key, value text not null);
create or replace function public.push_private_key() returns text
language sql stable security definer set search_path = private as $$ select value from private.settings where key = 'vapid_private' $$;
revoke all on function public.push_private_key() from public, anon, authenticated;
grant execute on function public.push_private_key() to service_role;
-- then once: insert into private.settings values ('vapid_private', '<key>');

-- every new notification wakes madar-push right away; Cron also wakes it every minute for reminders
create extension if not exists pg_net;
create extension if not exists pg_cron;
create or replace function public.wake_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from new_rows where kind = 'notifications') then
    perform net.http_post('https://nunkfonzbgkigrukhszt.supabase.co/functions/v1/madar-push', '{"tick":true}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 5000);
  end if;
  return null;
end $$;
-- once per statement, so a big sync upload wakes it once, not once per row
drop trigger if exists wake_push on public.records;
create trigger wake_push after insert on public.records
  referencing new table as new_rows
  for each statement execute function public.wake_push();

select cron.unschedule('madar-push') where exists (select 1 from cron.job where jobname = 'madar-push');
select cron.schedule('madar-push', '* * * * *', $$ select net.http_post('https://nunkfonzbgkigrukhszt.supabase.co/functions/v1/madar-push', '{"tick":true}'::jsonb, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 5000) $$);
