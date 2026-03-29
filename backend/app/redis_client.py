import redis.asyncio as aioredis

_pool: aioredis.Redis | None = None

async def get_redis() -> aioredis.Redis:
    return None
