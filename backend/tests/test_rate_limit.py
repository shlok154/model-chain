"""Tests for rate limiting middleware."""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch
from app.main import app

@pytest.mark.anyio
async def test_rate_limit_exceeded_returns_429():
    """Exceeding the nonce rate limit should return 429."""
    call_count = 0

    async def fake_get_redis():
        redis = AsyncMock()
        nonlocal call_count

        async def incr(key):
            call_count += 1
            return 999   # simulate many requests

        redis.incr = incr
        redis.expire = AsyncMock()
        redis.ttl = AsyncMock(return_value=45)
        return redis

    with patch("app.middleware.get_redis", fake_get_redis):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/auth/nonce?wallet=0xabc")
            assert resp.status_code == 429
            assert "Retry-After" in resp.headers
