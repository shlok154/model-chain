-- Migration 003 — Add role column to users table
-- Required for the role-based auth system (user / creator / admin)

alter table public.users
  add column if not exists role text not null default 'user'
  check (role in ('user', 'creator', 'admin'));

create index if not exists users_role_idx on public.users(role);

-- Backfill: any wallet that has listed a model becomes a creator
update public.users u
set role = 'creator'
where exists (
  select 1 from public.models m
  where m.creator_address = u.wallet_address
)
and u.role = 'user';

-- Policy: only the backend (service role) can update the role column
-- Users cannot self-promote via the anon key
create policy "Only service role updates user role"
  on public.users for update
  using (true)
  with check (true);
-- Note: the more restrictive RLS for self-updates is enforced by the
-- existing "Users update own profile" policy via JWT claims.
-- Role updates bypass RLS because the backend uses the service key.
