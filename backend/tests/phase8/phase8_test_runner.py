"""
Phase 8 — Retry Correctness and Dead-Letter Behavior
"""
import httpx, json, os, sys, time, subprocess
from eth_account import Account
from eth_account.messages import encode_defunct

BASE_URL = "http://127.0.0.1:8000"
PRIV_KEY = os.getenv("TEST_ADMIN_PRIVATE_KEY", "")
if not PRIV_KEY:
    raise EnvironmentError("Set TEST_ADMIN_PRIVATE_KEY env var to run this test")
ADMIN_ADDR = "0x55eF00109A77e05fedFf51241945f2b376438065"

def redis_cmd(*args):
    result = subprocess.run(["docker", "compose", "exec", "-T", "redis", "redis-cli"] + list(args), capture_output=True, text=True)
    return result.stdout.strip()

def get_admin_jwt():
    acct = Account.from_key(PRIV_KEY)
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        res = client.get(f"/auth/nonce?wallet={acct.address}")
        message = res.json()["message"]
        signed = acct.sign_message(encode_defunct(text=message))
        res = client.post("/auth/verify", json={"wallet": acct.address, "signature": signed.signature.hex()})
        return res.json()["access_token"]

def pre_check_rate_limit(token):
    print("\n[PRE-CHECK] Verifying rate limits...")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    codes = []
    for i in range(35):
        try:
            res = httpx.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "precheck", "session_id": "test_session"}, timeout=10)
            codes.append(res.status_code)
        except Exception as e:
            print(f"DEBUG: Request {i} failed: {e}")
            codes.append(500)
            
    s200 = codes.count(200)
    s429 = codes.count(429)
    print(f"    Results: 200 x {s200}, 429 x {s429}")
    
    if s200 == 30 and s429 > 0:
        print("✅ RATE_LIMIT_CHECK_PASSED")
        return True
    else:
        print(f"❌ RATE_LIMIT_CHECK_FAILED (Expected 30x200, got {s200})")
        return False

def submit_jobs(token):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for i in range(1, 11):
        httpx.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "failure_test", "wallet": f"0xtest{i}", "session_id": f"sess_{i}"})
        time.sleep(0.1)

def verify_dead_letter():
    dl_len = redis_cmd("LLEN", "modelchain:event_listener:dead_letter") or "0"
    return dl_len == "10"

def trigger_replay(token):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    return httpx.post(f"{BASE_URL}/api/admin/replay-dead-letter", headers=headers, json={"limit": 10}).status_code == 200

def verify_final():
    processed = int(redis_cmd("GET", "metrics:jobs_processed") or "0")
    dl_len = int(redis_cmd("LLEN", "modelchain:event_listener:dead_letter") or "0")
    return dl_len == 0 and processed >= 10

def reset_rate_limits():
    print("[INFO] Resetting rate limits in Redis...")
    subprocess.run(["docker", "compose", "exec", "-T", "redis", "sh", "-c", "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli DEL"], capture_output=True)

def main():
    token = get_admin_jwt()
    
    # 1. Pre-check
    if not pre_check_rate_limit(token): 
        print("RATE_LIMIT_CHECK_FAILED")
        return
        
    # 2. Reset everything for clean failure test
    reset_rate_limits()
    redis_cmd("DEL", "metrics:jobs_processed", "metrics:jobs_failed", "metrics:retry_count", "modelchain:event_listener:dead_letter")
    
    print("\n[STEP 1] Submitting 10 jobs for failure simulation...")
    submit_jobs(token)
    
    print("[INFO] Waiting for jobs to hit Dead Letter Queue (max retries reached)...")
    # Wait for retries to complete. Each retry might have a small delay or loop cycle.
    # Total of 3 attempts per job.
    for _ in range(30):
        time.sleep(1)
        if verify_dead_letter():
            print("✅ Jobs reached Dead Letter Queue")
            break
    else:
        dl_len = redis_cmd("LLEN", "modelchain:event_listener:dead_letter") or "0"
        print(f"❌ DEAD_LETTER_VERIFICATION_FAILED (DLQ size: {dl_len})")
        return

    print("\n[STEP 2] Preparing for Replay...")
    print("!!! MANUAL ACTION REQUIRED: Restart worker in NORMAL mode (no failure simulation) now !!!")
    print("Wait for 'REPLAY_READY' signal...")
    
    # In a real automated test we'd restart the container here, 
    # but since I'm driving, I'll stop the script here or just wait.
    # Actually, I'll just split the script or add a prompt.
    
    input("After restarting worker, press Enter to continue replay...")
    
    reset_rate_limits() # Ensure replay API isn't throttled
    if not trigger_replay(token): 
        print("❌ REPLAY_FAILED")
        return
        
    print("[INFO] Waiting for replayed jobs to process...")
    time.sleep(10)
    
    if verify_final():
        print("\n✅ PHASE_8_PASSED")
    else:
        processed = redis_cmd("GET", "metrics:jobs_processed") or "0"
        dl_len = redis_cmd("LLEN", "modelchain:event_listener:dead_letter") or "0"
        print(f"❌ PHASE_8_FAILED (Processed: {processed}, DLQ: {dl_len})")

if __name__ == "__main__":
    main()
