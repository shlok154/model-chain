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

# ── Simulate endpoint guard (models.py) ───────────────────────────────────────

@pytest.mark.anyio
async def test_simulate_purchase_blocked_by_default(client):
    """simulate-purchase must return 403 when ALLOW_SIMULATE is not set."""
    import os
    os.environ.pop("ALLOW_SIMULATE", None)  # ensure not set

    from app.main import app
    from app.routes.models import get_service_supabase
    
    app.dependency_overrides[get_service_supabase] = lambda: MagicMock()

    try:
        resp = client.post("/api/models/simulate-purchase", json={
            "model_id": 1,
            "price_eth": 0.1,
        })
    finally:
        app.dependency_overrides.pop(get_service_supabase, None)
    assert resp.status_code == 403
    assert "disabled" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_simulate_purchase_allowed_with_env_flag(client):
    """simulate-purchase must succeed when ALLOW_SIMULATE=true."""
    import os
    os.environ["ALLOW_SIMULATE"] = "true"
    from app.main import app
    from app.routes.models import get_service_supabase
    try:
        supa = MagicMock()
        rpc_mock = MagicMock()
        rpc_mock.execute.return_value = MagicMock(data=[{"id": 1}])
        supa.rpc.return_value = rpc_mock

        update_mock = MagicMock()
        update_mock.eq.return_value = update_mock
        update_mock.execute.return_value = MagicMock(data=[])
        supa.table.return_value.update.return_value = update_mock

        app.dependency_overrides[get_service_supabase] = lambda: supa

        resp = client.post("/api/models/simulate-purchase", json={
            "model_id": 1,
            "price_eth": 0.1,
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "simulated"
    finally:
        os.environ.pop("ALLOW_SIMULATE", None)
        app.dependency_overrides.pop(get_service_supabase, None)


# ── Public profile .maybe_single() fix (users.py) ────────────────────────────

@pytest.mark.anyio
async def test_get_public_profile_returns_200(client):
    """`GET /api/users/{wallet}` must not crash with AttributeError."""
    with patch("app.routes.users._supa") as mock_supa_fn:
        supa = MagicMock()
        res = MagicMock()
        res.data = {
            "wallet_address": "0xabc",
            "display_name": "Test User",
            "bio": None,
            "avatar_url": None,
            "twitter": None,
            "github": None,
            "is_verified": False,
            "created_at": "2024-01-01T00:00:00",
        }
        supa.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = res
        mock_supa_fn.return_value = supa

        resp = client.get("/api/users/0xabc123")
    assert resp.status_code == 200


# ── Profile auto-creation for new wallets (users.py) ─────────────────────────

@pytest.mark.anyio
async def test_get_own_profile_creates_on_first_visit(client):
    """GET /api/users/me must auto-create a blank profile for new wallets."""
    with patch("app.routes.users._supa") as mock_supa_fn:
        supa = MagicMock()

        # First query — no existing row
        select_res = MagicMock()
        select_res.data = None
        supa.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = select_res

        # Upsert — returns the newly created row
        upsert_res = MagicMock()
        upsert_res.data = [{"wallet_address": "0x1234567890123456789012345678901234567890"}]
        supa.table.return_value.upsert.return_value.select.return_value.execute.return_value = upsert_res

        mock_supa_fn.return_value = supa

        resp = client.get("/api/users/me")
    assert resp.status_code == 200
    assert "wallet_address" in resp.json()
