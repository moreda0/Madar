-- مدار (Madar) — database schema for Supabase (Postgres)
-- Phase 2 swaps the app's local store for these tables. Same shapes as src/lib/types.ts.
-- Run in the Supabase SQL editor on a fresh project.

create extension if not exists "pgcrypto";

-- ---------- types ----------
create type member_role   as enum ('admin', 'manager', 'employee');
create type unit_type     as enum ('division', 'department', 'team');
create type task_status   as enum ('todo', 'doing', 'review', 'done');
create type task_priority as enum ('low', 'medium', 'high', 'urgent');
create type check_method  as enum ('gps', 'qr', 'manual');
create type notif_kind    as enum ('assigned', 'reminder', 'overdue', 'comment', 'status', 'attendance', 'system');

-- ---------- people & companies ----------
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null,
  initials    text not null default '',
  phone       text,               -- E.164, used for WhatsApp in phase 4
  created_at  timestamptz not null default now()
);

create table companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  short           text not null,
  color           text not null default '#22D3EE',
  work_start      time not null default '09:00',
  work_end        time not null default '17:00',
  grace_minutes   int  not null default 15,
  geofence_lat    double precision,
  geofence_lng    double precision,
  geofence_radius int,
  geofence_label  text,
  strict_geofence boolean not null default false,
  qr_secret       text not null default encode(gen_random_bytes(8), 'hex'),
  created_at      timestamptz not null default now()
);

create table org_units (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies on delete cascade,
  parent_id   uuid references org_units on delete set null,
  type        unit_type not null,
  name        text not null,
  manager_id  uuid references profiles on delete set null
);
create index on org_units (company_id);

create table memberships (
  user_id     uuid not null references profiles on delete cascade,
  company_id  uuid not null references companies on delete cascade,
  role        member_role not null default 'employee',
  unit_id     uuid references org_units on delete set null,
  title       text,
  primary key (user_id, company_id)
);

-- ---------- tasks ----------
create table tasks (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies on delete cascade,
  unit_id        uuid references org_units on delete set null,
  title          text not null,
  description    text not null default '',
  status         task_status not null default 'todo',
  priority       task_priority not null default 'medium',
  assignee_id    uuid references profiles on delete set null,
  creator_id     uuid not null references profiles,
  due_at         timestamptz,
  remind_before  int not null default 30,   -- minutes
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index on tasks (company_id, status);
create index on tasks (assignee_id, due_at);

create table subtasks (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references tasks on delete cascade,
  title    text not null,
  done     boolean not null default false,
  position int not null default 0
);

create table task_comments (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references tasks on delete cascade,
  user_id  uuid not null references profiles,
  text     text not null,
  at       timestamptz not null default now()
);

-- ---------- notifications & attendance ----------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles on delete cascade,
  company_id  uuid references companies on delete cascade,
  kind        notif_kind not null,
  title       text not null,
  body        text not null default '',
  task_id     uuid references tasks on delete cascade,
  at          timestamptz not null default now(),
  read        boolean not null default false
);
create index on notifications (user_id, read, at desc);

create table attendance (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles on delete cascade,
  company_id        uuid not null references companies on delete cascade,
  check_in_at       timestamptz not null default now(),
  check_out_at      timestamptz,
  method            check_method not null,
  lat               double precision,
  lng               double precision,
  accuracy          int,
  distance_m        int,
  inside_fence      boolean,
  late              boolean not null default false,
  planned_task_ids  uuid[] not null default '{}',
  note              text
);
create index on attendance (company_id, check_in_at desc);

-- ---------- access helpers ----------
create or replace function my_role(c uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from memberships where user_id = auth.uid() and company_id = c
$$;

-- units the current user manages (and everything under them)
create or replace function my_units(c uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive tree as (
    select id from org_units where company_id = c and (
      manager_id = auth.uid()
      or id = (select unit_id from memberships where user_id = auth.uid() and company_id = c and role = 'manager')
    )
    union
    select u.id from org_units u join tree t on u.parent_id = t.id
  ) select id from tree
$$;

create or replace function can_see_task(t tasks) returns boolean
language sql stable security definer set search_path = public as $$
  select case my_role(t.company_id)
    when 'admin' then true
    when 'manager' then t.assignee_id = auth.uid() or t.creator_id = auth.uid()
      or t.unit_id in (select my_units(t.company_id))
      or (select unit_id from memberships m where m.user_id = t.assignee_id and m.company_id = t.company_id) in (select my_units(t.company_id))
    when 'employee' then t.assignee_id = auth.uid() or t.creator_id = auth.uid()
    else false
  end
$$;

-- ---------- row level security ----------
alter table profiles      enable row level security;
alter table companies     enable row level security;
alter table org_units     enable row level security;
alter table memberships   enable row level security;
alter table tasks         enable row level security;
alter table subtasks      enable row level security;
alter table task_comments enable row level security;
alter table notifications enable row level security;
alter table attendance    enable row level security;

-- profiles: see yourself and anyone sharing a company
create policy profiles_read on profiles for select using (
  id = auth.uid() or exists (
    select 1 from memberships a join memberships b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_self on profiles for update using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());

-- companies: members read, admins write; anyone signed in can create one
create policy companies_read   on companies for select using (my_role(id) is not null);
create policy companies_admin  on companies for update using (my_role(id) = 'admin');
create policy companies_delete on companies for delete using (my_role(id) = 'admin');
create policy companies_create on companies for insert with check (auth.uid() is not null);

create policy units_read  on org_units for select using (my_role(company_id) is not null);
create policy units_write on org_units for all using (my_role(company_id) = 'admin') with check (my_role(company_id) = 'admin');

create policy members_read  on memberships for select using (my_role(company_id) is not null);
create policy members_write on memberships for all using (my_role(company_id) = 'admin') with check (my_role(company_id) = 'admin');
-- creator of a brand-new company becomes its first admin
create policy members_bootstrap on memberships for insert with check (
  user_id = auth.uid() and role = 'admin'
  and not exists (select 1 from memberships m where m.company_id = memberships.company_id)
);

create policy tasks_read   on tasks for select using (can_see_task(tasks));
create policy tasks_insert on tasks for insert with check (my_role(company_id) is not null and creator_id = auth.uid());
create policy tasks_update on tasks for update using (can_see_task(tasks));
create policy tasks_delete on tasks for delete using (my_role(company_id) = 'admin' or creator_id = auth.uid());

create policy subtasks_all on subtasks for all
  using (exists (select 1 from tasks t where t.id = task_id and can_see_task(t)))
  with check (exists (select 1 from tasks t where t.id = task_id and can_see_task(t)));
create policy comments_read on task_comments for select
  using (exists (select 1 from tasks t where t.id = task_id and can_see_task(t)));
create policy comments_insert on task_comments for insert
  with check (user_id = auth.uid() and exists (select 1 from tasks t where t.id = task_id and can_see_task(t)));

create policy notif_own on notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy att_read on attendance for select using (
  user_id = auth.uid() or my_role(company_id) in ('admin', 'manager')
);
create policy att_insert on attendance for insert with check (user_id = auth.uid() and my_role(company_id) is not null);
create policy att_checkout on attendance for update using (user_id = auth.uid());

-- live updates for the app (task boards, bell icon, team attendance)
alter publication supabase_realtime add table tasks, notifications, attendance;
