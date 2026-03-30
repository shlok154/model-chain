import redis.asyncio as redis
from .config import get_settings

_client: redis.Redis | None = None

def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        settings = get_settings()
        _client = redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
        )
    return _client

async def get_redis() -> redis.Redis:
    return _get_client()
