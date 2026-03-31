"""IPFS upload/download proxy. Pinata JWT stays server-side.

v5 improvements:
- Upload streams chunks to Pinata incrementally using httpx streaming API
  instead of assembling the full file in memory first. This keeps memory
  usage proportional to chunk size rather than file size.
  NOTE: Pinata's /pinning/pinFileToIPFS requires a multipart body; we still
  collect chunks into a buffer for the multipart boundary, but we cap at
  MAX_UPLOAD_SIZE and raise early if exceeded — the previous behaviour was
  identical in that regard. True streaming to Pinata would require a
  streaming-multipart library; this version is a safe intermediate step.
- Download streams the Pinata response rather than loading the whole file
  into memory via upstream.content.
- IPFS_EXPOSURE_NOTE added to upload response so callers know the CID is
  publicly accessible on the raw IPFS network.
"""
import re
import time
import httpx
import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import create_client
from web3 import AsyncWeb3
from web3.middleware import ExtraDataToPOAMiddleware
from ..config import get_settings, Settings
from ..deps import get_current_wallet, require_creator_or_admin

router = APIRouter(prefix="/api/ipfs", tags=["ipfs"])

async def emit_telemetry(event: str, **kwargs):
    """Fire-and-forget telemetry sink from backend components"""
    def log():
        import json
        print(f"[TELEMETRY] {event.upper()} | {json.dumps(kwargs)}")
    asyncio.create_task(asyncio.to_thread(log))

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB
_CID_RE = re.compile(r"^Qm[1-9A-HJ-NP-Za-km-z]{44}$|^bafy[a-z2-7]{55}$")


def _valid_cid(cid: str) -> bool:
    return bool(_CID_RE.match(cid))


@router.post("/upload")
async def upload_to_ipfs(
    file: UploadFile = File(...),
    wallet: str = Depends(require_creator_or_admin),
    settings: Settings = Depends(get_settings),
):
    """
    Proxy file upload to Pinata. Only creators/admins can upload.

    Memory model: chunks are read and size-checked incrementally, then
    joined before the Pinata POST (Pinata requires a complete multipart body).
    The 100 MB hard cap means worst-case RSS growth is ~100 MB per concurrent
    upload — acceptable for most deployments. For truly large model files
    (multi-GB), a dedicated object-storage pre-sign flow is recommended instead.
    """
    if not settings.pinata_jwt:
        raise HTTPException(status_code=503, detail="IPFS uploads not configured on this server.")

    # UploadFile's underlying file object is a SpooledTemporaryFile.
    # We can check its size without reading it into memory by seeking to end.
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    
    if file_size > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (max {MAX_UPLOAD_SIZE // 1024 // 1024} MB). "
                   "For files larger than 100 MB, contact the platform operator.",
        )

    safe_filename = re.sub(r"[^\w.\-]", "_", file.filename or "model")

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(
                "https://api.pinata.cloud/pinning/pinFileToIPFS",
                headers={"Authorization": f"Bearer {settings.pinata_jwt}"},
                files={"file": (safe_filename, file.file, file.content_type)},
                data={"pinataMetadata": f'{{"name":"{safe_filename}","keyvalues":{{"uploader":"{wallet}"}}}}'},
            )
    except Exception as e:
        import sys
        import traceback
        print(f"DEBUG IPFS UPLOAD FAIL: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=503, detail=f"IPFS service unavailable: {e}")

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Pinata error: {response.text}")

    data = response.json()
    return {
        "ipfs_hash": data["IpfsHash"],
        "size":      data["PinSize"],
        # Transparency note: the CID is globally public on the IPFS network.
        # Downloads should go through /api/ipfs/download/{hash} which verifies
        # purchase before serving. The CID itself is not a secret.
        "ipfs_exposure_note": (
            "This CID is publicly accessible on the IPFS network. "
            "The backend download proxy verifies purchase before serving, "
            "but anyone who learns this CID can access it via a public IPFS gateway."
        ),
    }


@router.get("/download/{ipfs_hash}")
async def download_from_ipfs(
    ipfs_hash: str,
    wallet: str = Depends(get_current_wallet),
    settings: Settings = Depends(get_settings),
):
    """
    Authenticated download proxy.
    Verifies purchase (or creator ownership) before streaming from IPFS.
    Direct ipfs.io links are removed from the frontend — all downloads route here.

    Streaming: uses httpx streaming mode so the Pinata response is forwarded
    chunk-by-chunk rather than being buffered entirely in server memory.
    This keeps memory constant regardless of file size.
    """
    if not _valid_cid(ipfs_hash):
        raise HTTPException(status_code=400, detail="Invalid IPFS hash format.")

    await emit_telemetry("download_requested", ipfs_cid=ipfs_hash, wallet=wallet)

    supa = create_client(settings.supabase_url, settings.supabase_service_role_key)

    model_res = supa.table("models").select("id, creator_address, name, price_eth").eq(
        "ipfs_hash", ipfs_hash
    ).limit(1).execute()
    if not model_res or not model_res.data:
        raise HTTPException(status_code=404, detail="Model not found in database.")

    model_id     = model_res.data[0]["id"]
    creator_addr = model_res.data[0]["creator_address"]
    model_name   = model_res.data[0].get("name", ipfs_hash)
    model_price  = model_res.data[0].get("price_eth", 0)

    # Creator always has access to their own model
    if wallet != creator_addr:
        purchase_res = supa.table("purchases").select("id").eq(
            "model_id", model_id
        ).eq("buyer_address", wallet).limit(1).execute()
        
        if not purchase_res or purchase_res.data is None:
             raise HTTPException(status_code=403, detail="Purchase verification failed (no record found).")
        
        has_access = len(purchase_res.data) > 0
        
        if has_access:
            await emit_telemetry("ownership_check_db_hit", wallet=wallet, modelId=model_id, source="db")
        else:
            await emit_telemetry("ownership_check_db_miss", wallet=wallet, modelId=model_id)

        # Fallback to on-chain verification if DB is out of sync or missing the purchase
        if not has_access and settings.marketplace_address and settings.marketplace_address != "0x0000000000000000000000000000000000000000":
            t0 = time.time()
            try:
                await emit_telemetry("rpc_call", method="hasAccess", provider="alchemy")
                w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(settings.rpc_url))
                w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
                
                ACCESS_ABI = [{
                    "inputs": [
                        {"internalType": "uint256", "name": "modelId", "type": "uint256"},
                        {"internalType": "address", "name": "user", "type": "address"}
                    ],
                    "name": "hasAccess",
                    "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
                    "stateMutability": "view",
                    "type": "function",
                }]
                
                contract = w3.eth.contract(
                    address=AsyncWeb3.to_checksum_address(settings.marketplace_address),
                    abi=ACCESS_ABI
                )
                
                has_access = await contract.functions.hasAccess(
                    model_id, 
                    AsyncWeb3.to_checksum_address(wallet)
                ).call()
                latency_ms = int((time.time() - t0) * 1000)
                
                if has_access:
                    await emit_telemetry("ownership_check_chain_hit", wallet=wallet, modelId=model_id, source="chain", latency_ms=latency_ms)
                    await emit_telemetry("self_heal_triggered", wallet=wallet, modelId=model_id, reason="db_miss", latency_ms=latency_ms)
                    try:
                        print(f"[IPFS] Fallback success: {wallet} -> model {model_id}")
                        supa.table("purchases").upsert({
                            "model_id": model_id,
                            "buyer_address": wallet,
                            "price_paid_eth": model_price,
                            "on_chain_tx": None,
                            "verification_source": "chain_fallback"
                        }, on_conflict="model_id,buyer_address").execute()
                        await emit_telemetry("self_heal_success", wallet=wallet, modelId=model_id)
                    except Exception as ins_err:
                        # Log but don't fail the download if caching fails
                        await emit_telemetry("self_heal_failed", wallet=wallet, modelId=model_id, error=str(ins_err))
                        print(f"[IPFS Download] Failed to cache fallback purchase: {ins_err}")

            except Exception as e:
                latency_ms = int((time.time() - t0) * 1000)
                await emit_telemetry("rpc_error", method="hasAccess", provider="alchemy", status="error", latency_ms=latency_ms, error=str(e))
                await emit_telemetry("ownership_check_rpc_fail", wallet=wallet, modelId=model_id, latency_ms=latency_ms)
                print(f"[IPFS Download] On-chain access check failed for {wallet}: {e}")
                raise HTTPException(
                    status_code=503,
                    detail="Temporary verification failure, please retry"
                )

        if not has_access:
            await emit_telemetry("access_denied", wallet=wallet, modelId=model_id)
            raise HTTPException(
                status_code=403,
                detail="Purchase required to download this model.",
            )

    await emit_telemetry("access_granted", wallet=wallet, modelId=model_id)
    await emit_telemetry("download_authorized", wallet=wallet, modelId=model_id)

    try:
        supa.table("downloads").upsert({
            "model_id": model_id,
            "user_address": wallet,
            "source": "api_download"
        }, on_conflict="model_id,user_address").execute()
    except Exception as e:
        print(f"[IPFS Download] Failed to write audit log: {e}")

    safe_name = re.sub(r"[^\w.\-]", "_", model_name)[:80] or ipfs_hash

    # Stream from Pinata gateway — raw IPFS URL is never exposed to the client.
    # Using an async generator and 'async with' ensures httpx closes the connection properly.
    gateway_url = f"{settings.ipfs_gateway_url.rstrip('/')}/ipfs/{ipfs_hash}"

    async def _stream_body():
        bytes_sent = 0
        t0 = time.time()
        await emit_telemetry("download_stream_started", wallet=wallet, modelId=model_id, ipfs_cid=ipfs_hash)
        try:
            async with httpx.AsyncClient() as stream_client:
                async with stream_client.stream("GET", gateway_url, follow_redirects=True, timeout=600) as upstream:
                    if upstream.status_code != 200:
                        await emit_telemetry("download_stream_failed", wallet=wallet, modelId=model_id, ipfs_cid=ipfs_hash, error=f"upstream_status_{upstream.status_code}")
                        yield b""
                        return
                    async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                        bytes_sent += len(chunk)
                        yield chunk
            
            duration_ms = int((time.time() - t0) * 1000)
            await emit_telemetry("download_stream_completed", wallet=wallet, modelId=model_id, ipfs_cid=ipfs_hash, bytes_sent=bytes_sent, duration_ms=duration_ms)
        except Exception as e:
            duration_ms = int((time.time() - t0) * 1000)
            await emit_telemetry("download_stream_failed", wallet=wallet, modelId=model_id, ipfs_cid=ipfs_hash, bytes_sent=bytes_sent, duration_ms=duration_ms, error=str(e))
            raise

    # Peek at headers first
    async with httpx.AsyncClient() as head_client:
        head_resp = await head_client.head(gateway_url, follow_redirects=True, timeout=30)
        content_type = head_resp.headers.get("content-type", "application/octet-stream")

    return StreamingResponse(
        _stream_body(),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


# ── Encryption key management ─────────────────────────────────────────────────
# When a creator uploads an encrypted file, they POST the AES key here.
# The backend stores it server-side, keyed by ipfs_hash.
# Purchasers retrieve it at download time after purchase verification.

class KeyRegistration(BaseModel):
    ipfs_hash: str
    key_b64:   str   # base64-encoded AES-256-GCM key
    encrypted: bool = True


@router.post("/register-key")
async def register_encryption_key(
    body: KeyRegistration,
    wallet: str = Depends(require_creator_or_admin),
    settings: Settings = Depends(get_settings),
):
    """
    Store the encryption key for a just-uploaded encrypted IPFS file.
    Only the uploader (creator/admin) may register a key.
    The key is stored in Supabase under service key — never exposed publicly.
    """
    if not _valid_cid(body.ipfs_hash):
        raise HTTPException(status_code=400, detail="Invalid IPFS CID format.")

    supa = create_client(settings.supabase_url, settings.supabase_service_role_key)

    # Verify this wallet owns the model
    model_res = supa.table("models").select("id, creator_address").eq(
        "ipfs_hash", body.ipfs_hash
    ).limit(1).execute()

    # Allow pre-registration (model row may not exist yet — creator uploads key
    # before on-chain tx confirms). We still verify the caller is creator/admin.
    if model_res.data and model_res.data[0]["creator_address"] != wallet:
        raise HTTPException(status_code=403, detail="Only the model creator may register a key.")

    # Store in Supabase — model_encryption_keys table (see migration below)
    supa.table("model_encryption_keys").upsert({
        "ipfs_hash":    body.ipfs_hash,
        "key_b64":      body.key_b64,
        "owner_wallet": wallet,
        "encrypted":    body.encrypted,
    }, on_conflict="ipfs_hash").execute()

    return {"status": "key registered", "ipfs_hash": body.ipfs_hash}


@router.get("/key/{ipfs_hash}")
async def get_decryption_key(
    ipfs_hash: str,
    token: Optional[str] = None,
    wallet: str = Depends(get_current_wallet),
    settings: Settings = Depends(get_settings),
):
    """
    Return the AES decryption key for a model the caller has purchased.
    Purchase verification mirrors the download endpoint.
    If 'token' is absent, ownership is verified and a short-lived token is issued.
    If 'token' is present, the token is validated to deliver the AES key.
    """
    if not _valid_cid(ipfs_hash):
        raise HTTPException(status_code=400, detail="Invalid IPFS CID format.")

    from jose import jwt
    from datetime import datetime, timedelta

    if token:
        # 2. TOKEN VALIDATION
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
            if payload.get("type") != "download_access":
                raise HTTPException(status_code=403, detail="Invalid token type.")
            if payload.get("ipfs_hash") != ipfs_hash:
                raise HTTPException(status_code=403, detail="Token IPFS hash mismatch.")
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=403, detail="Token expired.")
        except Exception as e:
            raise HTTPException(status_code=403, detail=f"Invalid token: {e}")

        supa = create_client(settings.supabase_url, settings.supabase_service_role_key)
        key_res = supa.table("model_encryption_keys").select("key_b64, encrypted").eq(
            "ipfs_hash", ipfs_hash
        ).maybe_single().execute()

        if not key_res or not key_res.data:
            raise HTTPException(status_code=404, detail="Encryption key not found for this CID.")

        return {
            "encrypted": key_res.data["encrypted"],
            "key_b64":   key_res.data["key_b64"] if key_res.data["encrypted"] else None,
        }

    # 1. TOKEN ISSUANCE (Fallback / Primary hit without token)
    supa = create_client(settings.supabase_url, settings.supabase_service_role_key)

    # Resolve model + creator
    model_res = supa.table("models").select("id, creator_address").eq(
        "ipfs_hash", ipfs_hash
    ).limit(1).execute()
    if not model_res.data:
        raise HTTPException(status_code=404, detail="Model not found.")

    model_id     = model_res.data[0]["id"]
    creator_addr = model_res.data[0]["creator_address"]

    # Verify access
    if wallet != creator_addr:
        purchase_res = supa.table("purchases").select("id").eq(
            "model_id", model_id
        ).eq("buyer_address", wallet).limit(1).execute()
        if not purchase_res.data:
            raise HTTPException(status_code=403, detail="Purchase required to retrieve decryption key.")

    # TRADEOFF ACKNOWLEDGMENT:
    # This token is stateless and reusable within the 60s TTL.
    # This is acceptable because: TTL is short, ownership is pre-verified,
    # and the encryption layer still protects the content.
    # Single-use enforcement was considered and deferred due to added
    # Redis complexity with minimal security gain given the above constraints.
    payload = {
        "wallet": wallet,
        "ipfs_hash": ipfs_hash,
        "exp": datetime.utcnow() + timedelta(seconds=60),
        "type": "download_access"
    }
    encoded_token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    return {"token": encoded_token}
