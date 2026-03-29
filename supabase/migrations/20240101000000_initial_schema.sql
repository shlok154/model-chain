-- Migration 001 — Initial schema (v1)
-- Applied: first deploy

create table if not exists public.users (
  wallet_address  text primary key,
  display_name    text,
  bio             text,
  avatar_url      text,
  twitter         text,
  github          text,
  is_verified     boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists public.models (
  id               bigint generated always as identity primary key,
  name             text not null,
  description      text not null,
  price_eth        numeric(18, 8) not null,
  ipfs_hash        text not null,
  version          text not null default '1.0.0',
  license          text not null default 'MIT',
  category         text not null,
  royalty_percent  integer not null default 10 check (royalty_percent between 0 and 50),
  creator_address  text not null references public.users(wallet_address),
  purchases        integer not null default 0,
  tx_hash          text,
  created_at       timestamptz not null default now()
);

create index if not exists models_creator_idx  on public.models(creator_address);
create index if not exists models_category_idx on public.models(category);
create index if not exists models_price_idx    on public.models(price_eth);

create table if not exists public.purchases (
  id               bigint generated always as identity primary key,
  model_id         bigint not null references public.models(id) on delete cascade,
  buyer_address    text not null,
  price_paid_eth   numeric(18, 8) not null,
  on_chain_tx      text,
  purchased_at     timestamptz not null default now()
);

create index if not exists purchases_buyer_idx on public.purchases(buyer_address);
create index if not exists purchases_model_idx on public.purchases(model_id);
create unique index if not exists purchases_unique_idx
  on public.purchases(model_id, buyer_address);

create or replace function increment_purchases(model_id bigint)
returns void language sql as $$
  update public.models set purchases = purchases + 1 where id = model_id;
$$;

create or replace function record_purchase(
  p_model_id      bigint,
  p_buyer_address text,
  p_price_eth     numeric,
  p_tx_hash       text default null
)
returns void language plpgsql as $$
begin
  insert into public.purchases (model_id, buyer_address, price_paid_eth, on_chain_tx)
  values (p_model_id, lower(p_buyer_address), p_price_eth, p_tx_hash)
  on conflict (model_id, buyer_address) do nothing;

  update public.models
  set purchases = purchases + 1
  where id = p_model_id
    and not exists (
      select 1 from public.purchases
      where model_id = p_model_id and buyer_address = lower(p_buyer_address)
        and id < (select max(id) from public.purchases
                  where model_id = p_model_id and buyer_address = lower(p_buyer_address))
    );
end;
$$;

alter table public.users     enable row level security;
alter table public.models    enable row level security;
alter table public.purchases enable row level security;

create policy "Public read users"   on public.users for select using (true);
create policy "Users insert own profile" on public.users for insert with check (true);
create policy "Users update own profile" on public.users for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address')
  with check (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

create policy "Public read models"  on public.models for select using (true);
create policy "Anyone can list models" on public.models for insert with check (true);
create policy "Creator updates own model" on public.models for update
  using (creator_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

create policy "Buyers read own purchases" on public.purchases for select
  using (buyer_address = lower(current_setting('request.jwt.claims', true)::json->>'wallet_address'));
create policy "Creators read purchases of their models" on public.purchases for select
  using (model_id in (
    select id from public.models
    where creator_address = lower(current_setting('request.jwt.claims', true)::json->>'wallet_address')
  ));
create policy "Anyone can record purchases" on public.purchases for insert with check (true);
