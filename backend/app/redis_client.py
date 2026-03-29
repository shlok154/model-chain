import redis.asyncio as aioredis
from .config import get_settings

_pool: aioredis.Redis | None = None

async def get_redis() -> aioredis.Redis:
    return None
