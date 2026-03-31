import httpx, json
from eth_account import Account
from eth_account.messages import encode_defunct

def main():
    # Read wallet.json
    for enc in ['utf-16le', 'utf-16', 'utf-8-sig', 'utf-8']:
        try:
            data = json.load(open('wallet.json', 'r', encoding=enc))
            break
        except: continue
    
    addr, key = data['address'], data['key']
    if not key.startswith("0x"): key = "0x" + key
    acct = Account.from_key(key)
    
    BASE_URL = "http://127.0.0.1:8000"
    with httpx.Client(base_url=BASE_URL, timeout=15) as client:
        # Auth
        nonce = client.get(f"/auth/nonce?wallet={addr}").json()["message"]
        sig = acct.sign_message(encode_defunct(text=nonce)).signature.hex()
        token = client.post("/auth/verify", json={"wallet": addr, "signature": sig}).json()["access_token"]
        
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        
        # Pre-check
        print(f"Sending 35 requests for {addr}...")
        results = []
        for i in range(35):
            res = client.post("/api/analytics/log", headers=headers, json={"event": "precheck"})
            results.append(res.status_code)
            if i == 29: time.sleep(0.1) # Just a tiny pause after the 30th
        
        s200 = results.count(200)
        s429 = results.count(429)
        print(f"Results: 200 x {s200}, 429 x {s429}")
        if s200 == 30 and s429 > 0:
            print("PRECHECK_PASSED")
        else:
            print("PRECHECK_FAILED")

import time
if __name__ == "__main__":
    main()
