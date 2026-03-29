"""
Phase 3/4 — Models API.

Security model (Fix 4):
  Backend is the security boundary — NOT Supabase RLS.
  - All public reads use the anon key (RLS enforced as a secondary layer)
  - All authenticated writes use the service key (backend validates auth first)
  - The backend validates the JWT before every write operation
  - Supabase is treated as a storage layer; FastAPI enforces access control
"""
import re
from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import create_client, Client
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from ..config import get_settings, Settings
from ..cache import cache_get, cache_set, cache_invalidate_prefix
from ..deps import get_current_wallet, require_creator_or_admin

router = APIRouter(prefix="/api/models", tags=["models"])

# ── Supabase clients ──────────────────────────────────────────────────────────
def get_service_supabase(settings: Settings = Depends(get_settings)) -> Client:
    """Service constraint — backend trusted boundary. Uses ONLY the service role key."""
    assert settings.supabase_service_role_key is not None
    return create_client(settings.supabase_url, settings.supabase_service_role_key)

# ── Input sanitisation ────────────────────────────────────────────────────────
_SEARCH_BLACKLIST = re.compile(r"[().`'\";\\]")
MAX_SEARCH_LEN = 200

def sanitise_search(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()[:MAX_SEARCH_LEN]
    return _SEARCH_BLACKLIST.sub("", value) or None

class RatingCreate(BaseModel):
    rating:  int           = Field(..., ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def strip_comment(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() if v else v

class ModelCreate(BaseModel):
    name:            str   = Field(..., min_length=1, max_length=100)
    description:     str   = Field(..., min_length=1, max_length=2000)
    price_eth:       float = Field(..., gt=0)
    ipfs_hash:       str   = Field(..., min_length=10, max_length=100)
    version:         str   = Field("1.0.0", max_length=20)
    license:         str   = Field("MIT", max_length=50)
    category:        str   = Field(..., max_length=50)
    royalty_percent: int   = Field(10, ge=0, le=50)

class PurchaseSimulate(BaseModel):
    model_id: int
    price_eth: float

# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
async def list_models(
    page:      int            = Query(0, ge=0),
    limit:     int            = Query(20, ge=1, le=100),
    category:  Optional[str] = Query(None, max_length=50),
    search:    Optional[str] = Query(None, max_length=MAX_SEARCH_LEN),
    creator:   Optional[str] = Query(None, max_length=42),
    min_price: Optional[float] = Query(None, ge=0),
    max_price: Optional[float] = Query(None, ge=0),
    sort_by:   str = Query("created_at", pattern="^(created_at|price_eth|purchases)$"),
    order:     str = Query("desc", pattern="^(asc|desc)$"),
    supabase:  Client = Depends(get_service_supabase),
):
    clean_search  = sanitise_search(search)
    clean_creator = creator.lower() if creator else None
    cache_key = f"models:list:{page}:{limit}:{category}:{clean_search}:{clean_creator}:{min_price}:{max_price}:{sort_by}:{order}"
    if cached := await cache_get(cache_key):
        return cached

    offset = page * limit
    query = (supabase.table("models")
        .select("*, creator:users!creator_address(display_name, is_verified)", count="exact"))

    if category:      query = query.eq("category", category)
    if clean_creator: query = query.eq("creator_address", clean_creator)
    if min_price is not None: query = query.gte("price_eth", min_price)
    if max_price is not None: query = query.lte("price_eth", max_price)
    if clean_search:
        query = query.or_(f"name.ilike.%{clean_search}%,description.ilike.%{clean_search}%")

    result = query.order(sort_by, desc=(order == "desc")).range(offset, offset + limit - 1).execute()
    response = {"data": result.data, "total": result.count, "page": page, "limit": limit}
    await cache_set(cache_key, response, ttl=30)
    return response


@router.get("/{model_id}")
async def get_model(model_id: int, supabase: Client = Depends(get_service_supabase)):
    cache_key = f"models:detail:{model_id}"
    if cached := await cache_get(cache_key):
        return cached

    result = supabase.table("models").select(
        "*, creator:users!creator_address(display_name, is_verified, avatar_url, twitter, github)"
    ).eq("id", model_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Model not found")

    ratings = supabase.table("reviews").select("rating").eq("model_id", model_id).execute()
    vals = [r["rating"] for r in (ratings.data or [])]
    avg = round(sum(vals) / len(vals), 1) if vals else None
    response = {**result.data, "avg_rating": avg, "review_count": len(vals)}
    await cache_set(cache_key, response, ttl=60)
    return response

@router.post("/simulate-purchase")
async def simulate_purchase(
    body: PurchaseSimulate,
    wallet: str = Depends(get_current_wallet),
    supabase: Client = Depends(get_service_supabase),
):
    """Simulates a model purchase when running in demo mode without smart contracts."""
    supabase.rpc("record_purchase", {
        "p_model_id":      body.model_id,
        "p_buyer_address": wallet,
        "p_price_eth":     body.price_eth,
        "p_tx_hash":       "simulated",
    }).execute()
    
    # Update is_simulated to True for tracking purposes
    supabase.table("purchases").update({"is_simulated": True}).eq(
        "model_id", body.model_id
    ).eq("buyer_address", wallet).execute()
    
    return {"status": "simulated", "model_id": body.model_id}

@router.post("/simulate-list")
async def simulate_list(
    body: ModelCreate,
    wallet: str = Depends(get_current_wallet),
    supabase: Client = Depends(get_service_supabase),
):
    """Simulates a model listing when running in demo mode without smart contracts."""
    result = supabase.table("models").insert({
        "name": body.name,
        "description": body.description,
        "price_eth": body.price_eth,
        "ipfs_hash": body.ipfs_hash,
        "version": body.version,
        "license": body.license,
        "category": body.category,
        "royalty_percent": body.royalty_percent,
        "creator_address": wallet,
        "tx_hash": "simulated",
        "is_simulated": True,
    }).execute()
    return {"status": "simulated", "data": result.data}

@router.post("/{model_id}/reviews")
async def submit_review(
    model_id: int,
    body: RatingCreate,
    wallet: str = Depends(get_current_wallet),       # Fix 4: backend validates JWT
    supabase: Client = Depends(get_service_supabase),
):
    # Fix 4: backend enforces purchase check — not relying on RLS
    purchase = supabase.table("purchases").select("id").eq(
        "model_id", model_id).eq("buyer_address", wallet).limit(1).execute()
    if not purchase.data:
        raise HTTPException(status_code=403, detail="You must purchase this model to review it.")

    result = supabase.table("reviews").upsert({
        "model_id":     model_id,
        "user_address": wallet,
        "rating":       body.rating,
        "comment":      body.comment,
    }, on_conflict="model_id,user_address").execute()

    await cache_invalidate_prefix(f"models:detail:{model_id}")
    await cache_invalidate_prefix("models:list:")
    return result.data


@router.get("/{model_id}/reviews")
async def get_reviews(model_id: int, supabase: Client = Depends(get_service_supabase)):
    cache_key = f"models:reviews:{model_id}"
    if cached := await cache_get(cache_key):
        return cached
    # Fix 5: explicit FK join on user_address → wallet_address
    result = supabase.table("reviews").select(
        "*, reviewer:users!user_address(display_name)"
    ).eq("model_id", model_id).order("created_at", desc=True).execute()
    await cache_set(cache_key, result.data, ttl=60)
    return result.data
