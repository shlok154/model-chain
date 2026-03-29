"""
ModelChain Backend API v2
Run dev:  uvicorn app.main:app --reload --port 8000
Run prod: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
"""
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .middleware import RateLimitMiddleware, RequestIDMiddleware
from .auth import router as auth_router
from .routes.models import router as models_router
from .routes.ipfs import router as ipfs_router
from .routes.analytics import router as analytics_router
from .routes.admin import router as admin_router
from .routes.users import router as users_router
from .redis_client import get_redis

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Validate security config at startup — fail hard, fail early
    settings = get_settings()
    settings.validate_security()
    yield

app = FastAPI(
    title="ModelChain API",
    version="2.1.0",
    description="Backend for the ModelChain AI model marketplace",
    lifespan=lifespan,
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIDMiddleware)
app.add_middleware(RateLimitMiddleware)

app.include_router(auth_router)
app.include_router(models_router)
app.include_router(ipfs_router)
app.include_router(analytics_router)
app.include_router(admin_router)
app.include_router(users_router)

@app.get("/health")
async def health():
    """
    Health check — includes event listener status from Redis.
    The listener writes its health to Redis with a 60s TTL.
    If the key is absent, the listener has not run recently.
    """
    redis = await get_redis()
    listener: dict = {}
    try:
        raw = await redis.get("modelchain:event_listener:health")
        listener = json.loads(raw) if raw else {"status": "unknown"}
    except Exception:
        listener = {"status": "error"}

    return {
        "status":          "ok",
        "version":         "2.1.0",
        "event_listener":  listener,
    }
