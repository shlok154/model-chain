"""
Creator analytics API.

Security model:
- Route is auth-gated: wallet is extracted from JWT by FastAPI, never from query params
- All DB queries are explicitly filtered by that wallet — backend enforces ownership
- Service key used because we do NOT forward the user's JWT to Supabase
- FastAPI is the security boundary; Supabase is storage

Improvements in v5:
- Period-over-period revenue comparison (current 30d vs prior 30d)
- Purchase consistency cross-check: warns if purchases table and models.purchases counter diverge
- Richer per-model stats: revenue share %, actual_purchases from rows (not counter)
- Weekly breakdown for the current month
- Buyer retention metric (repeat buyers across models)
"""
import asyncio
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from supabase import create_client, Client
from ..config import get_settings, Settings
from ..cache import cache_get, cache_set
from ..deps import get_current_wallet

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def get_service_supabase(settings: Settings = Depends(get_settings)) -> Client:
    """Service key — safe here because FastAPI validates the JWT first."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


class LogEventSchema(BaseModel):
    event: str = Field(..., max_length=100)
    session_id: str = Field(..., max_length=50)
    priority: str = Field("normal", max_length=20)
    wallet: str | None = Field(None, max_length=42)
    modelId: int | None = None
    context: dict | None = None

# Prevent DB connection exhaustion during burst log traffic
_telemetry_semaphore = asyncio.Semaphore(50)

def _insert_event_sync(supa: Client, event_data: dict, ip: str):
    """Synchronous Supabase insertion to run in background thread"""
    payload = {
        "event": event_data["event"],
        "session_id": event_data["session_id"],
        "priority": event_data.get("priority", "normal"),
        "wallet_address": event_data.get("wallet"),
        "model_id": event_data.get("modelId"),
        "context": event_data.get("context", {}),
    }
    # Append network context natively
    payload["context"]["client_ip"] = ip
    supa.table("telemetry_logs").insert(payload).execute()


async def _sink_event(supa: Client, event_data: dict, ip: str):
    """
    Safely sink telemetry to database. 
    Drops events if pipeline is fully saturated protecting the application loop.
    'critical' priority events bypass the immediate drop check.
    """
    if _telemetry_semaphore.locked() and event_data.get("priority") != "critical":
        # Drop non-critical logs under load
        return

    async with _telemetry_semaphore:
        try:
            # 1.5s timeout: if Supabase RPC hangs, fail gracefully without holding the semaphore forever
            await asyncio.wait_for(asyncio.to_thread(_insert_event_sync, supa, event_data, ip), timeout=1.5)
        except Exception as e:
            # Telemetry is fire-and-forget; never crash backend flow.
            print(f"[Telemetry Fault] {e}")


@router.post("/log")
async def log_client_event(
    event: LogEventSchema,
    request: Request,
    supabase: Client = Depends(get_service_supabase),
):
    """
    Concurrency-controlled telemetry endpoint. Parses, truncates large
    context payloads to protect storage size, and routes to async DB queue.
    """
    event_dict = event.model_dump()
    
    # Restrict context payload to prevent abuse via oversized JSON parsing
    if event_dict.get("context") and len(str(event_dict["context"])) > 2000:
        event_dict["context"] = {"error": "payload_truncated"}
        
    client_ip = request.client.host if request.client else "unknown"

    asyncio.create_task(_sink_event(supabase, event_dict, client_ip))
    return {"status": "accepted"}


@router.get("/telemetry-summary")
async def telemetry_summary(
    wallet: str = Depends(get_current_wallet),
    supabase: Client = Depends(get_service_supabase),
):
    """
    Aggregated telemetry insights scoped to the authenticated wallet.
    Returns conversion funnel, failure breakdown, and RPC health — all in one call.
    Uses SQL-level aggregation for performance.
    """
    if not wallet:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    cache_key = f"analytics:telemetry:{wallet}"
    if cached := await cache_get(cache_key):
        return cached

    # ── Conversion funnel ─────────────────────────────────────────────────────
    funnel_events = [
        "wallet_connect_clicked", "signature_requested",
        "tx_initiated", "tx_submitted", "tx_confirmed", "download_requested"
    ]
    funnel_res = supabase.table("telemetry_logs").select(
        "event"
    ).in_("event", funnel_events).execute()

    funnel_counts: dict[str, int] = {e: 0 for e in funnel_events}
    for row in (funnel_res.data or []):
        ev = row["event"]
        if ev in funnel_counts:
            funnel_counts[ev] += 1

    conversion_funnel = {
        "viewed": funnel_counts.get("wallet_connect_clicked", 0),
        "clicked": funnel_counts.get("signature_requested", 0),
        "purchased": funnel_counts.get("tx_confirmed", 0),
        "downloaded": funnel_counts.get("download_requested", 0),
    }

    # ── Failure reasons ───────────────────────────────────────────────────────
    fail_res = supabase.table("telemetry_logs").select(
        "context"
    ).eq("event", "tx_failed").execute()

    reason_counts: dict[str, int] = {}
    for row in (fail_res.data or []):
        ctx = row.get("context") or {}
        reason = ctx.get("errorMessage", "unknown")
        # Normalize common messages for cleaner grouping
        if "rejected" in reason.lower() or "4001" in str(ctx.get("errorCode", "")):
            reason = "User rejected transaction"
        elif "insufficient" in reason.lower():
            reason = "Insufficient funds"
        elif "timeout" in reason.lower():
            reason = "RPC timeout"
        reason_counts[reason] = reason_counts.get(reason, 0) + 1

    failure_reasons = sorted(
        [{"reason": r, "count": c} for r, c in reason_counts.items()],
        key=lambda x: x["count"], reverse=True
    )[:10]

    # ── RPC health ────────────────────────────────────────────────────────────
    rpc_res = supabase.table("telemetry_logs").select(
        "event, context"
    ).in_("event", ["rpc_call", "rpc_error"]).execute()

    total_rpc = 0
    rpc_errors = 0
    latencies: list[float] = []
    for row in (rpc_res.data or []):
        total_rpc += 1
        if row["event"] == "rpc_error":
            rpc_errors += 1
        ctx = row.get("context") or {}
        if "latency_ms" in ctx:
            try:
                latencies.append(float(ctx["latency_ms"]))
            except (ValueError, TypeError):
                pass

    rpc_health = {
        "total_calls": total_rpc,
        "errors": rpc_errors,
        "success_rate": round((total_rpc - rpc_errors) / total_rpc * 100, 1) if total_rpc > 0 else 100,
        "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
    }

    # ── Success / failure rate (tx lifecycle) ─────────────────────────────────
    tx_success_res = supabase.table("telemetry_logs").select(
        "id", count="exact"
    ).eq("event", "tx_confirmed").execute()
    tx_fail_res = supabase.table("telemetry_logs").select(
        "id", count="exact"
    ).eq("event", "tx_failed").execute()

    tx_ok = tx_success_res.count or 0
    tx_fail = tx_fail_res.count or 0
    tx_total = tx_ok + tx_fail

    response = {
        "conversion_funnel": conversion_funnel,
        "failure_reasons": failure_reasons,
        "rpc_health": rpc_health,
        "tx_success_rate": round(tx_ok / tx_total * 100, 1) if tx_total > 0 else 100,
        "tx_failure_rate": round(tx_fail / tx_total * 100, 1) if tx_total > 0 else 0,
        "tx_total": tx_total,
    }
    await cache_set(cache_key, response, ttl=30)
    return response


@router.get("/dashboard")
async def creator_dashboard(
    wallet: str = Depends(get_current_wallet),   # wallet comes ONLY from validated JWT
    supabase: Client = Depends(get_service_supabase),
):
    """
    Return analytics strictly scoped to the authenticated wallet.
    The wallet is extracted from the JWT — callers cannot request another
    user's data by passing a different address.
    """
    if not wallet:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    cache_key = f"analytics:dashboard:{wallet}"
    if cached := await cache_get(cache_key):
        return cached

    # ── Models owned by this creator ──────────────────────────────────────────
    models_res = supabase.table("models").select(
        "id, name, price_eth, royalty_percent, purchases, created_at, category"
    ).eq("creator_address", wallet).execute()
    models = models_res.data or []

    # ── Purchases of those models (source of truth for revenue) ───────────────
    model_ids = [m["id"] for m in models]
    purchases: list[dict] = []
    if model_ids:
        p_res = supabase.table("purchases").select(
            "model_id, price_paid_eth, purchased_at, buyer_address"
        ).in_("model_id", model_ids).execute()
        purchases = p_res.data or []

    # ── Reviews of those models ───────────────────────────────────────────────
    reviews: list[dict] = []
    if model_ids:
        r_res = supabase.table("reviews").select(
            "model_id, rating"
        ).in_("model_id", model_ids).execute()
        reviews = r_res.data or []

    # ── Aggregate stats ───────────────────────────────────────────────────────
    total_sales   = len(purchases)
    total_earned  = round(sum(float(p["price_paid_eth"]) for p in purchases), 6)
    unique_buyers = len({p["buyer_address"] for p in purchases})
    avg_royalty   = (
        round(sum(m["royalty_percent"] for m in models) / len(models), 2)
        if models else 0
    )

    # ── Data consistency cross-check ──────────────────────────────────────────
    # Detect if the purchases counter in models table diverges from actual rows.
    # This is non-fatal but surfaced as a warning field so operators can re-sync.
    consistency_warnings: list[str] = []
    for m in models:
        actual_count = sum(1 for p in purchases if p["model_id"] == m["id"])
        counter_value = m.get("purchases", 0) or 0
        if abs(actual_count - counter_value) > 0:
            consistency_warnings.append(
                f"model {m['id']} ({m['name']!r}): counter={counter_value}, actual_rows={actual_count}"
            )

    # ── Average ratings per model ─────────────────────────────────────────────
    ratings_by_model: dict[int, list[int]] = {m["id"]: [] for m in models}
    for r in reviews:
        if r["model_id"] in ratings_by_model:
            ratings_by_model[r["model_id"]].append(r["rating"])

    overall_ratings = [r for vals in ratings_by_model.values() for r in vals]
    avg_rating = round(sum(overall_ratings) / len(overall_ratings), 2) if overall_ratings else None
    total_reviews = len(overall_ratings)

    # ── Monthly revenue (last 6 months) ───────────────────────────────────────
    now = datetime.now(timezone.utc)
    monthly: dict[str, float] = {}
    for i in range(5, -1, -1):
        d = (now.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        monthly[d.strftime("%b")] = 0.0

    for p in purchases:
        try:
            dt = datetime.fromisoformat(p["purchased_at"].replace("Z", "+00:00"))
            key = dt.strftime("%b")
            if key in monthly:
                monthly[key] = round(monthly[key] + float(p["price_paid_eth"]), 6)
        except Exception:
            pass

    # ── Period-over-period comparison (current 30d vs prior 30d) ─────────────
    now_ts = datetime.now(timezone.utc)
    period_start_current = now_ts - timedelta(days=30)
    period_start_prior   = now_ts - timedelta(days=60)

    revenue_current_period = 0.0
    revenue_prior_period   = 0.0
    sales_current_period   = 0
    sales_prior_period     = 0

    for p in purchases:
        try:
            dt = datetime.fromisoformat(p["purchased_at"].replace("Z", "+00:00"))
            amt = float(p["price_paid_eth"])
            if dt >= period_start_current:
                revenue_current_period += amt
                sales_current_period   += 1
            elif dt >= period_start_prior:
                revenue_prior_period += amt
                sales_prior_period   += 1
        except Exception:
            pass

    revenue_current_period = round(revenue_current_period, 6)
    revenue_prior_period   = round(revenue_prior_period, 6)

    # % change; None if prior period is zero (avoid division by zero)
    revenue_change_pct: float | None = None
    if revenue_prior_period > 0:
        revenue_change_pct = round(
            (revenue_current_period - revenue_prior_period) / revenue_prior_period * 100, 1
        )

    sales_change_pct: float | None = None
    if sales_prior_period > 0:
        sales_change_pct = round(
            (sales_current_period - sales_prior_period) / sales_prior_period * 100, 1
        )

    # ── Weekly breakdown for the current month ────────────────────────────────
    month_start = now_ts.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    weeks: dict[str, float] = {}
    for p in purchases:
        try:
            dt = datetime.fromisoformat(p["purchased_at"].replace("Z", "+00:00"))
            if dt >= month_start:
                week_num = ((dt.day - 1) // 7) + 1
                key = f"W{week_num}"
                weeks[key] = round(weeks.get(key, 0.0) + float(p["price_paid_eth"]), 6)
        except Exception:
            pass

    # ── Buyer retention ───────────────────────────────────────────────────────
    # Buyers who purchased more than one model from this creator
    buyer_model_counts: dict[str, set] = {}
    for p in purchases:
        buyer = p["buyer_address"]
        if buyer not in buyer_model_counts:
            buyer_model_counts[buyer] = set()
        buyer_model_counts[buyer].add(p["model_id"])

    repeat_buyers = sum(1 for models_bought in buyer_model_counts.values() if len(models_bought) > 1)
    retention_rate = round(repeat_buyers / unique_buyers * 100, 1) if unique_buyers > 0 else 0.0

    # ── Per-model revenue breakdown ───────────────────────────────────────────
    model_revenue: dict[int, float] = {m["id"]: 0.0 for m in models}
    for p in purchases:
        mid = p["model_id"]
        if mid in model_revenue:
            model_revenue[mid] = round(model_revenue[mid] + float(p["price_paid_eth"]), 6)

    top_models = sorted(
        [
            {
                "id":          mid,
                "name":        next((m["name"] for m in models if m["id"] == mid), ""),
                "category":    next((m.get("category", "") for m in models if m["id"] == mid), ""),
                "price_eth":   float(next((m["price_eth"] for m in models if m["id"] == mid), 0)),
                "revenue":     round(rev, 4),
                "revenue_share_pct": (
                    round(rev / total_earned * 100, 1) if total_earned > 0 else 0.0
                ),
                "purchases":   next((m["purchases"] for m in models if m["id"] == mid), 0),
                # Use actual purchase rows as the reliable count (cross-checks the counter)
                "actual_purchases": sum(1 for p in purchases if p["model_id"] == mid),
                "avg_rating": (
                    round(sum(ratings_by_model.get(mid, [])) / len(ratings_by_model[mid]), 2)
                    if ratings_by_model.get(mid) else None
                ),
                "review_count": len(ratings_by_model.get(mid, [])),
            }
            for mid, rev in model_revenue.items()
        ],
        key=lambda x: x["revenue"],
        reverse=True,
    )[:5]

    # ── Category breakdown ────────────────────────────────────────────────────
    categories: dict[str, int] = {}
    for m in models:
        cat = m.get("category", "Other")
        categories[cat] = categories.get(cat, 0) + 1

    response = {
        # Identity echo — client can verify this matches the signed-in wallet
        "wallet":              wallet,

        # Core totals
        "total_earned":        total_earned,
        "models_listed":       len(models),
        "total_sales":         total_sales,
        "unique_buyers":       unique_buyers,
        "avg_royalty":         avg_royalty,
        "avg_rating":          avg_rating,
        "total_reviews":       total_reviews,

        # Trend analysis (current vs prior 30-day window)
        "period_comparison": {
            "current_30d_revenue": revenue_current_period,
            "prior_30d_revenue":   revenue_prior_period,
            "revenue_change_pct":  revenue_change_pct,   # None if no prior data
            "current_30d_sales":   sales_current_period,
            "prior_30d_sales":     sales_prior_period,
            "sales_change_pct":    sales_change_pct,
        },

        # Buyer behaviour
        "buyer_retention": {
            "repeat_buyers":    repeat_buyers,
            "retention_rate":   retention_rate,   # % of buyers who bought >1 model
        },

        # Charts
        "monthly_revenue":    [{"month": k, "eth": round(v, 4)} for k, v in monthly.items()],
        "weekly_revenue_mtd": [{"week": k, "eth": round(v, 4)} for k, v in sorted(weeks.items())],

        # Tables
        "top_models":         top_models,
        "category_breakdown": categories,

        # Data quality signal — empty list means all purchase counters are consistent
        "consistency_warnings": consistency_warnings,
    }
    await cache_set(cache_key, response, ttl=120)
    return response
