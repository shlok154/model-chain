-- ============================================================
-- ModelChain — Supabase Schema  (v2 — full fixes applied)
-- Run this entire file in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
create table if not exists public.users (
  wallet_address  text primary key,           -- lowercase Ethereum address
  display_name    text,
  bio             text,
  avatar_url      text,
  twitter         text,
  github          text,
  is_verified     boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ── MODELS ───────────────────────────────────────────────────
-- FIX 4: price_eth is now numeric so sorting/filtering works correctly.
--         "0.9" > "0.10" alphabetically but 0.9 > 0.10 numerically — we want the latter.
create table if not exists public.models (
  id               bigint generated always as identity primary key,
  name             text not null,
  description      text not null,
  price_eth        numeric(18, 8) not null,   -- FIX 4: was text, now numeric
  ipfs_hash        text not null,
  version          text not null default '1.0.0',
  license          text not null default 'MIT',
  category         text not null,
  royalty_percent  integer not null default 10 check (royalty_percent between 0 and 50),
  creator_address  text not null references public.users(wallet_address),
  purchases        integer not null default 0,
  tx_hash          text,
  is_simulated     boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists models_creator_idx  on public.models(creator_address);
create index if not exists models_category_idx on public.models(category);
create index if not exists models_price_idx    on public.models(price_eth);

-- ── PURCHASES (FIX 3: new table so buyers can see their library) ──────────
-- Each row records one buyer purchasing one model.
-- on_chain_tx is nullable for demo/off-chain purchases.
create table if not exists public.purchases (
  id               bigint generated always as identity primary key,
  model_id         bigint not null references public.models(id) on delete cascade,
  buyer_address    text not null,
  price_paid_eth      numeric(18, 8) not null,
  on_chain_tx         text,                       -- tx hash from the blockchain
  verification_source text,                       -- e.g. 'event_listener', 'chain_fallback'
  is_simulated        boolean not null default false,
  purchased_at        timestamptz not null default now()
);

create index if not exists purchases_buyer_idx on public.purchases(buyer_address);
create index if not exists purchases_model_idx on public.purchases(model_id);
-- Prevent duplicate rows for the same buyer+model combination.
create unique index if not exists purchases_unique_idx
  on public.purchases(model_id, buyer_address);

-- ── DOWNLOADS (Audit Logging) ────────────────────────────────────────────────
-- Tracks every time a user downloads a model for analytics and abuse detection.
create table if not exists public.downloads (
  id               bigint generated always as identity primary key,
  model_id         bigint not null references public.models(id) on delete cascade,
  user_address     text not null,
  source           text,
  downloaded_at    timestamptz not null default now()
);
create index if not exists downloads_model_idx on public.downloads(model_id);
create index if not exists downloads_user_idx on public.downloads(user_address);
create unique index if not exists downloads_unique_once on public.downloads(model_id, user_address);

-- ── RPC: increment_purchases ──────────────────────────────────
-- Called after a confirmed purchase to keep the purchases counter in sync.
create or replace function increment_purchases(model_id bigint)
returns void
language sql
as $$
  update public.models
  set purchases = purchases + 1
  where id = model_id;
$$;

-- ── RPC: record_purchase ──────────────────────────────────────
-- Atomically inserts a purchase row AND increments the model counter.
--
-- Race-condition fix: we use GET DIAGNOSTICS to check whether the INSERT
-- actually wrote a new row. If the unique constraint fired (ON CONFLICT DO
-- NOTHING), ROW_COUNT is 0, which means this buyer already purchased and we
-- must NOT double-increment the counter. This is fully atomic within the
-- transaction — no NOT EXISTS subquery that could be evaluated before a
-- concurrent INSERT commits.
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

  -- GET DIAGNOSTICS reads the actual row count from THIS statement inside
  -- THIS transaction, so concurrent inserts for the same buyer+model will
  -- each see their own v_rows_inserted = 0 after the conflict fires.
  get diagnostics v_rows_inserted = row_count;

  -- Only increment the counter when a genuinely new purchase was recorded.
  if v_rows_inserted > 0 then
    update public.models
    set purchases = purchases + 1
    where id = p_model_id;
  end if;
end;
$$;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
alter table public.users     enable row level security;
alter table public.models    enable row level security;
alter table public.purchases enable row level security;

-- ── USERS policies ───────────────────────────────────────────
-- Anyone can read public profiles.
create policy "Public read users"
  on public.users for select using (true);

-- Anyone can create a profile row (wallet address is the identity).
create policy "Users insert own profile"
  on public.users for insert
  with check (true);

-- FIX 5: Tightened — users can only update their OWN profile row.
-- The app passes the wallet address; we match it against the PK.
-- In production you'd validate this via a Supabase auth JWT claim,
-- but for a wallet-auth app this check prevents cross-profile updates
-- from the anon key by ensuring the row's PK matches what the app sends.
--
-- To make this truly server-enforced, create a Supabase Edge Function
-- that validates a signed message from the wallet before calling update.
create policy "Users update own profile"
  on public.users for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address')
  with check (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- ── MODELS policies ──────────────────────────────────────────
-- Anyone can read models (public marketplace).
create policy "Public read models"
  on public.models for select using (true);

-- Server-Side Event Listener inserts models via service_role. End user direct insertion is disabled.
-- (Removed "Anyone can list models" policy)

-- FIX 5: Only the creator of a model can update it.
create policy "Creator updates own model"
  on public.models for update
  using (creator_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- ── PURCHASES policies ────────────────────────────────────────
-- Buyers can read their own purchase history.
create policy "Buyers read own purchases"
  on public.purchases for select
  using (buyer_address = lower(current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- Creators can see who bought their models.
create policy "Creators read purchases of their models"
  on public.purchases for select
  using (
    model_id in (
      select id from public.models
      where creator_address = lower(current_setting('request.jwt.claims', true)::json->>'wallet_address')
    )
  );

-- Purchases are inserted strictly by the Backend Service via RPC, not direct frontend queries.
-- (Removed "Anyone can record purchases" policy)

-- ── SEED DATA (optional — comment out for production) ─────────
insert into public.users (wallet_address, display_name, is_verified) values
  ('0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 'NLP Labs', true),
  ('0xab5801a7d398351b8be11c439e05c5b3259aec9b', 'Vision AI', true),
  ('0x1db3439a222c519ab44bb1144fc28167b4fa6ee6', 'GenModel Studio', false)
on conflict (wallet_address) do nothing;

insert into public.models
  (name, description, price_eth, ipfs_hash, version, license, category, royalty_percent, creator_address, purchases)
values
  ('Sentiment Analyzer Pro', 'Fine-tuned BERT for real-time sentiment classification across 12 languages with 94.3% accuracy.',
   0.08, 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco', '2.1.0', 'MIT', 'NLP', 10,
   '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 142),
  ('VisionNet Edge', 'Lightweight object detection model optimized for edge deployment. Runs at 60fps on mobile GPUs.',
   0.14, 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o', '1.3.2', 'Apache 2.0', 'Computer Vision', 8,
   '0xab5801a7d398351b8be11c439e05c5b3259aec9b', 89),
  ('LLM Mini 7B', 'Quantized 7B parameter language model, fine-tuned for code generation and debugging tasks.',
   0.22, 'QmSiTko9JZyabH56y2fussEt1A5oDqsFXB3CkvAqraFryz', '1.0.0', 'CC BY-NC 4.0', 'LLM', 15,
   '0x1db3439a222c519ab44bb1144fc28167b4fa6ee6', 311),
  ('AudioClip Transcriber', 'Whisper-based transcription model with speaker diarization. 98.1% accuracy on clean audio.',
   0.06, 'QmfM2r8seH2GiRaC4esTjeraXEachRt8ZsSeGaWTPLyMoG', '3.0.1', 'MIT', 'Audio', 12,
   '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 204),
  ('TabularNet Regressor', 'XGBoost-neural hybrid for tabular regression. Outperforms vanilla XGBoost by 18% on benchmark datasets.',
   0.05, 'QmNLei78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8z', '1.1.0', 'MIT', 'Tabular', 5,
   '0xab5801a7d398351b8be11c439e05c5b3259aec9b', 57),
  ('DiffusionXL Fine-Tuner', 'SDXL LoRA trained on 50k curated art images. Produces stunning photorealistic renders.',
   0.35, 'QmYwAPJzv5CZsnAzt8auV39s1XRd9a6PqXqjS8Zs6jPBp4', '2.0.0', 'CC BY 4.0', 'Generative', 20,
   '0x1db3439a222c519ab44bb1144fc28167b4fa6ee6', 478);

-- ============================================================
-- v2 additions — reviews, updated RLS for JWT-based auth
-- ============================================================

-- ── REVIEWS (Phase 4) ────────────────────────────────────────
create table if not exists public.reviews (
  id           bigint generated always as identity primary key,
  model_id     bigint not null references public.models(id) on delete cascade,
  user_address text not null references public.users(wallet_address) on delete cascade,
  rating       integer not null check (rating between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now()
);

create unique index if not exists reviews_unique_idx on public.reviews(model_id, user_address);
create index if not exists reviews_model_idx on public.reviews(model_id);

alter table public.reviews enable row level security;

create policy "Anyone can read reviews"
  on public.reviews for select using (true);

create policy "Buyers can submit reviews"
  on public.reviews for insert
  with check (true);   -- backend validates purchase before insert

create policy "Reviewers update own review"
  on public.reviews for update
  using (user_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- ── NODES (Phase 2 staking) ──────────────────────────────────
create table if not exists public.nodes (
  id           bigint generated always as identity primary key,
  user_id      text not null references public.users(wallet_address),
  stake_amount numeric(18,8) not null default 0,
  reputation   integer not null default 100,
  status       text not null default 'active' check (status in ('active','slashed','inactive')),
  registered_at timestamptz not null default now()
);

create index if not exists nodes_user_idx on public.nodes(user_id);
alter table public.nodes enable row level security;

create policy "Public read nodes"   on public.nodes for select using (true);
create policy "Owner manages nodes" on public.nodes for all
  using (user_id = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- ── TRANSACTIONS log ─────────────────────────────────────────
create table if not exists public.transactions (
  id         bigint generated always as identity primary key,
  tx_hash    text unique not null,
  type       text not null check (type in ('purchase','list','withdraw','stake','unstake')),
  wallet     text not null,
  model_id   bigint references public.models(id),
  amount_eth numeric(18,8),
  status     text not null default 'confirmed' check (status in ('pending','confirmed','failed')),
  created_at timestamptz not null default now()
);

create index if not exists transactions_wallet_idx on public.transactions(wallet);
alter table public.transactions enable row level security;

create policy "Users read own transactions"
  on public.transactions for select
  using (wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');

create policy "Backend inserts transactions"
  on public.transactions for insert with check (true);

-- ============================================================
-- v3 migration — FK fix for reviews → users join
-- Run this if you already have a deployed reviews table without the FK.
-- Safe to run multiple times (constraint name is unique).
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'reviews_user_address_fkey'
      and table_name = 'reviews'
  ) then
    alter table public.reviews
      add constraint reviews_user_address_fkey
      foreign key (user_address)
      references public.users(wallet_address)
      on delete cascade;
  end if;
end $$;

-- ============================================================
-- v4 migration — encryption key storage + RLS documentation
-- ============================================================

-- ── MODEL ENCRYPTION KEYS ────────────────────────────────────
-- Stores the AES-256-GCM key for each encrypted IPFS upload.
-- The key is only returned to wallets that have a verified purchase
-- (enforced in FastAPI, not by RLS — see SECURITY.md).
--
-- IMPORTANT: This table must NEVER be readable via the anon key.
-- The backend uses the service key and applies its own auth check.
-- RLS is enabled but all policies are DENY by default; the backend
-- bypasses RLS entirely with the service key after JWT verification.
create table if not exists public.model_encryption_keys (
  ipfs_hash    text    primary key,
  key_b64      text    not null,            -- base64-encoded AES-256 key
  owner_wallet text    not null,
  encrypted    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- RLS enabled — all direct client access denied by default.
-- Backend uses service key with explicit wallet filtering.
alter table public.model_encryption_keys enable row level security;

-- No SELECT policy for anon/authenticated roles.
-- Only the service role (backend) can read this table.
-- This is intentional: keys must never be exposed via the Supabase JS client.

-- ── RLS POLICY CLARIFICATIONS ────────────────────────────────
-- The following comment documents the intent of existing `with check (true)` policies.
-- These are NOT security controls — they are write-permission grants that exist
-- because FastAPI validates all writes before they reach Supabase.
-- The real security boundary is FastAPI + JWT. See SECURITY.md.
--
-- Policy: "Users insert own profile"     → backend upserts after JWT verify
-- Policy: "Anyone can list models"       → backend validates creator role first
-- Policy: "Anyone can record purchases"  → backend calls record_purchase RPC after on-chain verify
-- Policy: "Buyers can submit reviews"    → backend validates purchase before insert
-- Policy: "Backend inserts transactions" → event listener writes after on-chain event
--
-- If you ever remove FastAPI as the gateway (e.g. direct Supabase client writes),
-- you MUST tighten these policies to use JWT claim checks. The current setup
-- is intentionally permissive at the DB layer because FastAPI is the gate.
