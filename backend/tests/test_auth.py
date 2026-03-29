"""
Backend tests — Auth endpoints
Run: cd backend && pytest tests/ -v
"""
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.fixture
def redis_override():
    from unittest.mock import AsyncMock, MagicMock
    pipeline_mock = MagicMock(name="pipeline")
    pipeline_mock.setex = MagicMock()
    pipeline_mock.execute = AsyncMock(return_value=[True, True])
    
    redis_mock = AsyncMock(name="redis_client")
    # CRITICAL: pipeline() is synchronous in redis-py, NOT a coroutine
    redis_mock.pipeline = MagicMock(return_value=pipeline_mock)
    return redis_mock, pipeline_mock

@pytest.fixture(autouse=True)
def inject_redis(redis_override):
    from app.main import app
    from app.redis_client import get_redis
    redis_mock, _ = redis_override
    app.dependency_overrides[get_redis] = lambda: redis_mock
    yield
    # Global conftest.py reset_overrides handles cleanup

# ── /auth/nonce ───────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_nonce_returns_message(client, redis_override):
    redis_mock, pipeline_mock = redis_override
    resp = client.get("/auth/nonce?wallet=0xd8da6bf26964af9d7eed9e03e53415d37aa96045")
    assert resp.status_code == 200
    data = resp.json()
    assert "nonce" in data
    assert "message" in data
    assert "ModelChain" in data["message"]
    pipeline_mock.setex.assert_called()

@pytest.mark.anyio
async def test_nonce_normalises_wallet_to_lowercase(client, redis_override):
    redis_mock, pipeline_mock = redis_override
    resp = client.get("/auth/nonce?wallet=0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045")
    assert resp.status_code == 200
    
    # Nonce key stored with lowercase wallet (on the PIPELINE mock)
    pipeline_mock.setex.assert_called()
    call_args = pipeline_mock.setex.call_args_list[0][0]
    assert "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" in call_args[0]

# ── /auth/verify ──────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_verify_expired_nonce_returns_400(client):
    from app.redis_client import get_redis
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)   # no nonce stored
    app.dependency_overrides[get_redis] = lambda: redis

    resp = client.post("/auth/verify", json={
        "wallet": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", # a valid address
        "signature": "0x" + "00"*65, # structurally valid (65 bytes)
    })

    assert resp.status_code == 401
    assert "Nonce" in resp.json()["detail"]

@pytest.mark.anyio
async def test_verify_wrong_signer_returns_401(client):
    """Signature from a different wallet should be rejected."""
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from app.redis_client import get_redis

    wallet = Account.create()
    other  = Account.create()    # signs as a different key
    nonce  = "testnonceabc123"
    message = f"Sign this message to verify wallet ownership.\nNonce: {nonce}"
    sig = other.sign_message(encode_defunct(text=message)).signature.hex()

    redis = AsyncMock()
    redis_store = {
        f"nonce_message:{wallet.address.lower()}": message.encode(),
        f"nonce:{wallet.address.lower()}": nonce.encode(),
    }
    redis.get = AsyncMock(side_effect=lambda k: redis_store.get(k))
    redis.delete = AsyncMock()
    app.dependency_overrides[get_redis] = lambda: redis

    resp = client.post("/auth/verify", json={
        "wallet": wallet.address.lower(),
        "signature": "0x" + sig,
    })
    assert resp.status_code == 401

@pytest.mark.anyio
async def test_verify_correct_signature_returns_token(client):
    """Success Path: Valid signature and nonce should return JWT."""
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from app.auth import _nonce_key, _message_key
    from app.redis_client import get_redis
    
    account = Account.create()
    wallet  = account.address.lower()
    nonce   = "validnonce99"
    
    # 1. Define single source of truth message_text (normalize only line endings)
    message_text = (
        f"Welcome to ModelChain!\n\n"
        f"Sign this message to verify wallet ownership.\n"
        f"This does NOT trigger a blockchain transaction.\n\n"
        f"Nonce: {nonce}\n"
        f"Timestamp: 1711711711"
    ).replace("\r\n", "\n")
    
    # 2. Sign exactly this message
    signable = encode_defunct(text=message_text)
    sig_hex = account.sign_message(signable).signature.hex()

    # 3. Create correctly configured Redis mock
    redis_store = {
        _nonce_key(wallet): nonce.encode(),
        _message_key(wallet): message_text.encode(),
    }
    
    redis_mock = AsyncMock()
    redis_mock.get = AsyncMock(side_effect=lambda key: redis_store.get(
        key.decode() if isinstance(key, (bytes, bytearray)) else str(key)
    ))
    redis_mock.delete = AsyncMock()

    # 4. Authority Injection via dependency_overrides (Use app directly)
    from app.main import app
    app.dependency_overrides[get_redis] = lambda: redis_mock

    with patch("app.auth.create_client") as mock_supabase:
        # 5. Table-Specific Mock Isolation
        def make_res(data):
            # Backend expects a result object with a .data attribute
            res = MagicMock()
            res.data = data
            res.error = None
            return res

        models_mock = MagicMock(name="models_table")
        models_mock.select.return_value = models_mock
        models_mock.eq.return_value = models_mock
        models_mock.limit.return_value = models_mock
        models_mock.execute.return_value = make_res([]) # Not a creator

        users_mock = MagicMock(name="users_table")
        users_mock.upsert.return_value = users_mock
        users_mock.execute.return_value = make_res([{"wallet_address": wallet, "role": "user"}])

        table_mocks = {
            "models": models_mock,
            "users": users_mock
        }

        def table_side_effect(name):
            if name not in table_mocks:
                raise ValueError(f"Unexpected table: {name}")
            return table_mocks[name]

        supa = MagicMock()
        supa.table.side_effect = table_side_effect
        mock_supabase.return_value = supa

        resp = client.post("/auth/verify", json={
            "wallet": wallet,
            "signature": "0x" + sig_hex,
        })
        
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["wallet"] == wallet
        assert data["role"] == "user"







# ── /auth/refresh ─────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_refresh_invalid_token_returns_401(client):
    resp = client.post("/auth/refresh", headers={"Authorization": "Bearer not.a.valid.jwt"})
    assert resp.status_code == 401
