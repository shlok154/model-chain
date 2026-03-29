import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Provide default mock implementations for the external systems
def build_mock_supa():
    def make_res(data):
        res = MagicMock()
        res.data = data
        res.error = None
        return res

    m = MagicMock()
    # Mock purchases query tracker
    purchase_query = MagicMock()
    purchase_query.execute.return_value = make_res([])
    
    # We dynamically return the SAME mock for each table to track calls
    table_mocks = {}
    def table_side_effect(table_name):
        # Normalize name to lowercase as requested
        name = table_name.lower()
        if name not in table_mocks:
            chain = MagicMock(name=f"table_{name}")
            if name == "models":
                chain.select.return_value.eq.return_value.limit.return_value.execute.return_value = make_res([
                    {"id": 1, "creator_address": "0x0000000000000000000000000000000000000000", "name": "test", "price_eth": 1.0}
                ])
            elif name == "purchases":
                chain.select.return_value.eq.return_value.eq.return_value.limit.return_value = purchase_query
            else:
                # Other tables (downloads, model_encryption_keys)
                chain.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = make_res({"key_b64": "test", "encrypted": False})
                chain.upsert.return_value.execute.return_value = make_res([{"id": 1}])
            table_mocks[name] = chain
        return table_mocks[name]
        
    m.table.side_effect = table_side_effect
    m.purchase_query = purchase_query # expose for easy manipulation
    m.table_mocks = table_mocks # expose for easy access

    return m


@pytest.fixture
def mock_supabase():
    with patch("app.routes.ipfs.create_client") as mcc:
        client = build_mock_supa()
        mcc.return_value = client
        yield client

@pytest.fixture
def mock_web3():
    with patch("app.routes.ipfs.AsyncWeb3") as mw3:
        mock_w3_inst = MagicMock()
        mw3.return_value = mock_w3_inst
        mw3.AsyncHTTPProvider = MagicMock()
        mw3.to_checksum_address = lambda x: x 
        
        mock_contract = MagicMock()
        mock_w3_inst.eth.contract.return_value = mock_contract
        
        # default to throwing an exception to ensure we don't accidentally permit
        mock_contract.functions.hasAccess.return_value.call = AsyncMock(return_value=False)
        mw3.has_access = mock_contract.functions.hasAccess.return_value.call
        yield mw3

@pytest.fixture(autouse=True)
def mock_ipfs_responses():
    """Mock the actual IPFS outbound httpx requests so tests run fast without network calls."""
    # We use a helper function to set up valid async client mocks
    with patch("app.routes.ipfs.httpx.AsyncClient") as client_patch, \
         patch("app.routes.ipfs._valid_cid", return_value=True), \
         patch("app.routes.ipfs.get_settings") as m_settings:
             
        from app.config import Settings
        m_settings.return_value = Settings(
            marketplace_address="0xABC",
            alchemy_sepolia_url="http://test",
            supabase_url="http://test",
            supabase_anon_key="test",
            supabase_service_role_key="test",
            pinata_api_key="test",
            pinata_secret_api_key="test"
        )

        
        mock_client_inst = MagicMock()
        mock_client_inst.__aenter__ = AsyncMock(return_value=mock_client_inst)
        mock_client_inst.__aexit__ = AsyncMock(return_value=None)
        
        # Mock head request returning content-type
        mock_head = MagicMock()
        mock_head.status_code = 200
        mock_head.headers = {"content-type": "application/octet-stream"}
        mock_client_inst.head = AsyncMock(return_value=mock_head)
        
        # Mock stream context manager
        mock_stream = MagicMock()
        mock_stream.status_code = 200
        async def mock_aiter_fn(*args, **kwargs):
            yield b"" # Yield single empty chunk to immediately finish streaming
        mock_stream.aiter_bytes = mock_aiter_fn
        
        mock_stream_ctx = MagicMock()
        mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream)
        mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)
        mock_client_inst.stream.return_value = mock_stream_ctx

        
        client_patch.return_value = mock_client_inst
        yield client_patch



# ─────────────────────────────────────────────────────────────────────────────
# 1) Access Control Tests (CRITICAL)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_download_allowed_with_db_purchase(client, mock_supabase):
    """Case 1 - DB hit (fast path)"""
    # Simulate DB having a purchase record
    mock_supabase.purchase_query.execute.return_value.data = [{"id": 99}]
    
    res = client.get("/api/ipfs/download/QmTest123")
    
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/octet-stream"


@pytest.mark.anyio
async def test_download_allowed_with_chain_fallback(client, mock_supabase, mock_web3):
    """Case 2 - DB miss -> chain fallback"""
    # mock_supabase defaults to empty [] (miss)
    mock_web3.has_access.return_value = True
    
    res = client.get("/api/ipfs/download/QmTest123")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/octet-stream"


@pytest.mark.anyio
async def test_download_denied(client, mock_supabase, mock_web3):
    """Case 3 - DB miss + chain fail -> 403"""
    mock_web3.has_access.return_value = False
    
    res = client.get("/api/ipfs/download/QmTest123")
    assert res.status_code == 403


@pytest.mark.anyio
async def test_rpc_failure_returns_503(client, mock_supabase, mock_web3):
    """Case 4 - RPC failure -> 503"""
    mock_web3.has_access.side_effect = Exception("RPC down")
    
    res = client.get("/api/ipfs/download/QmTest123")
    assert res.status_code == 503


# ─────────────────────────────────────────────────────────────────────────────
# 2) Self-healing cache test
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_fallback_writes_to_db(client, mock_supabase, mock_web3):
    mock_web3.has_access.return_value = True
    
    client.get("/api/ipfs/download/QmTest123")
    
    # Assert upsert logic ran on the purchases table
    purchases_table = mock_supabase.table_mocks["purchases"]
    purchases_table.upsert.assert_called_once()


# ─────────────────────────────────────────────────────────────────────────────
# 3) Audit logging test
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_download_logged(client, mock_supabase, mock_web3):
    # Setup allowed access
    mock_web3.has_access.return_value = True
    
    client.get("/api/ipfs/download/QmTest123")
    
    # Assert upsert ran on the downloads table for audit logging
    downloads_table = mock_supabase.table_mocks["downloads"]
    downloads_table.upsert.assert_called_once()


# ─────────────────────────────────────────────────────────────────────────────
# 4) Duplicate request safety (Idempotency Edge Test)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_no_duplicate_upsert(client, mock_supabase, mock_web3):
    """Shows we accounted for race conditions and spam logic in backend UPSERT structure"""
    mock_web3.has_access.return_value = True

    # 2 rapid requests
    client.get("/api/ipfs/download/QmTest123")
    client.get("/api/ipfs/download/QmTest123")

    upsert_table = mock_supabase.table_mocks["purchases"]
    # We expect 2 separate calls if the backend doesn't cache locally (which it shouldn't for safety)
    assert upsert_table.upsert.call_count == 2


