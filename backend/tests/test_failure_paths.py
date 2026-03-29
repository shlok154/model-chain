import pytest
from unittest.mock import AsyncMock, patch, MagicMock

@pytest.fixture
def mock_supabase_res():
    def _make(data):
        res = MagicMock()
        res.data = data
        res.error = None
        return res
    return _make

@pytest.mark.anyio
async def test_failure_invalid_jwt(client):
    """Failure Path: Invalid JWT should return 401."""
    from app.deps import get_current_wallet
    # We remove the baseline override for this specific test to use the real dependency
    if get_current_wallet in client.app.dependency_overrides:
        del client.app.dependency_overrides[get_current_wallet]
    
    response = client.get("/api/ipfs/download/QmTest123", headers={"Authorization": "Bearer invalid.token.here"})
    assert response.status_code == 401
    assert "Invalid token" in response.json()["detail"]


@pytest.mark.anyio
async def test_failure_non_owner_download(client, mock_supabase_res):
    """Failure Path: Non-owner should return 403."""
    from app.deps import get_current_wallet
    # conftest.py already handles get_settings
    client.app.dependency_overrides[get_current_wallet] = lambda: "0xNonOwner"
    
    with patch("app.routes.ipfs.create_client") as mock_supa, \
         patch("app.routes.ipfs.AsyncWeb3") as mock_w3, \
         patch("app.routes.ipfs._valid_cid", return_value=True):
        
        # Mock model exists but purchase does not
        supa = MagicMock()
        supa.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = mock_supabase_res([
            {"id": 1, "creator_address": "0xCreator", "name": "test", "price_eth": 1.0}
        ])
        
        # purchase check returns empty
        supa.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value = mock_supabase_res([])
        mock_supa.return_value = supa
        
        # Chain check also returns False
        mock_w3_inst = MagicMock()
        mock_w3.return_value = mock_w3_inst
        mock_w3_inst.eth.contract.return_value.functions.hasAccess.return_value.call = AsyncMock(return_value=False)
        
        response = client.get("/api/ipfs/download/QmTest123")
        assert response.status_code == 403
        assert "Purchase required" in response.json()["detail"]

@pytest.mark.anyio
async def test_failure_missing_model_record(client, mock_supabase_res):
    """Failure Path: Missing database record for model CID should return 404."""
    from app.deps import get_current_wallet
    client.app.dependency_overrides[get_current_wallet] = lambda: "0xTest"
    
    with patch("app.routes.ipfs.create_client") as mock_supa, \
         patch("app.routes.ipfs._valid_cid", return_value=True):
        supa = MagicMock()
        # Model query returns empty list
        supa.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = mock_supabase_res([])
        mock_supa.return_value = supa
        
        response = client.get("/api/ipfs/download/QmMissing123")
        assert response.status_code == 404
        assert "Model not found" in response.json()["detail"]

@pytest.mark.anyio
async def test_ipfs_hash_upload_validation(client):
    """Validation: Upload response should include a valid IPFS hash (CID)."""
    # conftest.py already handles get_settings
    from app.deps import require_creator_or_admin
    client.app.dependency_overrides[require_creator_or_admin] = lambda: "0xAdmin"
    
    with patch("app.routes.ipfs.httpx.AsyncClient") as mock_httpx_class:
        # Step 1: Fix httpx.AsyncClient async context mocks
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        
        # Mock the POST response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "IpfsHash": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
            "PinSize": 1234
        }
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_httpx_class.return_value = mock_client
        
        # Mock file upload
        files = {"file": ("test.bin", b"data", "application/octet-stream")}
        response = client.post(
            "/api/ipfs/upload", 
            files=files,
            headers={"Authorization": "Bearer test-token"}
        )
        
        assert response.status_code == 200

        # Step 4: Robust CID/Value Validation
        data = response.json()
        cid = data["ipfs_hash"]
        assert isinstance(cid, str)
        assert len(cid) >= 46
        assert cid.startswith(("Qm", "bafy"))




