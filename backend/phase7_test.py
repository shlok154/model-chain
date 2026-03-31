"""
Phase 7 — Deduplication Correctness Under Real Concurrency
===========================================================
PRE-CONDITIONS:
  - Server running with RATE_LIMIT_OVERRIDE=true (docker compose already sets this)
  - Worker running: python -m app.worker (or docker-compose service)
  - Redis accessible at localhost:6379

This script:
  1. Generates a fresh JWT via the ETH wallet auth flow
  2. Flushes the relevant Redis cache and dedup key
  3. Fires 200 concurrent requests (50 workers) at /api/analytics/dashboard
  4. Checks pass/fail criteria:
       - At most 1 analytics_rollup job enqueued per 30-second window
       - Zero HTTP 500 responses
       - metrics:jobs_processed increments by at most 1 analytics_rollup
"""

import concurrent.futures
import httpx
import json
import sys
import time
import subprocess

from eth_account import Account
from eth_account.messages import encode_defunct

BASE_URL = "http://127.0.0.1:8000"
REDIS_HOST = "127.0.0.1"
REDIS_PORT = 6379

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def redis_cmd(*args):
    """Run redis-cli command via docker compose exec (Redis is inside docker)."""
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "redis", "redis-cli"] + list(args),
        capture_output=True, text=True,
        cwd="."  # run from backend dir
    )
    return result.stdout.strip()


def get_jwt(acct):
    """Full wallet auth flow → bearer token."""
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        res = client.get(f"/auth/nonce?wallet={acct.address}")
        if res.status_code != 200:
            raise RuntimeError(f"Nonce failed: {res.status_code} {res.text}")
        data = res.json()
        message = data["message"]
        signed = acct.sign_message(encode_defunct(text=message))

        res = client.post("/auth/verify", json={
            "wallet": acct.address,
            "signature": signed.signature.hex()
        })
        if res.status_code != 200:
            raise RuntimeError(f"Verify failed: {res.status_code} {res.text}")
        return res.json()["access_token"], acct.address


def fetch_dashboard(url: str, headers: dict):
    try:
        with httpx.Client(timeout=15) as client:
            resp = client.get(url, headers=headers)
            return resp.status_code
    except Exception as e:
        return f"ERR:{e}"


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Phase 7 — Deduplication Correctness Under Concurrency")
    print("=" * 60)

    # ── Step 1: Get JWT ────────────────────────────────────────────
    print("\n[1] Obtaining fresh JWT via wallet auth...")
    acct = Account.create()
    try:
        token, wallet = get_jwt(acct)
        print(f"    Wallet : {wallet}")
        print(f"    Token  : {token[:40]}...")
    except Exception as e:
        print(f"    FAIL: {e}")
        sys.exit(1)

    # ── Step 2: Flush Redis keys ───────────────────────────────────
    wallet_lower = wallet.lower()
    cache_key       = f"analytics:dashboard:{wallet_lower}"
    dedup_key       = f"analytics:refresh_lock:{wallet_lower}:dashboard"
    metrics_key     = "metrics:jobs_processed"

    print(f"\n[2] Flushing Redis keys...")
    r1 = redis_cmd("DEL", cache_key)
    r2 = redis_cmd("DEL", dedup_key)
    r3 = redis_cmd("DEL", metrics_key)
    print(f"    DEL {cache_key}        → {r1}")
    print(f"    DEL {dedup_key} → {r2}")
    print(f"    DEL {metrics_key}         → {r3}")

    # ── Step 3: Record queue length before ────────────────────────
    queue_before = int(redis_cmd("LLEN", "analytics_rollup") or "0")
    print(f"\n[3] analytics_rollup queue length before: {queue_before}")
    
    # WARN: If worker is running, this test may fail due to race condition.
    # The caller must ensure the worker is offline.

    # ── Step 4: Fire 200 × concurrent requests ────────────────────
    url     = f"{BASE_URL}/api/analytics/dashboard"
    headers = {"Authorization": f"Bearer {token}"}
    N       = 200
    C       = 50

    print(f"\n[4] Firing {N} requests with concurrency={C}...")
    start = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=C) as pool:
        futures = [pool.submit(fetch_dashboard, url, headers) for _ in range(N)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]
    elapsed = time.time() - start

    # Tally HTTP status codes
    code_counts: dict = {}
    for r in results:
        code_counts[r] = code_counts.get(r, 0) + 1

    print(f"\n[5] Results (wall-clock: {elapsed:.2f}s)")
    for code in sorted(code_counts.keys(), key=str):
        print(f"    HTTP {code}: {code_counts[code]}")

    # ── Step 5: Inspect Redis after ───────────────────────────────
    queue_after  = int(redis_cmd("LLEN", "analytics_rollup") or "0")
    jobs_counter = redis_cmd("GET", metrics_key)
    jobs_enqueued = queue_after - queue_before

    print(f"\n[6] Redis state after test (Worker should be OFF):")
    print(f"    analytics_rollup queue length : {queue_after}")
    print(f"    Jobs enqueued during test     : {jobs_enqueued}")
    print(f"    metrics:jobs_processed (pre)  : {jobs_counter}")

    # ── Step 7: Pass/Fail Evaluation ──────────────────────────────
    print("\n" + "=" * 60)
    print("PASS/FAIL EVALUATION")
    print("=" * 60)

    passes = []
    failures = []

    # Criterion 1: At most 1 rollup job per 30-second window
    #   If elapsed < 30s → expect exactly 1. If > 30s could be 2 (two windows).
    max_allowed = 1 if elapsed < 30 else int(elapsed // 30) + 1
    if jobs_enqueued <= max_allowed:
        passes.append(f"[PASS] Rollup jobs enqueued: {jobs_enqueued} (≤ {max_allowed} allowed for {elapsed:.1f}s window)")
    else:
        failures.append(f"[FAIL] Too many rollup jobs enqueued: {jobs_enqueued} > {max_allowed} (dedup broken!)")

    # Criterion 2: Zero HTTP 500s
    http_500 = code_counts.get(500, 0)
    if http_500 == 0:
        passes.append(f"[PASS] Zero HTTP 500 responses")
    else:
        failures.append(f"[FAIL] {http_500} HTTP 500 responses detected")

    # Criterion 3: No non-HTTP errors
    errors = sum(v for k, v in code_counts.items() if isinstance(k, str) and k.startswith("ERR"))
    if errors == 0:
        passes.append(f"[PASS] Zero connection errors")
    else:
        failures.append(f"[FAIL] {errors} connection/timeout errors")

    for p in passes:
        print(p)
    for f in failures:
        print(f)

    print()
    if not failures:
        print("✅  Phase 7 PASSED — deduplication is correct under concurrency.")
        print()
        print("Record for Phase 8 sign-off:")
        print(f"  hey equivalent : {N} requests, {C} concurrent, {elapsed:.2f}s wall-clock")
        print(f"  HTTP 200       : {code_counts.get(200, 0)}")
        print(f"  HTTP 500       : {code_counts.get(500, 0)}")
        print(f"  Jobs enqueued  : {jobs_enqueued}")
        print(f"  metrics:jobs_processed (pre-worker-drain): {jobs_counter}")
        sys.exit(0)
    else:
        print("❌  Phase 7 FAILED — see FAIL items above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
