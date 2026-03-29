-- ============================================================
-- v5 migration — encryption key table + user route support
-- ============================================================

-- ── model_encryption_keys ─────────────────────────────────────────────────────
-- Stores AES-256-GCM keys for encrypted IPFS uploads.
-- Only the backend (service role) may read this table — no RLS SELECT policy.
-- Purchasers retrieve keys via GET /api/ipfs/key/{hash} after purchase verify.

create table if not exists public.model_encryption_keys (
  ipfs_hash    text    primary key,
  key_b64      text    not null,
  owner_wallet text    not null,
  encrypted    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.model_encryption_keys enable row level security;

-- No SELECT policy — service role only (backend uses service key after JWT verify).
-- No INSERT/UPDATE policy — same reason.

-- ── users.role column (idempotent guard) ──────────────────────────────────────
-- The role column was added in migration 20240301000000_add_role_column.sql.
-- This guard is a no-op if it already exists, safe to run again.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'users' and column_name = 'role' and table_schema = 'public'
  ) then
    alter table public.users add column role text not null default 'user'
      check (role in ('user', 'creator', 'admin'));
  end if;
end $$;

-- ── record_purchase race fix (idempotent, already in v4 migration) ────────────
-- Reproduced here for completeness — safe to run on a fresh DB.
create or replace function record_purchase(
  p_model_id      bigint,
  p_buyer_address text,
  p_price_eth     numeric,
  p_tx_hash       text default null
)
returns void
language plpgsql
as $$
declare
  v_rows_inserted integer;
begin
  insert into public.purchases (model_id, buyer_address, price_paid_eth, on_chain_tx)
  values (p_model_id, lower(p_buyer_address), p_price_eth, p_tx_hash)
  on conflict (model_id, buyer_address) do nothing;

  get diagnostics v_rows_inserted = row_count;

  if v_rows_inserted > 0 then
    update public.models
    set purchases = purchases + 1
    where id = p_model_id;
  end if;
end;
$$;
