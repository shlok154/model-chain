"""
Phase 1 — Wallet → JWT Authentication
--------------------------------------
Flow:
  1. Frontend calls GET /auth/nonce?wallet=0x...
     → backend stores nonce in Redis (TTL 5min) and returns it
  2. User signs nonce with MetaMask (eth_sign / personal_sign)
  3. Frontend calls POST /auth/verify {wallet, signature}
     → backend recovers signer from signature, checks it matches wallet
     → issues a signed JWT with {wallet, role} claims
  4. JWT is stored in localStorage, sent as Bearer on every API call
  5. Supabase RLS uses the wallet claim injected via postgrest-jwt header
"""

import secrets
import time
from datetime import datetime, timedelta, timezone

from eth_account.messages import encode_defunct
from eth_account import Account
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from supabase import create_client

from .config import get_settings, Settings
from .redis_client import get_redis

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Models ────────────────────────────────────────────────────────────────────

class NonceResponse(BaseModel):
    nonce: str
    message: str   # full human-readable message the frontend should sign

class VerifyRequest(BaseModel):
    wallet: str    # lowercase 0x address
    signature: str # 0x hex signature from MetaMask

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int    # seconds
    wallet: str
    role: str

# ── Helpers ───────────────────────────────────────────────────────────────────

def _nonce_key(wallet: str) -> str:
    return f"nonce:{wallet.lower()}"

def _message_key(wallet: str) -> str:
    return f"nonce_message:{wallet.lower()}"

def _make_jwt(wallet: str, role: str, settings: Settings) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": wallet.lower(),
        "wallet": wallet.lower(),
        "wallet_address": wallet.lower(),   # matches Supabase RLS claim key
        "role": role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def decode_jwt(token: str, settings: Settings) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )

# ── Routes ────────────────────────────────────────────────────────────────────

_local_fallback_cache = {}

@router.get("/nonce", response_model=NonceResponse)
async def get_nonce(wallet: str, redis=Depends(get_redis), settings: Settings = Depends(get_settings)):
    """Issue a one-time nonce the wallet owner must sign."""
    wallet = wallet.lower()
    nonce = secrets.token_hex(16)
    message = (
        f"Welcome to ModelChain!\n\n"
        f"Sign this message to verify wallet ownership.\n"
        f"This does NOT trigger a blockchain transaction.\n\n"
        f"Nonce: {nonce}\n"
        f"Timestamp: {int(time.time())}"
    )
    try:
        pipe = redis.pipeline()
        pipe.setex(_nonce_key(wallet), 300, nonce)
        pipe.setex(_message_key(wallet), 300, message)
        await pipe.execute()
    except Exception:
        # Fallback if Redis is totally offline
        _local_fallback_cache[_nonce_key(wallet)] = nonce
        _local_fallback_cache[_message_key(wallet)] = message
        
    return NonceResponse(nonce=nonce, message=message)


@router.post("/verify", response_model=TokenResponse)
async def verify_signature(
    body: VerifyRequest,
    redis=Depends(get_redis),
    settings: Settings = Depends(get_settings),
):
    """Recover signer from signature, validate nonce, issue JWT."""
    wallet = body.wallet.lower()

    # 1. Retrieve nonce
    try:
        stored_nonce = await redis.get(_nonce_key(wallet))
        stored_message = await redis.get(_message_key(wallet))
        await redis.delete(_nonce_key(wallet), _message_key(wallet))
    except Exception:
        stored_nonce = _local_fallback_cache.pop(_nonce_key(wallet), None)
        stored_message = _local_fallback_cache.pop(_message_key(wallet), None)

    if not stored_nonce:
        raise HTTPException(status_code=401, detail=f"Nonce expired or not found for wallet {wallet}")

    if not stored_message:
        raise HTTPException(status_code=401, detail=f"Nonce session (message) expired for wallet {wallet}")
    
    # Normalise message and line endings as per User Safeguard
    message = stored_message.decode() if isinstance(stored_message, bytes) else str(stored_message)
    message = message.replace("\r\n", "\n")

    # 3. Recover the signer address from the signature
    try:
        signable = encode_defunct(text=message)
        # Normalise signature for eth-account stability
        sig = body.signature
        if isinstance(sig, str):
            sig = sig.strip()
            if sig.startswith("0x"):
                sig = sig[2:]
            sig = bytes.fromhex(sig)
            
        recovered = Account.recover_message(signable, signature=sig)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Signature recovery failed: {e}")

    # Ensure recovered address matches wallet (lowercase comparison)
    if recovered.lower() != wallet.lower().strip():
        raise HTTPException(status_code=401, detail="Signature does not match wallet address.")

    # 5. Determine role: check Supabase for existing user record.
    role = "user"
    try:
        supa = create_client(settings.supabase_url, settings.supabase_service_role_key)
        # Check admin list first (comma-separated in env)
        admin_wallets = {w.strip().lower() for w in settings.admin_wallets.split(",") if w.strip()}
        if wallet in admin_wallets:
            role = "admin"
        else:
            # Check if this wallet has ever listed a model → creator
            models_res = supa.table("models").select("id").eq(
                "creator_address", wallet
            ).limit(1).execute()
            if models_res.data:
                role = "creator"
        res = supa.table("users").upsert(
            {"wallet_address": wallet, "role": role},
            on_conflict="wallet_address",
        ).execute()
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to upsert user record")
    except HTTPException:
        raise
    except Exception as e:
        # Non-fatal: role stays "user" if DB is unreachable at auth time
        print(f"Auth DB error: {e}")
        pass

    # 6. Issue JWT
    token = _make_jwt(wallet, role, settings)
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_expire_minutes * 60,
        wallet=wallet,
        role=role,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    settings: Settings = Depends(get_settings),
):
    """Re-issue a fresh token if the existing one is still valid."""
    payload = decode_jwt(credentials.credentials, settings)
    if not payload or "wallet" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    wallet = payload["wallet"]
    role = payload.get("role", "user")
    new_token = _make_jwt(wallet, role, settings)
    return TokenResponse(
        access_token=new_token,
        expires_in=settings.jwt_expire_minutes * 60,
        wallet=wallet,
        role=role,
    )


@router.post("/request-creator", response_model=TokenResponse)
async def request_creator(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
    settings: Settings = Depends(get_settings),
):
    """Elevate the current user to the 'creator' role."""
    payload = decode_jwt(credentials.credentials, settings)
    if not payload or "wallet" not in payload:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    
    wallet = payload["wallet"]

    try:
        supa = create_client(settings.supabase_url, settings.supabase_service_role_key)
        existing_res = supa.table("users").select("role").eq("wallet_address", wallet).single().execute()
        existing_role = existing_res.data.get("role") if existing_res.data else "user"
    except Exception as e:
        existing_role = "user"

    if existing_role == "admin":
        role = "admin"
    elif existing_role == "creator":
        role = "creator"
    else:
        role = "creator"
        try:
            supa.table("users").upsert(
                {"wallet_address": wallet, "role": role},
                on_conflict="wallet_address",
            ).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upsert creator role: {e}")

    new_token = _make_jwt(wallet, role, settings)
    return TokenResponse(
        access_token=new_token,
        expires_in=settings.jwt_expire_minutes * 60,
        wallet=wallet,
        role=role,
    )

