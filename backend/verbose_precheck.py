import httpx, json, os, time, subprocess
from eth_account import Account
from eth_account.messages import encode_defunct

# KEY AND ADDR HARDCODED FOR CLEANLINESS (internal only)
PRIV_KEY = "REDACTED"
ADDR = "0x55eF00109A77e05fedFf51241945f2b376438065"

def main():
    BASE_URL = "http://127.0.0.1:8000"
    acct = Account.from_key(PRIV_KEY)
    
    with httpx.Client(base_url=BASE_URL, timeout=20) as client:
        # Auth
        try:
            non_res = client.get(f"{BASE_URL}/auth/nonce?wallet={acct.address}")
            nonce = non_res.json()["message"]
            sig = acct.sign_message(encode_defunct(text=nonce)).signature.hex()
            tok_res = client.post(f"{BASE_URL}/auth/verify", json={"wallet": acct.address, "signature": sig})
            token = tok_res.json()["access_token"]
            print(f"DEBUG: Auth Success. Wallet: {acct.address}")
        except Exception as e:
            print(f"FAIL: Auth failed: {e}")
            return
            
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        
        # 1. Flush Redis rl:* keys BEFORE running
        subprocess.run(["docker", "compose", "exec", "-T", "redis", "sh", "-c", "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli DEL"], capture_output=True)
        print("DEBUG: Redis rl:* keys flushed.")
        
        # 2. Try exactly ONE request and show details
        res = client.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "precheck_single"})
        print(f"DEBUG: Single Request Status: {res.status_code}")
        print(f"DEBUG: Single Request Body: {res.text}")
        print(f"DEBUG: Single Request Headers: {dict(res.headers)}")
        
        if res.status_code != 200:
             return

        # 3. Run full pre-check
        print("[CHECK] Running full 35-request pre-check...")
        codes = [res.status_code] # first one is already done
        for _ in range(34):
            r = client.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "precheck"})
            codes.append(r.status_code)
            
        s200 = codes.count(200)
        s429 = codes.count(429)
        print(f"Results: 200 x {s200}, 429 x {s429}")
        if s200 == 30 and s429 > 0:
            print("PRECHECK_PASSED")
        else:
            print(f"PRECHECK_FAILED (Status counts: {dict((x, codes.count(x)) for x in set(codes))})")

if __name__ == "__main__":
    main()
