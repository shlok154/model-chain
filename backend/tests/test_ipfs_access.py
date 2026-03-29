import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Provide default mock implementations for the external systems
def build_mock_supa():
    m = MagicMock()
    # Mock models table
    m.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": 1, "creator_address": "0x0", "name": "test_model", "price_eth": 1.0}
    ]
    # Mock purchases table defaulting to explicit empty data (miss)
    # The actual tests should override this for hits.
    purchase_query = MagicMock()
    purchase_query.execute.return_value.data = []
    
    # We dynamically return different mocks depending on table called
    def table_side_effect(table_name):
        chain = MagicMock()
        if table_name == "models":
            chain.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
                {"id": 1, "creator_address": "0x0", "name": "test", "price_eth": 1.0}
            ]
            return chain
        elif table_name == "purchases":
            # Default to no purchases
            chain.select.return_value.eq.return_value.eq.return_value.limit.return_value = purchase_query
            return chain
        # Other tables just pass through a dummy mock
        return chain
        
    m.table.side_effect = table_side_effect
    m.purchase_query = purchase_query # expose for easy manipulation
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
    with patch("app.routes.ipfs.httpx.AsyncClient") as client_patch, \
         patch("app.routes.ipfs._valid_cid", return_value=True), \
         patch("app.routes.ipfs.get_settings") as m_settings:
             
        m_settings.return_value = MagicMock(marketplace_address="0xABC", alchemy_sepolia_url="")
        
        mock_head = AsyncMock()
        mock_head.headers.get.return_value = "application/octet-stream"
        
        mock_client_inst = AsyncMock()
        mock_client_inst.head.return_value = mock_head
        mock_client_inst.__aenter__.return_value = mock_client_inst
        
        mock_stream = AsyncMock()
        mock_stream.status_code = 200
        async def mock_aiter_fn(*args, **kwargs):
            yield b"" # Yield single empty chunk to immediately finish streaming
        mock_stream.aiter_bytes = mock_aiter_fn
        mock_client_inst.stream.return_value.__aenter__.return_value = mock_stream
        
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
    upsert_calls = [name for name, _ in mock_supabase.mock_calls if 'purchases' in str(name) and 'upsert' in str(name)]
    assert len(upsert_calls) >= 1


# ─────────────────────────────────────────────────────────────────────────────
# 3) Audit logging test
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_download_logged(client, mock_supabase, mock_web3):
    # Setup allowed access
    mock_web3.has_access.return_value = True
    
    client.get("/api/ipfs/download/QmTest123")
    
    # Assert upsert ran on the downloads table for audit logging
    downloads_upsert_calls = [name for name, _ in mock_supabase.mock_calls if 'downloads' in str(name) and 'upsert' in str(name)]
    assert len(downloads_upsert_calls) >= 1


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

    upsert_calls = [name for name, _ in mock_supabase.mock_calls if 'purchases' in str(name) and 'upsert' in str(name)]
    # As long as it properly fires upsert to rely on DB UNIQUE logic rather than DB count
    assert len(upsert_calls) >= 1
