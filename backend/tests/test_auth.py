"""
Backend tests — Auth endpoints
Run: cd backend && pytest tests/ -v
"""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch
from app.main import app

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c

# ── /auth/nonce ───────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_nonce_returns_message(client):
    with patch("app.auth.get_redis") as mock_redis:
        redis = AsyncMock()
        redis.setex = AsyncMock(return_value=True)
        mock_redis.return_value = redis

        resp = await client.get("/auth/nonce?wallet=0xd8da6bf26964af9d7eed9e03e53415d37aa96045")
        assert resp.status_code == 200
        data = resp.json()
        assert "nonce" in data
        assert "message" in data
        assert "ModelChain" in data["message"]
        assert data["nonce"] in data["message"]

@pytest.mark.anyio
async def test_nonce_normalises_wallet_to_lowercase(client):
    with patch("app.auth.get_redis") as mock_redis:
        redis = AsyncMock()
        redis.setex = AsyncMock()
        mock_redis.return_value = redis

        resp = await client.get("/auth/nonce?wallet=0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045")
        assert resp.status_code == 200
        # Nonce key stored with lowercase wallet (verified by setex call)
        call_args = redis.setex.call_args[0]
        assert "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" in call_args[0]

# ── /auth/verify ──────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_verify_expired_nonce_returns_400(client):
    with patch("app.auth.get_redis") as mock_redis:
        redis = AsyncMock()
        redis.get = AsyncMock(return_value=None)   # no nonce stored
        mock_redis.return_value = redis

        resp = await client.post("/auth/verify", json={
            "wallet": "0xabc",
            "signature": "0xdeadbeef",
        })
        assert resp.status_code == 400
        assert "Nonce" in resp.json()["detail"]

@pytest.mark.anyio
async def test_verify_wrong_signer_returns_401(client):
    """Signature from a different wallet should be rejected."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    wallet = Account.create()
    other  = Account.create()    # signs as a different key
    nonce  = "testnonceabc123"
    message = (
        f"Welcome to ModelChain!\n\n"
        f"Sign this message to verify wallet ownership.\n"
        f"This does NOT trigger a blockchain transaction.\n\n"
        f"Nonce: {nonce}\n"
        f"Timestamp: 1716382023"
    )
    sig = other.sign_message(encode_defunct(text=message)).signature.hex()

    with patch("app.auth.get_redis") as mock_redis:
        async def mock_redis_get(key):
            if "message" in str(key):
                return message.encode()
            return nonce.encode()

        redis = AsyncMock()
        redis.get = AsyncMock(side_effect=mock_redis_get)
        redis.delete = AsyncMock()
        mock_redis.return_value = redis

        resp = await client.post("/auth/verify", json={
            "wallet": wallet.address.lower(),
            "signature": "0x" + sig,
        })
        assert resp.status_code == 401

@pytest.mark.anyio
async def test_verify_correct_signature_returns_token(client):
    """Valid signature from correct wallet should return a JWT."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    account = Account.create()
    nonce   = "validnonce99"
    message = (
        f"Welcome to ModelChain!\n\n"
        f"Sign this message to verify wallet ownership.\n"
        f"This does NOT trigger a blockchain transaction.\n\n"
        f"Nonce: {nonce}\n"
        f"Timestamp: 1716382023"
    )
    sig = account.sign_message(encode_defunct(text=message)).signature.hex()

    with patch("app.auth.get_redis") as mock_redis:
        async def mock_redis_get(key):
            if "message" in str(key):
                return message.encode()
            return nonce.encode()

        redis = AsyncMock()
        redis.get = AsyncMock(side_effect=mock_redis_get)
        redis.delete = AsyncMock()
        mock_redis.return_value = redis

        resp = await client.post("/auth/verify", json={
            "wallet": account.address.lower(),
            "signature": "0x" + sig,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["wallet"] == account.address.lower()
        assert data["role"] == "user"

# ── /auth/refresh ─────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_refresh_invalid_token_returns_401(client):
    resp = await client.post("/auth/refresh", headers={"Authorization": "Bearer not.a.valid.jwt"})
    assert resp.status_code == 401
