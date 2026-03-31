import json, os, httpx, time, subprocess
from eth_account import Account
from eth_account.messages import encode_defunct

def redis_cmd(*args):
    res = subprocess.run(["docker", "compose", "exec", "-T", "redis", "redis-cli"] + list(args), capture_output=True, text=True)
    return res.stdout.strip()

def main():
    # 1. Read wallet.json (robust)
    data = None
    for enc in ['utf-16le', 'utf-16', 'utf-8-sig', 'utf-8']:
        try:
            with open('wallet.json', 'r', encoding=enc) as f:
                data = json.load(f)
                if data: break
        except: continue
    
    if not data:
        print("FAIL: Could not read wallet.json")
        return

    addr, key = data['address'], data['key']
    if not key.startswith("0x"): key = "0x" + key

    # 2. Auth
    BASE_URL = "http://127.0.0.1:8000"
    acct = Account.from_key(key)
    with httpx.Client(base_url=BASE_URL, timeout=20) as client:
        try:
            non_res = client.get(f"{BASE_URL}/auth/nonce?wallet={acct.address}")
            nonce = non_res.json()["message"]
            sig = acct.sign_message(encode_defunct(text=nonce)).signature.hex()
            tok_res = client.post(f"{BASE_URL}/auth/verify", json={"wallet": acct.address, "signature": sig})
            token = tok_res.json()["access_token"]
        except Exception as e:
            print(f"FAIL: Auth failed: {e}")
            return
        
        # 3. Rate Limit Pre-Check
        print("[CHECK] Rate limits...")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        codes = []
        for _ in range(35):
            res = client.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "precheck"})
            codes.append(res.status_code)
        
        if not (codes.count(200) == 30 and codes.count(429) > 0):
            print(f"FAIL: Rate limit pre-check failed. Got {codes.count(200)} x 200, {codes.count(429)} x 429.")
            return
        print("  Pass: 30 successes then throttled.")
        
        # 4. Job Submission
        print("[STEP 1] Submitting 10 telemetry jobs...")
        redis_cmd("DEL", "metrics:jobs_processed", "metrics:jobs_failed", "metrics:retry_count", "modelchain:event_listener:dead_letter")
        for i in range(1, 11):
            client.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "failure_test", "wallet": f"0xtest{i}"})
            time.sleep(0.05)
        
        print("  Waiting 15s for failures...")
        time.sleep(15)
        
        # 5. Verify Dead Letter
        dl_len = redis_cmd("LLEN", "modelchain:event_listener:dead_letter")
        if dl_len != "10":
            print(f"FAIL: DLQ length expected 10, got {dl_len}")
            return
        print("  Pass: Exactly 10 jobs in dead_letter.")
        
        # 6. Replay
        print("[STEP 2] Replaying jobs...")
        rep_res = client.post(f"{BASE_URL}/api/admin/replay-dead-letter", headers=headers, json={"limit": 10})
        if rep_res.status_code != 200:
            print(f"FAIL: Replay request failed: {rep_res.status_code} {rep_res.text}")
            return
        
        print("  Waiting 5s for replayed jobs...")
        time.sleep(5)
        
        # 7. Final Verification
        processed = redis_cmd("GET", "metrics:jobs_processed") or "0"
        dl_final = redis_cmd("LLEN", "modelchain:event_listener:dead_letter") or "0"
        
        if dl_final == "0" and int(processed) >= 10:
            print(f"PHASE_8_PASSED: {processed} jobs processed, DLQ cleared.")
        else:
            print(f"FAIL: Processed={processed}, DLQ={dl_final}")

if __name__ == "__main__":
    main()
