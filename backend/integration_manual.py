import httpx
import sys
import traceback
from eth_account import Account
from eth_account.messages import encode_defunct

BASE_URL = "http://127.0.0.1:8000"


def get_jwt(acct):
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        res = client.get(f"/auth/nonce?wallet={acct.address}")
        if res.status_code != 200:
            print(f"  Error getting nonce: {res.status_code} - {res.text}")
            return None
        data = res.json()
        nonce = data["nonce"]
        msg = data["message"]

        signed = acct.sign_message(encode_defunct(text=msg))

        res = client.post("/auth/verify", json={
            "wallet": acct.address,
            "signature": signed.signature.hex()
        })
        if res.status_code != 200:
            print(f"  Failed to verify: {res.status_code} - {res.text}")
            return None
        return res.json()["access_token"]


def main():
    passed = 0
    failed = 0
    model_id = None
    ipfs_hash = None
    price_eth = None

    # ── Step 1: Wallet Login ──
    print("--- 1. Wallet Login ---")
    acct1 = Account.create()
    acct2 = Account.create()
    jwt1 = get_jwt(acct1)
    jwt2 = get_jwt(acct2)
    if jwt1 and jwt2:
        print(f"  [PASS] Logged in Buyer 1: {acct1.address}")
        print(f"  [PASS] Logged in Buyer 2: {acct2.address}")
        passed += 2
    else:
        print("  [FAIL] Login failed")
        failed += 2
        print(f"\nResults: {passed} passed, {failed} failed")
        sys.exit(1)

    client1 = httpx.Client(base_url=BASE_URL, headers={"Authorization": f"Bearer {jwt1}"}, timeout=15)
    client2 = httpx.Client(base_url=BASE_URL, headers={"Authorization": f"Bearer {jwt2}"}, timeout=15)

    # ── Step 2: Model Listing ──
    print("\n--- 2. Model Listing ---")
    try:
        res = client1.get("/api/models")
        if res.status_code != 200:
            print(f"  [FAIL] /api/models returned {res.status_code}: {res.text[:300]}")
            failed += 1
        else:
            body = res.json()
            models = body.get("data", [])
            if not models:
                print("  [FAIL] No models found in DB. Seed the database first.")
                failed += 1
            else:
                model = models[0]
                model_id = model["id"]
                ipfs_hash = model.get("ipfs_hash", "")
                price_eth = model.get("price_eth", 0)
                print(f"  [PASS] Found model: {model['name']} (ID={model_id}, IPFS={ipfs_hash})")
                passed += 1
    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        traceback.print_exc()
        failed += 1

    if model_id is None or not ipfs_hash:
        print("\nCannot continue without a valid model. Stopping.")
        print(f"\nResults: {passed} passed, {failed} failed")
        sys.exit(1)

    # ── Step 3: Unauthorized Download (before purchase) ──
    print("\n--- 3. Unauthorized Download (before purchase) ---")
    try:
        res = client1.get(f"/api/ipfs/download/{ipfs_hash}")
        if res.status_code == 403:
            print(f"  [PASS] Got expected 403: {res.json().get('detail', '')}")
            passed += 1
        else:
            print(f"  [FAIL] Expected 403, got {res.status_code}: {res.text[:300]}")
            failed += 1
    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        failed += 1

    # ── Step 4: Simulated Purchase ──
    print("\n--- 4. Simulated Purchase ---")
    try:
        res = client1.post("/api/models/simulate-purchase", json={
            "model_id": model_id,
            "price_eth": price_eth
        })
        if res.status_code == 200:
            print(f"  [PASS] Purchase recorded: {res.json()}")
            passed += 1
        else:
            print(f"  [FAIL] Purchase failed ({res.status_code}): {res.text[:300]}")
            failed += 1
    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        failed += 1

    # ── Step 5: Authorized Download (after purchase) ──
    print("\n--- 5. Authorized Download (after purchase) ---")
    try:
        with client1.stream("GET", f"/api/ipfs/download/{ipfs_hash}") as stream_res:
            if stream_res.status_code == 200:
                print(f"  [PASS] Stream opened (200)")
                passed += 1
            else:
                body = stream_res.read().decode(errors="replace")
                print(f"  [FAIL] Expected 200, got {stream_res.status_code}: {body[:300]}")
                failed += 1
    except Exception as e:
        print(f"  [FAIL] Stream exception: {e}")
        failed += 1

    # ── Step 6: Unauthorized Download (different wallet) ──
    print("\n--- 6. Unauthorized Download (Buyer 2, no purchase) ---")
    try:
        res = client2.get(f"/api/ipfs/download/{ipfs_hash}")
        if res.status_code == 403:
            print(f"  [PASS] Got expected 403: {res.json().get('detail', '')}")
            passed += 1
        else:
            print(f"  [FAIL] Expected 403, got {res.status_code}: {res.text[:300]}")
            failed += 1
    except Exception as e:
        print(f"  [FAIL] Exception: {e}")
        failed += 1

    # ── Summary ──
    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed out of {passed+failed} checks")
    if failed == 0:
        print("ALL TESTS PASSED")
    else:
        print("SOME TESTS FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()
