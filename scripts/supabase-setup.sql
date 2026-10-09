-- Run this in Supabase Dashboard → SQL Editor.
-- After both streamers sign in once, add their auth.users UUIDs to tournament_admins.

create table if not exists public.tournament_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_state (
  id text primary key check (id = 'main'),
  state jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.tournament_state add column if not exists revision bigint not null default 1;

alter table public.tournament_admins enable row level security;
alter table public.tournament_state enable row level security;

-- Table privileges are still required in addition to RLS policies.
grant select on public.tournament_admins to authenticated;
grant select on public.tournament_state to anon, authenticated;
grant insert, update on public.tournament_state to authenticated;

-- A signed-in user can only check their own allowlist entry. Admin entries are managed in SQL Editor.
drop policy if exists "admins can read own allowlist entry" on public.tournament_admins;
create policy "admins can read own allowlist entry"
  on public.tournament_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Public/OBS pages may read the single tournament snapshot, but cannot write it.
drop policy if exists "anyone can read tournament state" on public.tournament_state;
create policy "anyone can read tournament state"
  on public.tournament_state for select to anon, authenticated
  using (true);

drop policy if exists "authorized streamers can insert tournament state" on public.tournament_state;
create policy "authorized streamers can insert tournament state"
  on public.tournament_state for insert to authenticated
  with check (id = 'main' and exists (
    select 1 from public.tournament_admins a where a.user_id = (select auth.uid())
  ));

drop policy if exists "authorized streamers can update tournament state" on public.tournament_state;
create policy "authorized streamers can update tournament state"
  on public.tournament_state for update to authenticated
  using (id = 'main' and exists (
    select 1 from public.tournament_admins a where a.user_id = (select auth.uid())
  ))
  with check (id = 'main' and exists (
    select 1 from public.tournament_admins a where a.user_id = (select auth.uid())
  ));

-- Enable database change events for Supabase Realtime (safe to rerun).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_state'
  ) then
    alter publication supabase_realtime add table public.tournament_state;
  end if;
end $$;


-- Optimistic concurrency: a stale controller cannot silently overwrite a newer save.
create or replace function public.save_tournament_state(p_state jsonb, p_expected_revision bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_row public.tournament_state%rowtype;
  current_row public.tournament_state%rowtype;
begin
  if p_expected_revision = 0 then
    insert into public.tournament_state (id, state, revision, updated_at)
    values ('main', p_state, 1, now())
    on conflict (id) do nothing
    returning * into saved_row;
  else
    update public.tournament_state
      set state = p_state, revision = revision + 1, updated_at = now()
      where id = 'main' and revision = p_expected_revision
      returning * into saved_row;
  end if;

  if found then
    return jsonb_build_object('ok', true, 'revision', saved_row.revision,
      'updated_at', saved_row.updated_at, 'state', saved_row.state);
  end if;

  select * into current_row from public.tournament_state where id = 'main';
  return jsonb_build_object('ok', false, 'revision', coalesce(current_row.revision, 0),
    'updated_at', current_row.updated_at, 'state', current_row.state);
end;
$$;

grant execute on function public.save_tournament_state(jsonb, bigint) to authenticated;
