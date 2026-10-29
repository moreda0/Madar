-- مدار: online sync (run once in Supabase → SQL Editor → New query → Run)
-- One Supabase project = one Madar workspace (all of your companies).
-- The app keeps every record (task, company, attendance…) as a JSON row here,
-- and every device listens for changes live.

-- people allowed into this workspace, by email
create table if not exists public.workspace_members (
  email      text primary key check (email = lower(email)),
  user_id    uuid,
  role       text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now()
);

-- every synced record: kind = 'tasks' | 'companies' | 'users' | …
create table if not exists public.records (
  kind       text not null,
  id         text not null,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (kind, id)
);
create index if not exists records_updated_idx on public.records (updated_at);

-- ---------- helpers ----------
create or replace function public.my_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where email = my_email())
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where email = my_email() and role = 'owner')
$$;

-- First person to connect becomes the owner. Everyone else must be added (by email) first.
-- Returns: 'owner-new' (workspace was empty, you now own it), 'owner', 'member', or 'not-invited'
create or replace function public.claim_workspace() returns text
language plpgsql security definer set search_path = public as $$
declare
  e text := my_email();
  r text;
begin
  if e = '' then return 'not-invited'; end if;
  if not exists (select 1 from workspace_members) then
    insert into workspace_members (email, user_id, role) values (e, auth.uid(), 'owner');
    return 'owner-new';
  end if;
  select role into r from workspace_members where email = e;
  if r is null then return 'not-invited'; end if;
  update workspace_members set user_id = auth.uid() where email = e and user_id is distinct from auth.uid();
  return r;
end $$;

-- stamp who/when on every write
create or replace function public.records_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();

-- ---------- security ----------
alter table public.records enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists records_read on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
create policy records_read   on public.records for select using (public.is_member());
create policy records_insert on public.records for insert with check (public.is_member());
create policy records_update on public.records for update using (public.is_member()) with check (public.is_member());
-- no delete policy: the app marks rows deleted instead, so other devices learn about it

drop policy if exists members_read on public.workspace_members;
drop policy if exists members_invite on public.workspace_members;
drop policy if exists members_remove on public.workspace_members;
create policy members_read   on public.workspace_members for select using (public.is_member());
create policy members_invite on public.workspace_members for insert with check (public.is_member() and role = 'member');
create policy members_remove on public.workspace_members for delete using (public.is_owner() and role <> 'owner');

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.records to authenticated;
grant select, insert, delete on public.workspace_members to authenticated;
grant execute on function public.claim_workspace(), public.is_member(), public.is_owner(), public.my_email() to authenticated;

-- live updates to every open device
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; when undefined_object then null;
end $$;
