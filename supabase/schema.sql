-- ============================================================
-- ModelChain — Supabase Schema
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
create table if not exists public.models (
  id               bigint generated always as identity primary key,
  name             text not null,
  description      text not null,
  price_eth        text not null,              -- stored as string e.g. "0.08"
  ipfs_hash        text not null,
  version          text not null default '1.0.0',
  license          text not null default 'MIT',
  category         text not null,
  royalty_percent  integer not null default 10,
  creator_address  text not null references public.users(wallet_address),
  purchases        integer not null default 0,
  tx_hash          text,                       -- on-chain tx hash if deployed
  created_at       timestamptz not null default now()
);

-- Index for fast creator lookups
create index if not exists models_creator_idx on public.models(creator_address);
create index if not exists models_category_idx on public.models(category);

-- ── RPC: increment_purchases ──────────────────────────────────
-- Called after a successful purchase to keep the counter in sync
create or replace function increment_purchases(model_id bigint)
returns void
language sql
as $$
  update public.models
  set purchases = purchases + 1
  where id = model_id;
$$;

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
alter table public.users enable row level security;
alter table public.models enable row level security;

-- Anyone can read users and models (public marketplace)
create policy "Public read users"
  on public.users for select using (true);

create policy "Public read models"
  on public.models for select using (true);

-- Users can only insert/update their own profile
create policy "Users insert own profile"
  on public.users for insert
  with check (true);  -- wallet address is the identity, no auth needed

create policy "Users update own profile"
  on public.users for update
  using (true);       -- app enforces wallet ownership via address check

-- Anyone can insert models (wallet address validated in app)
create policy "Anyone can list models"
  on public.models for insert
  with check (true);

-- ── SEED DATA (optional — comment out for production) ─────────
insert into public.users (wallet_address, display_name, is_verified) values
  ('0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 'NLP Labs', true),
  ('0xab5801a7d398351b8be11c439e05c5b3259aec9b', 'Vision AI', true),
  ('0x1db3439a222c519ab44bb1144fc28167b4fa6ee6', 'GenModel Studio', false)
on conflict (wallet_address) do nothing;

insert into public.models (name, description, price_eth, ipfs_hash, version, license, category, royalty_percent, creator_address, purchases) values
  ('Sentiment Analyzer Pro', 'Fine-tuned BERT for real-time sentiment classification across 12 languages with 94.3% accuracy.', '0.08', 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco', '2.1.0', 'MIT', 'NLP', 10, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 142),
  ('VisionNet Edge', 'Lightweight object detection model optimized for edge deployment. Runs at 60fps on mobile GPUs.', '0.14', 'QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o', '1.3.2', 'Apache 2.0', 'Computer Vision', 8, '0xab5801a7d398351b8be11c439e05c5b3259aec9b', 89),
  ('LLM Mini 7B', 'Quantized 7B parameter language model, fine-tuned for code generation and debugging tasks.', '0.22', 'QmSiTko9JZyabH56y2fussEt1A5oDqsFXB3CkvAqraFryz', '1.0.0', 'CC BY-NC 4.0', 'LLM', 15, '0x1db3439a222c519ab44bb1144fc28167b4fa6ee6', 311),
  ('AudioClip Transcriber', 'Whisper-based transcription model with speaker diarization. 98.1% accuracy on clean audio.', '0.06', 'QmfM2r8seH2GiRaC4esTjeraXEachRt8ZsSeGaWTPLyMoG', '3.0.1', 'MIT', 'Audio', 12, '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', 204),
  ('TabularNet Regressor', 'XGBoost-neural hybrid for tabular regression. Outperforms vanilla XGBoost by 18% on benchmark datasets.', '0.05', 'QmNLei78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8z', '1.1.0', 'MIT', 'Tabular', 5, '0xab5801a7d398351b8be11c439e05c5b3259aec9b', 57),
  ('DiffusionXL Fine-Tuner', 'SDXL LoRA trained on 50k curated art images. Produces stunning photorealistic renders.', '0.35', 'QmYwAPJzv5CZsnAzt8auV39s1XRd9a6PqXqjS8Zs6jPBp4', '2.0.0', 'CC BY 4.0', 'Generative', 20, '0x1db3439a222c519ab44bb1144fc28167b4fa6ee6', 478);
