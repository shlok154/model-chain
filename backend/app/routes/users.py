"""
User/profile routes — authenticated reads and writes.

These routes exist because the frontend uses the app's own JWT (not a
Supabase JWT), so the browser cannot inject the right claims into the
Supabase client. Direct client writes hit RLS policies keyed on
current_setting('request.jwt.claims') and will be rejected.

All authenticated operations go through FastAPI (which validates the JWT)
and then use the service key to bypass RLS — FastAPI is the access-control
boundary, not Supabase RLS.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client

from ..config import get_settings, Settings
from ..deps import get_current_wallet

router = APIRouter(prefix="/api/users", tags=["users"])


def _supa(settings: Settings) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


# ── Profile read ───────────────────────────────────────────────────────────────

@router.get("/me")
async def get_own_profile(
    wallet: str = Depends(get_current_wallet),
    settings: Settings = Depends(get_settings),
):
    """Return the authenticated user's own profile row, creating it if absent."""
    supa = _supa(settings)
    res = supa.table("users").select("*").eq("wallet_address", wallet).maybe_single().execute()
    if res.data:
        return res.data

    # Row absent — upsert a blank profile (wallet just connected for the first time)
    upsert = supa.table("users").upsert(
        {"wallet_address": wallet},
        on_conflict="wallet_address",
    ).select().execute()
    if not upsert.data:
        raise HTTPException(status_code=500, detail="Could not create profile")
    return upsert.data[0]


@router.get("/{wallet_address}")
async def get_public_profile(wallet_address: str, settings: Settings = Depends(get_settings)):
    """Return any user's public profile (no auth required)."""
    supa = _supa(settings)
    res = supa.table("users").select(
        "wallet_address, display_name, bio, avatar_url, twitter, github, is_verified, created_at"
    ).eq("wallet_address", wallet_address.lower()).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return res.data


# ── Profile update ─────────────────────────────────────────────────────────────

class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(None, max_length=80)
    bio:          Optional[str] = Field(None, max_length=500)
    avatar_url:   Optional[str] = Field(None, max_length=300)
    twitter:      Optional[str] = Field(None, max_length=50)
    github:       Optional[str] = Field(None, max_length=50)


@router.patch("/me")
async def update_own_profile(
    body: ProfileUpdate,
    wallet: str = Depends(get_current_wallet),
    settings: Settings = Depends(get_settings),
):
    """
    Update the authenticated user's profile.

    Uses service key so the write bypasses RLS — FastAPI already verified
    the JWT and extracted the wallet, so we only ever update the caller's
    own row (the WHERE clause enforces ownership, not RLS).
    """
    supa = _supa(settings)

    # Build update dict from non-None fields only
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    res = supa.table("users").update(updates).eq(
        "wallet_address", wallet
    ).select().execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found — connect wallet first")
    return res.data[0]


# ── Purchase history ───────────────────────────────────────────────────────────

@router.get("/me/purchases")
async def get_own_purchases(
    wallet: str = Depends(get_current_wallet),
    settings: Settings = Depends(get_settings),
):
    """
    Return the authenticated user's purchase history.

    Direct Supabase reads for purchases fail in the browser because the
    RLS policy `Buyers read own purchases` uses current_setting('request.jwt.claims'),
    which only works when the Supabase client has the user's JWT injected into it
    (i.e. via postgrest-proxy header). The frontend uses a plain anon key without
    that header, so all purchase rows appear empty.

    Routing through FastAPI with the service key and an explicit wallet filter
    gives correct results for the authenticated caller's purchases.
    """
    supa = _supa(settings)
    res = supa.table("purchases").select(
        "id, model_id, price_paid_eth, on_chain_tx, is_simulated, purchased_at, "
        "models(name, description, category, price_eth, ipfs_hash, version, license)"
    ).eq("buyer_address", wallet).order("purchased_at", desc=True).execute()

    return [
        {
            **{k: v for k, v in row.items() if k != "models"},
            "model_name": (row.get("models") or {}).get("name") or f"Model #{row['model_id']}",
            "model_description": (row.get("models") or {}).get("description") or "",
            "model_category": (row.get("models") or {}).get("category") or "",
            "model_price_eth": (row.get("models") or {}).get("price_eth"),
            "model_ipfs_hash": (row.get("models") or {}).get("ipfs_hash") or "",
            "model_version": (row.get("models") or {}).get("version") or "",
            "model_license": (row.get("models") or {}).get("license") or "",
        }
        for row in (res.data or [])
    ]
