import pytest
from fastapi.testclient import TestClient
from app.main import app
from unittest.mock import patch, MagicMock

# Global Auth Override for tests
def auth_override():
    return "0x1234567890123456789012345678901234567890"

@pytest.fixture
def anyio_backend():
    return "asyncio"

@pytest.fixture
def client():
    app.dependency_overrides.clear()
    from app.deps import get_current_wallet
    app.dependency_overrides[get_current_wallet] = auth_override
    
    with TestClient(app) as c:
        yield c
        
    app.dependency_overrides.clear()
