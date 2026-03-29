"""
Phase 3 — Rate Limiting + Request ID middleware
"""
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from .redis_client import get_redis

RATE_LIMITS = {
    "/auth/nonce":        (10, 60),    # 10 req/min per IP — prevents nonce spam
    "/auth/verify":       (5,  60),    # 5 attempts/min per IP — brute-force guard
    "/api/models":        (60, 60),    # 60 req/min
    "/api/ipfs/upload":   (5,  60),    # 5 uploads/min
    "default":            (120, 60),   # 120 req/min for everything else
}

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            redis = await get_redis()
            if redis is None:
                raise Exception("Redis offline")
            
            ip = request.client.host if request.client else "unknown"
            path = request.url.path

            limit = 120
            window = 60
            for prefix, (lim, win) in RATE_LIMITS.items():
                if prefix != "default" and path.startswith(prefix):
                    limit, window = lim, win
                    break

            key = f"rl:{ip}:{path}"
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, window)

            if count > limit:
                retry_after = await redis.ttl(key)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded. Please slow down."},
                    headers={"Retry-After": str(retry_after)},
                )

            response = await call_next(request)
            response.headers["X-RateLimit-Limit"]     = str(limit)
            response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
            return response
        except Exception:
            # Fallback when redis is down
            return await call_next(request)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a unique request ID for tracing."""
    async def dispatch(self, request: Request, call_next):
        req_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = req_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response
