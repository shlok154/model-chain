import json
import os

# Robust JSON read
data = None
for enc in ['utf-16', 'utf-16le', 'utf-8-sig', 'utf-8']:
    try:
        with open('wallet.json', 'r', encoding=enc) as f:
            data = json.load(f)
            if data: break
    except:
        continue

if not data:
    print("FAILED_TO_READ_WALLET_JSON")
    exit(1)

address = data['address']
key = data['key']

# Update .env
if os.path.exists('.env'):
    with open('.env', 'r', encoding='utf-8') as f:
        lines = f.readlines()
    with open('.env', 'w', encoding='utf-8') as f:
        for l in lines:
            if l.startswith('ADMIN_WALLETS='):
                f.write(f'ADMIN_WALLETS={address}\n')
            else:
                f.write(l)

# Update phase8_test_runner.py
template = r'''"""
Phase 8 — Retry Correctness and Dead-Letter Behavior
"""
import httpx, json, os, sys, time, subprocess
from eth_account import Account
from eth_account.messages import encode_defunct

BASE_URL = "http://127.0.0.1:8000"
PRIV_KEY = "{KEY}"
ADMIN_ADDR = "{ADDR}"

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
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    codes = []
    for _ in range(35):
        try:
            res = httpx.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "test"}, timeout=10)
            codes.append(res.status_code)
        except:
            codes.append(500)
    return codes.count(200) == 30 and codes.count(429) > 0

def submit_jobs(token):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for i in range(1, 11):
        httpx.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "failure_test", "wallet": f"0xtest{i}"})
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

def main():
    token = get_admin_jwt()
    if not pre_check_rate_limit(token): print("RATE_LIMIT_CHECK_FAILED"); return
    redis_cmd("DEL", "metrics:jobs_processed", "metrics:jobs_failed", "metrics:retry_count", "modelchain:event_listener:dead_letter")
    submit_jobs(token)
    time.sleep(15) 
    if not verify_dead_letter(): print("DEAD_LETTER_VERIFICATION_FAILED"); return
    if not trigger_replay(token): print("REPLAY_FAILED"); return
    time.sleep(5)
    if verify_final(): print("PHASE_8_PASSED")
    else: print("PHASE_8_FAILED")

if __name__ == "__main__": main()
'''

with open('phase8_test_runner.py', 'w', encoding='utf-8') as f:
    f.write(template.replace("{KEY}", key).replace("{ADDR}", address))

print(f"READY:{address}")
