import pytest
from fastapi.testclient import TestClient
from app.main import app

# Shared Mock Settings
def auth_override():
    return "0x1234567890123456789012345678901234567890"

def get_mock_settings():
    from app.config import Settings
    return Settings(
        marketplace_address="0xABC",
        alchemy_sepolia_url="http://test",
        jwt_secret="test-secret-key-minimum-32-characters-long",
        pinata_jwt="test-token",
        supabase_url="http://test",
        supabase_service_role_key="test-role-key",
        admin_wallets=""
    )

@pytest.fixture(autouse=True)
def reset_overrides():
    from app.main import app
    from app.deps import get_current_wallet, get_settings
    from app.redis_client import get_redis
    from unittest.mock import AsyncMock
    
    # 1. Clear any state from previous tests
    app.dependency_overrides.clear()
    
    # 2. Re-apply baseline overrides
    app.dependency_overrides[get_current_wallet] = auth_override
    app.dependency_overrides[get_settings] = get_mock_settings
    app.dependency_overrides[get_redis] = lambda: AsyncMock()
    
    yield
    
    # 3. Final cleanup after test completion
    app.dependency_overrides.clear()

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c






