"""Reusable FastAPI dependencies — auth, role guards."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Tuple

from .auth import decode_jwt
from .config import get_settings, Settings

bearer = HTTPBearer()


def _decode_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Decode JWT exactly once and return the full payload."""
    return decode_jwt(credentials.credentials, settings)


def get_current_wallet(payload: dict = Depends(_decode_token)) -> str:
    """Extract and validate JWT, return wallet address."""
    wallet = payload.get("wallet")
    if not wallet:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return wallet.lower()


def get_current_role(payload: dict = Depends(_decode_token)) -> str:
    """Extract role from JWT claims."""
    return payload.get("role", "user")


def get_wallet_and_role(payload: dict = Depends(_decode_token)) -> Tuple[str, str]:
    """Return (wallet, role) from a single JWT decode — avoids double-decoding."""
    wallet = payload.get("wallet")
    if not wallet:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return wallet.lower(), payload.get("role", "user")


def require_creator_or_admin(
    wallet_and_role: Tuple[str, str] = Depends(get_wallet_and_role),
) -> str:
    """Require creator or admin role — used on upload/list endpoints."""
    wallet, role = wallet_and_role
    if role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators and admins can list models. "
                   "Upload a model first to become a creator.",
        )
    return wallet


def require_admin(
    wallet_and_role: Tuple[str, str] = Depends(get_wallet_and_role),
) -> str:
    """Require admin role."""
    wallet, role = wallet_and_role
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return wallet
