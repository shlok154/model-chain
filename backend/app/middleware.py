"""
Phase 3 — Rate Limiting + Request ID middleware
"""
import os
import time
import uuid
from jose import jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from .redis_client import get_redis

RATE_LIMITS = {
    "/auth/nonce":           (5, 60),
    "/auth/verify":          (3, 60),
    "/auth/request-creator": (3, 60),
    "/api/models":           (60, 60),
    "/api/ipfs/upload":      (3, 60),
    "/api/ipfs/download":    (20, 60),
    "/api/analytics":        (30, 60),
    "default":               (100, 60),
}

RATE_LIMIT_OVERRIDE = os.getenv("RATE_LIMIT_OVERRIDE") == "true"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if RATE_LIMIT_OVERRIDE:
            return await call_next(request)
            
        try:
            redis = await get_redis()
            if redis is None:
                raise Exception("Redis offline")
            
            # Extract composite key logic
            wallet_or_ip = request.client.host if request.client else "unknown"
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header[len("Bearer "):]
                try:
                    payload = jwt.get_unverified_claims(token)
                    if "wallet" in payload:
                        wallet_or_ip = payload["wallet"]
                except Exception:
                    pass

            path = request.url.path

            limit = RATE_LIMITS["default"][0]
            window = RATE_LIMITS["default"][1]
            for prefix, (lim, win) in RATE_LIMITS.items():
                if prefix != "default" and path.startswith(prefix):
                    limit, window = lim, win
                    break

            # Burst control
            is_sensitive = path.startswith("/auth/") or path.startswith("/api/ipfs/upload")
            if is_sensitive:
                burst_key = f"rl:burst:{wallet_or_ip}:{path}"
                burst_count = await redis.incr(burst_key)
                if burst_count == 1:
                    await redis.expire(burst_key, 5)
                
                if burst_count > 10:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Burst rate limit exceeded. Please slow down."},
                        headers={
                            "Retry-After": "10",
                            "X-RateLimit-Limit": "10",
                            "X-RateLimit-Remaining": "0",
                            "X-RateLimit-Reset": str(int(time.time()) + 10)
                        },
                    )

            key = f"rl:{wallet_or_ip}:{path}"
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, window)

            if count > limit:
                retry_after = await redis.ttl(key)
                retry_after_val = retry_after if retry_after > 0 else window
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Please slow down."},
                    headers={
                        "Retry-After": str(retry_after_val),
                        "X-RateLimit-Limit": str(limit),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(int(time.time()) + retry_after_val)
                    },
                )

            response = await call_next(request)
            
            # Response headers
            ttl = await redis.ttl(key)
            reset_ts = int(time.time()) + (ttl if ttl > 0 else window)
            
            response.headers["X-RateLimit-Limit"]     = str(limit)
            response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
            response.headers["X-RateLimit-Reset"]     = str(reset_ts)
            return response

        except Exception:
            # Fallback when redis is down
            path = request.url.path
            if path.startswith("/auth/"):
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Authentication temporarily unavailable"}
                )
            return await call_next(request)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a unique request ID for tracing."""
    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = req_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response
