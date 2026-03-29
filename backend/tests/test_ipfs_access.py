import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi import HTTPException
from app.main import app

def auth_override():
    return "0x1234567890123456789012345678901234567890"

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.fixture
async def client():
    app.dependency_overrides.clear()
    from app.deps import get_current_wallet
    app.dependency_overrides[get_current_wallet] = auth_override
    
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
        
    app.dependency_overrides.clear()

@pytest.fixture
def mock_supabase():
    with patch("app.routes.ipfs.create_client") as mcc:
        mock_client = MagicMock()
        mcc.return_value = mock_client
        
        # We need mock_client.table().select().eq().limit().execute() to work for models
        # and for purchases.
        
        # Setup model mock
        model_data = {"data": [{"id": 1, "creator_address": "0x0", "name": "test", "price_eth": 1.0}]}
        
        purchase_mock = MagicMock()
        model_mock = MagicMock()
        download_mock = MagicMock()
        
        # Default behavior: table("models") returns our mock model
        def table_side_effect(name):
            chain = MagicMock()
            if name == "models":
                chain.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = model_data["data"]
                return chain
            elif name == "purchases":
                purchase_mock.execute.return_value.data = []
                chain.select.return_value.eq.return_value.eq.return_value.limit.return_value = purchase_mock
                chain.upsert.return_value.execute = MagicMock()
                return chain
            elif name == "downloads":
                chain.upsert.return_value.execute = MagicMock()
                return chain
            return chain
            
        mock_client.table.side_effect = table_side_effect
        
        yield mock_client

@pytest.fixture
def mock_web3():
    with patch("app.routes.ipfs.AsyncWeb3") as mw3:
        mock_w3_inst = MagicMock()
        mw3.return_value = mock_w3_inst
        mw3.AsyncHTTPProvider = MagicMock()
        mw3.to_checksum_address = lambda x: x # pass through
        
        mock_contract = MagicMock()
        mock_w3_inst.eth.contract.return_value = mock_contract
        
        # default to throwing an exception to ensure we don't accidentally permit
        mock_contract.functions.hasAccess.return_value.call = AsyncMock(return_value=False)
        
        # Attach the contract to the patch for easy manipulation
        mw3.mock_contract = mock_contract
        yield mw3


@pytest.mark.anyio
@patch("app.routes.ipfs._valid_cid", return_value=True)
@patch("app.routes.ipfs.httpx.AsyncClient")
async def test_download_allowed_with_db_purchase(mock_httpx, mock_valid_cid, client, mock_supabase):
    # Setup DB to show user already purchased
    def custom_table(name):
        chain = MagicMock()
        if name == "models":
            chain.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"id": 1, "creator_address": "0x0", "name": "test", "price_eth": 1.0}]
        elif name == "purchases":
            chain.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"id": 99}]
        elif name == "downloads":
            return chain
        return chain
    mock_supabase.table.side_effect = custom_table
    
    # Mock httpx HEAD request success
    mock_head = AsyncMock()
    mock_head.headers.get.return_value = "text/plain"
    
    # Mock httpx contexts
    mock_client_inst = AsyncMock()
    mock_client_inst.head.return_value = mock_head
    mock_client_inst.__aenter__.return_value = mock_client_inst
    
    mock_stream = AsyncMock()
    mock_stream.status_code = 200
    mock_stream.aiter_bytes = MagicMock()
    # Provide one empty chunk to instantly complete the generator
    async def mock_aiter(*args, **kwargs):
        yield b""
    mock_stream.aiter_bytes = mock_aiter
    
    mock_client_inst.stream.return_value.__aenter__.return_value = mock_stream
    mock_httpx.return_value = mock_client_inst

    res = await client.get("/api/ipfs/download/QmTest123")
    assert res.status_code == 200


@pytest.mark.anyio
@patch("app.routes.ipfs._valid_cid", return_value=True)
@patch("app.routes.ipfs.httpx.AsyncClient")
async def test_download_allowed_with_chain_fallback(mock_httpx, mock_valid_cid, client, mock_supabase, mock_web3):
    # DB misses by default in the fixture
    
    # Web3 contract returns True for access
    mock_web3.mock_contract.functions.hasAccess.return_value.call = AsyncMock(return_value=True)
    
    # httpx mocking
    mock_head = AsyncMock()
    mock_head.headers.get.return_value = "text/plain"
    mock_client_inst = AsyncMock()
    mock_client_inst.head.return_value = mock_head
    mock_client_inst.__aenter__.return_value = mock_client_inst
    mock_stream = AsyncMock()
    mock_stream.status_code = 200
    mock_stream.aiter_bytes = mock_aiter = MagicMock()
    async def mock_aiter_fn(*args, **kwargs):
        yield b""
    mock_stream.aiter_bytes = mock_aiter_fn
    mock_client_inst.stream.return_value.__aenter__.return_value = mock_stream
    mock_httpx.return_value = mock_client_inst

    # Enable marketplace address to trigger fallback
    with patch("app.routes.ipfs.get_settings") as m_settings:
        m_settings.return_value = MagicMock(marketplace_address="0xABC", alchemy_sepolia_url="")
        res = await client.get("/api/ipfs/download/QmTest123")
        assert res.status_code == 200


@pytest.mark.anyio
@patch("app.routes.ipfs._valid_cid", return_value=True)
async def test_download_denied(mock_valid_cid, client, mock_supabase, mock_web3):
    # DB misses
    # Web3 contract returns False
    mock_web3.mock_contract.functions.hasAccess.return_value.call = AsyncMock(return_value=False)
    
    with patch("app.routes.ipfs.get_settings") as m_settings:
        m_settings.return_value = MagicMock(marketplace_address="0xABC", alchemy_sepolia_url="")
        res = await client.get("/api/ipfs/download/QmTest123")
        assert res.status_code == 403


@pytest.mark.anyio
@patch("app.routes.ipfs._valid_cid", return_value=True)
async def test_rpc_failure_returns_503(mock_valid_cid, client, mock_supabase, mock_web3):
    # RPC fails (exception triggered)
    mock_web3.mock_contract.functions.hasAccess.return_value.call = AsyncMock(side_effect=Exception("RPC down"))
    
    with patch("app.routes.ipfs.get_settings") as m_settings:
        m_settings.return_value = MagicMock(marketplace_address="0xABC", alchemy_sepolia_url="")
        res = await client.get("/api/ipfs/download/QmTest123")
        assert res.status_code == 503


@pytest.mark.anyio
@patch("app.routes.ipfs._valid_cid", return_value=True)
@patch("app.routes.ipfs.httpx.AsyncClient")
async def test_fallback_writes_to_db(mock_httpx, mock_valid_cid, client, mock_supabase, mock_web3):
    mock_web3.mock_contract.functions.hasAccess.return_value.call = AsyncMock(return_value=True)
    
    # httpx mocking
    mock_client_inst = AsyncMock()
    mock_client_inst.__aenter__.return_value = mock_client_inst
    mock_client_inst.head.return_value.headers.get.return_value = "text/plain"
    mock_stream = AsyncMock()
    mock_stream.status_code = 200
    async def mock_aiter_fn(*args, **kwargs):
        yield b""
    mock_stream.aiter_bytes = mock_aiter_fn
    mock_client_inst.stream.return_value.__aenter__.return_value = mock_stream
    mock_httpx.return_value = mock_client_inst

    with patch("app.routes.ipfs.get_settings") as m_settings:
        m_settings.return_value = MagicMock(marketplace_address="0xABC", alchemy_sepolia_url="")
        await client.get("/api/ipfs/download/QmTest123")
        
        # Check if upsert was called on purchases
        upsert_calls = [name for name, _ in mock_supabase.mock_calls if 'purchases' in str(name) and 'upsert' in str(name)]
        assert len(upsert_calls) > 0, "Self-healing cache did not execute upsert"


@pytest.mark.anyio
@patch("app.routes.ipfs._valid_cid", return_value=True)
@patch("app.routes.ipfs.httpx.AsyncClient")
async def test_download_logged(mock_httpx, mock_valid_cid, client, mock_supabase, mock_web3):
    # Test that downloads are correctly logged to the audit table
    mock_web3.mock_contract.functions.hasAccess.return_value.call = AsyncMock(return_value=True)
    
    # httpx
    mock_client_inst = AsyncMock()
    mock_client_inst.__aenter__.return_value = mock_client_inst
    mock_client_inst.head.return_value.headers.get.return_value = "text/plain"
    mock_stream = AsyncMock()
    mock_stream.status_code = 200
    async def mock_aiter_fn(*args, **kwargs):
        yield b""
    mock_stream.aiter_bytes = mock_aiter_fn
    mock_client_inst.stream.return_value.__aenter__.return_value = mock_stream
    mock_httpx.return_value = mock_client_inst
    
    with patch("app.routes.ipfs.get_settings") as m_settings:
        m_settings.return_value = MagicMock(marketplace_address="0xABC", alchemy_sepolia_url="")
        await client.get("/api/ipfs/download/QmTest123")
        
        # Check if upsert was called on downloads
        downloads_upsert_calls = [name for name, _ in mock_supabase.mock_calls if 'downloads' in str(name) and 'upsert' in str(name)]
        assert len(downloads_upsert_calls) > 0, "Audit logging did not execute on downloads table"
