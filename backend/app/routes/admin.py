"""
Admin-only routes — owner/platform visibility.

These routes surface the contract owner's view of the platform:
- Platform fee earnings (from the smart contract, via Web3)
- Dead-letter queue (failed event listener events)
- Event listener health

All routes require admin role (JWT claim role=admin).
"""
import json
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from web3 import AsyncWeb3
from web3.middleware import ExtraDataToPOAMiddleware
from ..config import get_settings, Settings
from ..deps import require_admin
from ..redis_client import get_redis

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Minimal ABI for owner-facing view calls
OWNER_ABI = [
    {
        "inputs": [],
        "name": "platformEarnings",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "platformFeeBps",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "paused",
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "modelCount",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "escrowTimeout",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "minStake",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


@router.get("/platform")
async def platform_overview(
    admin_wallet: str = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Return platform-level stats visible only to admins.
    Reads directly from the smart contract for financial data to avoid
    any DB inconsistency.
    """
    # ── Contract data ──────────────────────────────────────────────────────────
    contract_data: dict = {}
    try:
        w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(settings.alchemy_sepolia_url))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        contract = w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(settings.marketplace_address),
            abi=OWNER_ABI,
        )
        platform_earnings_wei = await contract.functions.platformEarnings().call()
        fee_bps               = await contract.functions.platformFeeBps().call()
        owner_address         = await contract.functions.owner().call()
        is_paused             = await contract.functions.paused().call()
        model_count           = await contract.functions.modelCount().call()
        escrow_timeout_secs   = await contract.functions.escrowTimeout().call()
        min_stake_wei         = await contract.functions.minStake().call()

        contract_data = {
            "platform_earnings_eth":  round(platform_earnings_wei / 1e18, 8),
            "platform_fee_bps":       fee_bps,
            "platform_fee_pct":       round(fee_bps / 100, 2),
            "contract_owner":         owner_address.lower(),
            "is_paused":              is_paused,
            "model_count_onchain":    model_count,
            "escrow_timeout_hours":   round(escrow_timeout_secs / 3600, 1),
            "min_stake_eth":          round(min_stake_wei / 1e18, 6),
        }
    except Exception as e:
        contract_data = {"error": f"Could not read contract: {e}"}

    # ── Listener health ────────────────────────────────────────────────────────
    listener_health: dict = {}
    try:
        raw = await redis.get("modelchain:event_listener:health")
        if raw:
            listener_health = json.loads(raw)
        else:
            listener_health = {"status": "unknown", "note": "Health key not present — listener may not be running"}
    except Exception as e:
        listener_health = {"status": "error", "error": str(e)}

    # ── Dead-letter queue ──────────────────────────────────────────────────────
    dead_letters: list[dict] = []
    try:
        raw_list = await redis.lrange("modelchain:event_listener:dead_letter", 0, 49)
        dead_letters = [json.loads(item) for item in raw_list]
    except Exception as e:
        dead_letters = [{"error": str(e)}]

    return {
        "admin_wallet":    admin_wallet,
        "contract":        contract_data,
        "listener_health": listener_health,
        "dead_letter_count": len(dead_letters),
        "dead_letters_recent": dead_letters[:10],  # show most recent 10
    }
