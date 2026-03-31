import asyncio
import json
import logging
import os
import random
import signal
from uuid import uuid4
from datetime import datetime, timezone
from supabase import create_client, Client

from .config import get_settings
from .redis_client import get_redis
from .cache import cache_invalidate_prefix, cache_set
from .routes.analytics import compute_telemetry_summary, compute_creator_dashboard

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("worker")

_telemetry_semaphore = asyncio.Semaphore(50)

def _insert_event_sync(supa: Client, event_data: dict, ip: str):
    """Synchronous Supabase insertion to run in background thread"""
    payload = {
        "event": event_data["event"],
        "session_id": event_data["session_id"],
        "priority": event_data.get("priority", "normal"),
        "wallet_address": event_data.get("wallet"),
        "model_id": event_data.get("modelId"),
        "context": event_data.get("context", {}),
    }
    payload["context"] = payload.get("context") or {}
    payload["context"]["client_ip"] = ip
    supa.table("telemetry_logs").insert(payload).execute()

async def handle_telemetry(payload: dict, supa: Client):
    ip = payload.get("context", {}).get("client_ip", "unknown")
    if _telemetry_semaphore.locked() and payload.get("priority") != "critical":
        # Drop non-critical logs under load
        return

    async with _telemetry_semaphore:
        # 1.5s timeout: if Supabase RPC hangs, fail gracefully
        await asyncio.wait_for(asyncio.to_thread(_insert_event_sync, supa, payload, ip), timeout=1.5)

async def handle_analytics_rollup(job: dict) -> None:
    payload = job["payload"]
    wallet  = payload["wallet"]
    target  = payload["target"]

    settings = get_settings()
    supa = create_client(
        settings.supabase_url,
        settings.supabase_service_role_key
    )
    
    if target == "dashboard":
        result = await compute_creator_dashboard(wallet, supa)
        await cache_set(f"analytics:dashboard:{wallet}", result, ttl=300)
    elif target == "telemetry":
        result = await compute_telemetry_summary(wallet, supa)
        await cache_set(f"analytics:telemetry:{wallet}", result, ttl=60)
    else:
        raise ValueError(f"Unknown analytics_rollup target: {target}")

async def handle_cache_invalidation(job: dict):
    payload = job.get("payload", {})
    prefix = payload.get("prefix")
    if not prefix:
        raise ValueError("Cache invalidation job missing 'prefix' in payload")
    await cache_invalidate_prefix(prefix)

async def process_job(job: dict, supa: Client):
    job_type = job.get("type")
    
    if job_type == "telemetry":
        await handle_telemetry(job.get("payload", {}), supa)
    elif job_type == "analytics_rollup":
        await handle_analytics_rollup(job)
    elif job_type == "cache_invalidation":
        await handle_cache_invalidation(job)
    else:
        raise ValueError(f"Unknown job type: {job_type}")

async def main():
    settings = get_settings()
    supa = create_client(settings.supabase_url, settings.supabase_service_role_key)
    redis = await get_redis()
    
    # Read simulation variables
    simulate_queue = os.getenv("SIMULATE_FAILURE_QUEUE")
    simulate_rate = float(os.getenv("SIMULATE_FAILURE_RATE", "0.3"))
    simulate_mode = os.getenv("SIMULATE_FAILURE_MODE")
    
    queues = ["telemetry", "analytics_rollup", "cache_invalidation"]
    
    running = True

    def handle_sig(sig, frame):
        nonlocal running
        logger.info(f"Received signal {sig}, initiating graceful shutdown...")
        running = False

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)
    
    logger.info("Worker started. Listening on queues: %s", queues)

    try:
        while running:
            await redis.set("worker:health", datetime.utcnow().isoformat(), ex=10)
            
            shuffled_queues = queues.copy()
            random.shuffle(shuffled_queues)
            
            # Use BLPOP with fairness mechanism
            result = await redis.blpop(shuffled_queues, timeout=2.0)
            if not result:
                continue
                
            queue_name, item_str = result
            
            try:
                job = json.loads(item_str)
            except Exception as e:
                logger.error(f"Failed to parse job JSON: {e}")
                continue
            
            job_id = job.get("id", "unknown")
            job_type = job.get("type", "unknown")
            
            if "trace" not in job:
                job["trace"] = {}
            job["trace"]["started_at"] = datetime.utcnow().isoformat()
            
            # Idempotency guard - 24 hour TTL
            idem_key = f"idempotent:{job_type}:{job_id}"
            if await redis.get(idem_key):
                logger.info(f"[WORKER] job_id={job_id} type={job_type} status=skipped_idempotent")
                continue
            await redis.set(idem_key, 1, ex=86400)
            
            logger.info(f"[WORKER] job_id={job_id} type={job_type} status=started")
            
            try:
                # Simulated Failure
                if simulate_mode == "deterministic" and simulate_queue == job.get("queue"):
                    fail_key = f"fail_count:{job_id}"
                    count = await redis.incr(fail_key)
                    if count == 1:
                        await redis.expire(fail_key, 3600)
                    if count <= 2:
                        logger.warning(f"[WORKER] Simulated failure triggered for job {job_id}")
                        raise Exception("Simulated deterministic failure")
                        
                await process_job(job, supa)
                
                job["trace"]["completed_at"] = datetime.utcnow().isoformat()
                logger.info(f"[WORKER] job_id={job_id} type={job_type} status=success")
                await redis.incr("metrics:jobs_processed")
            except Exception as e:
                logger.error(f"[WORKER] job_id={job_id} type={job_type} status=failed error={e}")
                await redis.incr("metrics:jobs_failed")
                
                retries = job.get("retries", 0)
                if retries < 3:
                    await redis.incr("metrics:retry_count")
                    job["retries"] = retries + 1
                    queue_str = queue_name.decode() if isinstance(queue_name, bytes) else queue_name
                    await redis.lpush(job.get("queue", queue_str), json.dumps(job))
                else:
                    job["error"] = str(e)
                    job["failed_at"] = datetime.utcnow().isoformat()
                    job["trace"]["failed_at"] = datetime.utcnow().isoformat()
                    await redis.lpush("modelchain:event_listener:dead_letter", json.dumps(job))
                    logger.warning(f"[WORKER] job_id={job_id} type={job_type} status=dead_letter retries={retries}")

    except asyncio.CancelledError:
        logger.info("Worker cancelled.")
    finally:
        logger.info("Worker shut down cleanly.")

if __name__ == "__main__":
    asyncio.run(main())
