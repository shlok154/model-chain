-- ============================================================
-- Migration: fix record_purchase race condition + add node event support
-- ============================================================

-- ── Fix record_purchase counter race ─────────────────────────────────────────
--
-- The previous implementation used a NOT EXISTS subquery to decide whether to
-- increment the purchases counter. Under concurrent load two simultaneous
-- first-purchases for the same buyer+model could both evaluate NOT EXISTS as
-- true before either INSERT committed, causing a double-increment.
--
-- The fix uses GET DIAGNOSTICS ROW_COUNT after the INSERT … ON CONFLICT DO
-- NOTHING. ROW_COUNT is 1 only when THIS statement actually inserted a row
-- (i.e. no conflict fired). This is fully atomic within the transaction and
-- immune to the race.

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

-- ── Allow negative amount_eth in transactions (for slash events) ──────────────
-- NodeSlashed records the slashed amount as a negative value to distinguish
-- stake losses from stake additions in the transactions ledger.
alter table public.transactions
  drop constraint if exists transactions_amount_eth_check;

-- ── Add reputation floor comment ──────────────────────────────────────────────
comment on column public.nodes.reputation is
  'Node reputation score 0–100. Set to 0 on slash. Starts at 100 on registration.';
