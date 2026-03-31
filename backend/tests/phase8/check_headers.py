import httpx, json
from eth_account import Account
from eth_account.messages import encode_defunct

BASE_URL = "http://127.0.0.1:8000"
PRIV_KEY = "fe9834c7f0be84a447327325274d3d284eb47fbed77e354ba0d6df3278afe4b48"

acct = Account.from_key(PRIV_KEY)
with httpx.Client(base_url=BASE_URL, timeout=15) as client:
    res = client.get(f"/auth/nonce?wallet={acct.address}")
    message = res.json()["message"]
    signed = acct.sign_message(encode_defunct(text=message))
    res = client.post("/auth/verify", json={"wallet": acct.address, "signature": signed.signature.hex()})
    token = res.json()["access_token"]
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for i in range(5):
        res = client.post(f"{BASE_URL}/api/analytics/log", headers=headers, json={"event": "test"})
        print(f"Status: {res.status_code}")
        print(f"Headers: {dict(res.headers)}")
