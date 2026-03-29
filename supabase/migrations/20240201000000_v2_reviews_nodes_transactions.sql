-- Migration 002 — v2 additions: reviews, nodes, transactions
-- Applied: v2 upgrade

create table if not exists public.reviews (
  id           bigint generated always as identity primary key,
  model_id     bigint not null references public.models(id) on delete cascade,
  user_address text not null,
  rating       integer not null check (rating between 1 and 5),
  comment      text,
  created_at   timestamptz not null default now()
);

create unique index if not exists reviews_unique_idx on public.reviews(model_id, user_address);
create index if not exists reviews_model_idx on public.reviews(model_id);

alter table public.reviews enable row level security;
create policy "Anyone can read reviews"  on public.reviews for select using (true);
create policy "Buyers can submit reviews" on public.reviews for insert with check (true);
create policy "Reviewers update own review" on public.reviews for update
  using (user_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

create table if not exists public.nodes (
  id            bigint generated always as identity primary key,
  user_id       text not null references public.users(wallet_address),
  stake_amount  numeric(18,8) not null default 0,
  reputation    integer not null default 100,
  status        text not null default 'active' check (status in ('active','slashed','inactive')),
  registered_at timestamptz not null default now()
);

create index if not exists nodes_user_idx on public.nodes(user_id);
alter table public.nodes enable row level security;
create policy "Public read nodes" on public.nodes for select using (true);
create policy "Owner manages nodes" on public.nodes for all
  using (user_id = current_setting('request.jwt.claims', true)::json->>'wallet_address');

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
create policy "Users read own transactions" on public.transactions for select
  using (wallet = current_setting('request.jwt.claims', true)::json->>'wallet_address');
create policy "Backend inserts transactions" on public.transactions for insert with check (true);

-- Fix 5: Add FK from reviews.user_address → users.wallet_address
-- This makes the join reliable and enforces referential integrity.
-- Run this separately if you already have the reviews table deployed.
alter table public.reviews
  add constraint if not exists fk_reviews_user
  foreign key (user_address)
  references public.users(wallet_address)
  on delete cascade;
