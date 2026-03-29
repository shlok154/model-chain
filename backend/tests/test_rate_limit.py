"""Tests for rate limiting middleware."""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch
from app.main import app

@pytest.mark.anyio
async def test_rate_limit_exceeded_returns_429(client):
    """Exceeding the nonce rate limit should return 429."""
    redis_mock = AsyncMock()
    # Simulate a high count to trigger rate limit (count > 10 for /auth/nonce)
    redis_mock.incr = AsyncMock(return_value=11)
    redis_mock.expire = AsyncMock()
    redis_mock.ttl = AsyncMock(return_value=45)
    
    # Middleware does not use Depends(), so we MUST patch the module-level import
    with patch("app.middleware.get_redis", new=AsyncMock(return_value=redis_mock)):
        resp = client.get("/auth/nonce?wallet=0xd8da6bf26964af9d7eed9e03e53415d37aa96045")
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers


