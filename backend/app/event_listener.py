"""
Blockchain Event Listener
--------------------------
Listens to all relevant contract events and syncs them into Supabase.

Events handled:
  - ModelPurchased   → record purchase + grant access
  - ModelListed      → confirm tx hash + promote creator role
  - EarningsWithdrawn → log to transactions table
  - EscrowReleased   → log transaction, update node/creator record
  - NodeStaked       → upsert node stake record
  - NodeSlashed      → mark node slashed in DB

Checkpoint stored in Redis (key: modelchain:event_listener:checkpoint)
so it survives container restarts and works across scaled deployments.
Exponential backoff up to 5 minutes on repeated RPC errors.

Dead-letter queue: failed events are written to Redis list
  modelchain:event_listener:dead_letter
so they can be inspected and replayed without re-scanning the chain.

Health state written to Redis (key: modelchain:event_listener:health)
so the /health endpoint can report listener status.

Run standalone:
  python -m app.event_listener

Or via docker-compose (the event-listener service).
"""

import asyncio
import json
import logging
import time
import uuid as _uuid
from datetime import datetime
import redis.asyncio as aioredis
from web3 import AsyncWeb3
from web3.middleware import ExtraDataToPOAMiddleware
from supabase import create_client
from .config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

EVENTS_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "modelId",  "type": "uint256"},
            {"indexed": True,  "name": "buyer",    "type": "address"},
            {"indexed": False, "name": "price",    "type": "uint256"},
            {"indexed": False, "name": "escrowId", "type": "uint256"},
        ],
        "name": "ModelPurchased",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "modelId",  "type": "uint256"},
            {"indexed": True,  "name": "creator",  "type": "address"},
            {"indexed": False, "name": "price",    "type": "uint256"},
            {"indexed": False, "name": "ipfsHash", "type": "string"},
        ],
        "name": "ModelListed",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "creator", "type": "address"},
            {"indexed": False, "name": "amount",  "type": "uint256"},
        ],
        "name": "EarningsWithdrawn",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "escrowId", "type": "uint256"},
            {"indexed": True,  "name": "creator",  "type": "address"},
            {"indexed": False, "name": "amount",   "type": "uint256"},
        ],
        "name": "EscrowReleased",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "node",   "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
        ],
        "name": "NodeStaked",
        "type": "event",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "name": "node",   "type": "address"},
            {"indexed": False, "name": "amount", "type": "uint256"},
            {"indexed": False, "name": "reason", "type": "string"},
        ],
        "name": "NodeSlashed",
        "type": "event",
    },
]

# Redis keys
CHECKPOINT_KEY  = "modelchain:event_listener:checkpoint"
DEAD_LETTER_KEY = "modelchain:event_listener:dead_letter"
HEALTH_KEY      = "modelchain:event_listener:health"

# Distributed lock — prevents two listener instances from running simultaneously.
# Only one process holds this key at a time. TTL is refreshed every cycle.
# If the holder crashes, the lock expires and another instance can take over.
LOCK_KEY     = "modelchain:event_listener:lock"
LOCK_TTL_SEC = 60    # seconds — must be > POLL_INTERVAL
LOCK_REFRESH = 10    # refresh lock every N seconds while running

# Max dead-letter entries to keep (ring buffer)
DEAD_LETTER_MAX = 500


async def _load_checkpoint(redis: aioredis.Redis) -> int:
    """Load last-processed block number from Redis."""
    val = await redis.get(CHECKPOINT_KEY)
    if val is None:
        return 0
    try:
        return int(val)
    except (ValueError, TypeError):
        return 0


async def _save_checkpoint(redis: aioredis.Redis, block: int) -> None:
    """Persist last-processed block to Redis. No TTL — must survive indefinitely."""
    await redis.set(CHECKPOINT_KEY, str(block))


async def _write_health(redis: aioredis.Redis, status: str, block: int, error: str = "") -> None:
    """Write listener health state to Redis (TTL 60s — stale if listener dies)."""
    payload = json.dumps({
        "status":       status,   # "ok" | "error" | "starting"
        "block":        block,
        "error":        error,
        "updated_at":   int(time.time()),
    })
    await redis.setex(HEALTH_KEY, 60, payload)


async def _dead_letter(redis: aioredis.Redis, event_name: str, event: dict, error: str) -> None:
    """
    Push a failed event onto the dead-letter list so it can be inspected/replayed.
    We cap the list at DEAD_LETTER_MAX to avoid unbounded growth.
    """
    entry = json.dumps({
        "event":    event_name,
        "tx_hash":  event.get("transactionHash", b"").hex() if isinstance(event.get("transactionHash"), bytes) else str(event.get("transactionHash", "")),
        "block":    event.get("blockNumber", 0),
        "args":     {k: (v.lower() if isinstance(v, str) else str(v)) for k, v in event.get("args", {}).items()},
        "error":    error,
        "ts":       int(time.time()),
    }, default=str)
    await redis.lpush(DEAD_LETTER_KEY, entry)
    # Trim to max size (keep the most recent DEAD_LETTER_MAX entries)
    await redis.ltrim(DEAD_LETTER_KEY, 0, DEAD_LETTER_MAX - 1)
    log.warning(f"Dead-lettered {event_name} event: {error}")


# ── Distributed lock ──────────────────────────────────────────────────────────


_INSTANCE_ID = _uuid.uuid4().hex   # unique ID per process


async def _acquire_lock(redis: aioredis.Redis) -> bool:
    """
    Try to acquire the singleton listener lock using SET NX PX (atomic).
    Returns True if this process now holds the lock, False otherwise.

    Uses a unique instance ID as the value so we can safely release only
    our own lock and not accidentally release one held by another instance.
    """
    result = await redis.set(
        LOCK_KEY,
        _INSTANCE_ID,
        nx=True,       # only set if key does not exist
        ex=LOCK_TTL_SEC,
    )
    return result is not None


async def _refresh_lock(redis: aioredis.Redis) -> bool:
    """
    Extend TTL on the lock if we still own it.
    Returns False if we've lost the lock (another instance took over).
    Uses a Lua script for atomic check-and-extend.
    """
    lua = """
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], ARGV[2])
    else
        return 0
    end
    """
    result = await redis.eval(lua, 1, LOCK_KEY, _INSTANCE_ID, str(LOCK_TTL_SEC))
    return bool(result)


async def _release_lock(redis: aioredis.Redis) -> None:
    """Release the lock only if we still own it (Lua atomic compare-and-delete)."""
    lua = """
    if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
    else
        return 0
    end
    """
    await redis.eval(lua, 1, LOCK_KEY, _INSTANCE_ID)


# ── Event handlers ────────────────────────────────────────────────────────────

async def handle_model_purchased(event: dict, supabase, redis: aioredis.Redis) -> None:
    model_id  = event["args"]["modelId"]
    buyer     = event["args"]["buyer"].lower()
    price_wei = event["args"]["price"]
    tx_hash   = event["transactionHash"].hex()
    price_eth = price_wei / 1e18

    log.info(f"ModelPurchased: model={model_id} buyer={buyer} price={price_eth:.6f} ETH tx={tx_hash}")

    try:
        # Idempotent upsert — safe if listener replays blocks
        supabase.rpc("record_purchase", {
            "p_model_id":      model_id,
            "p_buyer_address": buyer,
            "p_price_eth":     price_eth,
            "p_tx_hash":       tx_hash,
        }).execute()
        
        # Enqueue analytics rollup
        try:
            model_res = supabase.table("models").select("creator_address").eq("id", model_id).maybeSingle().execute()
            if model_res and model_res.data:
                creator_wallet = model_res.data["creator_address"]
                key = f"analytics:refresh_lock:{creator_wallet}:dashboard"
                acquired = await redis.set(key, "1", ex=30, nx=True)
                if acquired:
                    job_id = str(_uuid.uuid4())
                    job = {
                        "id": job_id,
                        "original_id": job_id,
                        "type": "analytics_rollup",
                        "queue": "analytics_rollup",
                        "payload": {
                            "wallet": creator_wallet,
                            "target": "dashboard"
                        },
                        "retries": 0,
                        "created_at": datetime.utcnow().isoformat(),
                        "source": "event_listener",
                        "trace": {"created_at": datetime.utcnow().isoformat()}
                    }
                    await redis.lpush("analytics_rollup", json.dumps(job))
        except Exception as rollup_err:
            log.warning(f"Failed to enqueue dashboard rollup for model {model_id} purchase: {rollup_err}")
            
    except Exception as e:
        await _dead_letter(redis, "ModelPurchased", event, str(e))
        raise


async def handle_model_listed(event: dict, supabase, redis: aioredis.Redis) -> None:
    model_id  = event["args"]["modelId"]
    creator   = event["args"]["creator"].lower()
    tx_hash   = event["transactionHash"].hex()
    price     = event["args"]["price"] / 1e18
    ipfs_hash = event["args"].get("ipfsHash", "")

    log.info(f"ModelListed: model={model_id} creator={creator} tx={tx_hash}")

    try:
        supabase.table("models").upsert({
            "id": model_id,
            "creator_address": creator,
            "tx_hash": tx_hash,
            "price_eth": price,
            "ipfs_hash": ipfs_hash,
            "name": ipfs_hash[:20] if ipfs_hash else f"Model #{model_id}",
            "description": f"On-chain model listed by {creator[:10]}...",
            "version": "1.0.0",
            "license": "MIT",
            "category": "NLP",
            "royalty_percent": 10,
        }, on_conflict="id").execute()

        supabase.table("users").upsert(
            {"wallet_address": creator, "role": "creator"},
            on_conflict="wallet_address",
        ).execute()
    except Exception as e:
        await _dead_letter(redis, "ModelListed", event, str(e))
        raise


async def handle_earnings_withdrawn(event: dict, supabase, redis: aioredis.Redis) -> None:
    creator = event["args"]["creator"].lower()
    amount  = event["args"]["amount"] / 1e18
    tx_hash = event["transactionHash"].hex()
    log.info(f"EarningsWithdrawn: creator={creator} amount={amount:.6f} ETH tx={tx_hash}")

    try:
        supabase.table("transactions").upsert({
            "tx_hash":    tx_hash,
            "type":       "withdraw",
            "wallet":     creator,
            "amount_eth": amount,
            "status":     "confirmed",
        }, on_conflict="tx_hash").execute()
    except Exception as e:
        await _dead_letter(redis, "EarningsWithdrawn", event, str(e))
        raise


async def handle_escrow_released(event: dict, supabase, redis: aioredis.Redis) -> None:
    """EscrowReleased — funds moved from escrow to creator earnings."""
    escrow_id = event["args"]["escrowId"]
    creator   = event["args"]["creator"].lower()
    amount    = event["args"]["amount"] / 1e18
    tx_hash   = event["transactionHash"].hex()

    log.info(f"EscrowReleased: escrowId={escrow_id} creator={creator} amount={amount:.6f} ETH tx={tx_hash}")

    try:
        supabase.table("transactions").upsert({
            "tx_hash":    tx_hash,
            "type":       "withdraw",
            "wallet":     creator,
            "amount_eth": amount,
            "status":     "confirmed",
        }, on_conflict="tx_hash").execute()
    except Exception as e:
        await _dead_letter(redis, "EscrowReleased", event, str(e))
        raise


async def handle_node_staked(event: dict, supabase, redis: aioredis.Redis) -> None:
    """NodeStaked — upsert the node's stake amount in Supabase."""
    node    = event["args"]["node"].lower()
    amount  = event["args"]["amount"] / 1e18
    tx_hash = event["transactionHash"].hex()

    log.info(f"NodeStaked: node={node} amount={amount:.6f} ETH tx={tx_hash}")

    try:
        supabase.table("users").upsert(
            {"wallet_address": node},
            on_conflict="wallet_address",
        ).execute()

        existing = supabase.table("nodes").select("id, stake_amount").eq("user_id", node).maybeSingle().execute()
        if existing.data:
            new_stake = float(existing.data["stake_amount"]) + amount
            supabase.table("nodes").update({
                "stake_amount": new_stake,
                "status":       "active",
            }).eq("id", existing.data["id"]).execute()
        else:
            supabase.table("nodes").insert({
                "user_id":      node,
                "stake_amount": amount,
                "status":       "active",
            }).execute()

        supabase.table("transactions").upsert({
            "tx_hash":    tx_hash,
            "type":       "stake",
            "wallet":     node,
            "amount_eth": amount,
            "status":     "confirmed",
        }, on_conflict="tx_hash").execute()
    except Exception as e:
        await _dead_letter(redis, "NodeStaked", event, str(e))
        raise


async def handle_node_slashed(event: dict, supabase, redis: aioredis.Redis) -> None:
    """NodeSlashed — mark node as slashed and zero out stake."""
    node    = event["args"]["node"].lower()
    amount  = event["args"]["amount"] / 1e18
    reason  = event["args"]["reason"]
    tx_hash = event["transactionHash"].hex()

    log.info(f"NodeSlashed: node={node} amount={amount:.6f} ETH reason='{reason}' tx={tx_hash}")

    try:
        supabase.table("nodes").update({
            "stake_amount": 0,
            "status":       "slashed",
            "reputation":   0,
        }).eq("user_id", node).execute()

        supabase.table("transactions").upsert({
            "tx_hash":    tx_hash,
            "type":       "stake",
            "wallet":     node,
            "amount_eth": -amount,
            "status":     "confirmed",
        }, on_conflict="tx_hash").execute()
    except Exception as e:
        await _dead_letter(redis, "NodeSlashed", event, str(e))
        raise


# ── Main loop ─────────────────────────────────────────────────────────────────

async def run_listener():
    settings = get_settings()
    redis    = aioredis.from_url(settings.redis_url, decode_responses=False)
    supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(settings.alchemy_sepolia_url))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

    contract = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(settings.marketplace_address),
        abi=EVENTS_ABI,
    )

    # ── Distributed lock: only ONE instance may run at a time ────────────────
    # If another instance is already running, wait until it releases or its
    # lock expires (LOCK_TTL_SEC), then try again.
    log.info(f"Instance {_INSTANCE_ID} attempting to acquire listener lock…")
    while not await _acquire_lock(redis):
        log.info("Another listener instance holds the lock. Waiting 15s before retrying…")
        await asyncio.sleep(15)
    log.info(f"Instance {_INSTANCE_ID} acquired listener lock.")

    # Checkpoint from Redis — survives container restarts
    stored       = await _load_checkpoint(redis)
    latest_block = await w3.eth.block_number
    from_block   = stored if stored > 0 else max(0, latest_block - 50)
    log.info(f"Event listener starting from block {from_block} (latest={latest_block})")
    await _write_health(redis, "starting", from_block)

    POLL_INTERVAL  = 12    # ~1 Ethereum block
    CHUNK_SIZE     = 10    # reduced for Alchemy free tier
    consecutive_errors = 0
    last_lock_refresh  = time.time()

    try:
        while True:
            # ── Refresh distributed lock periodically ─────────────────────────
            if time.time() - last_lock_refresh >= LOCK_REFRESH:
                if not await _refresh_lock(redis):
                    log.error("Lost distributed lock — another instance took over. Shutting down.")
                    break
                last_lock_refresh = time.time()

            try:
                latest = await w3.eth.block_number
                if from_block > latest:
                    await _write_health(redis, "ok", from_block)
                    await asyncio.sleep(POLL_INTERVAL)
                    continue

                to_block = min(from_block + CHUNK_SIZE, latest)

                purchased_events  = await contract.events.ModelPurchased.get_logs(from_block=from_block, to_block=to_block)
                listed_events     = await contract.events.ModelListed.get_logs(from_block=from_block, to_block=to_block)
                withdrawn_events  = await contract.events.EarningsWithdrawn.get_logs(from_block=from_block, to_block=to_block)
                released_events   = await contract.events.EscrowReleased.get_logs(from_block=from_block, to_block=to_block)
                staked_events     = await contract.events.NodeStaked.get_logs(from_block=from_block, to_block=to_block)
                slashed_events    = await contract.events.NodeSlashed.get_logs(from_block=from_block, to_block=to_block)

                for evt in listed_events:
                    await handle_model_listed(evt, supabase, redis)
                for evt in purchased_events:
                    await handle_model_purchased(evt, supabase, redis)
                for evt in withdrawn_events:
                    await handle_earnings_withdrawn(evt, supabase, redis)
                for evt in released_events:
                    await handle_escrow_released(evt, supabase, redis)
                for evt in staked_events:
                    await handle_node_staked(evt, supabase, redis)
                for evt in slashed_events:
                    await handle_node_slashed(evt, supabase, redis)

                await _save_checkpoint(redis, to_block + 1)
                await _write_health(redis, "ok", to_block + 1)
                from_block = to_block + 1
                consecutive_errors = 0

                if to_block < latest:
                    continue  # still catching up — no sleep

            except Exception as e:
                consecutive_errors += 1
                log.error(f"Listener error (#{consecutive_errors}): {e}", exc_info=True)
                await _write_health(redis, "error", from_block, str(e))
                backoff = min(POLL_INTERVAL * (2 ** min(consecutive_errors - 1, 5)), 300)
                log.info(f"Retrying in {backoff}s")
                await asyncio.sleep(backoff)
                continue

            await asyncio.sleep(POLL_INTERVAL)
    finally:
        # Always release the lock on clean shutdown or unhandled exception
        await _release_lock(redis)
        log.info(f"Instance {_INSTANCE_ID} released listener lock.")


if __name__ == "__main__":
    asyncio.run(run_listener())
