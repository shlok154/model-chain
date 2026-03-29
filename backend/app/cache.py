"""
Phase 3 — Redis Cache helpers
Simple decorator + manual helpers for caching API responses.
"""
import json
import functools
from typing import Any, Callable
from .redis_client import get_redis

DEFAULT_TTL = 30   # seconds

async def cache_get(key: str) -> Any | None:
    try:
        redis = await get_redis()
        raw = await redis.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception:
        return None

async def cache_set(key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
    try:
        redis = await get_redis()
        await redis.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        pass

async def cache_delete(key: str) -> None:
    try:
        redis = await get_redis()
        await redis.delete(key)
    except Exception:
        pass

async def cache_invalidate_prefix(prefix: str) -> None:
    """Delete all keys matching a prefix pattern — use sparingly."""
    try:
        redis = await get_redis()
        async for key in redis.scan_iter(f"{prefix}*"):
            await redis.delete(key)
    except Exception:
        pass
