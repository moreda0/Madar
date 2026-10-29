-- مدار: WhatsApp two-way alerts (run once in Supabase → SQL Editor, after sync.sql)
-- Only the madar-whatsapp function (service role) touches these tables; the app never reads them.

-- which notification went to which phone (so nothing is sent twice)
create table if not exists public.wa_sent (
  notification_id text primary key,
  user_id    text not null,
  task_id    text,
  phone      text not null,
  wa_id      text,
  sent_at    timestamptz not null default now()
);

-- per phone: the last numbered list we sent, and an action waiting for "تمام"
create table if not exists public.wa_state (
  phone      text primary key,
  last_list  jsonb not null default '[]',
  pending    jsonb,
  updated_at timestamptz not null default now()
);

-- "فكّريني بعد ساعة"
create table if not exists public.wa_snooze (
  id         bigserial primary key,
  task_id    text not null,
  user_id    text not null,
  remind_at  timestamptz not null,
  done       boolean not null default false
);
create index if not exists wa_snooze_due on public.wa_snooze (remind_at) where not done;

alter table public.wa_sent enable row level security;
alter table public.wa_state enable row level security;
alter table public.wa_snooze enable row level security;
-- no policies: only the server function (service role) can read or write them
