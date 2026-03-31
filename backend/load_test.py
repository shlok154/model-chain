import concurrent.futures
import urllib.request
import time
import json

url = "http://api:8000/api/analytics/dashboard"
token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ3YWxsZXQiOiIweGFiYzEyMyIsInN1YiI6IjB4YWJjMTIzIiwicm9sZSI6ImNyZWF0b3IiLCJpYXQiOjE3NzQ5ODI4MTZ9.ZpBrTMpzLm1HU1oT9IZtmZWDQizlIfzyegS-BVx2f3E"
headers = {"Authorization": f"Bearer {token}"}

req = urllib.request.Request(url, headers=headers)

def fetch():
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        return resp.getcode()
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:
        return str(e)

start_time = time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
    results = list(executor.map(lambda _: fetch(), range(200)))
elapsed = time.time() - start_time

codes = {}
for r in results:
    codes[r] = codes.get(r, 0) + 1

print("=== LOAD TEST RESULTS ===")
print(f"Wall-clock duration: {elapsed:.2f} seconds")
print(f"Total requests: {len(results)}")
for code, count in codes.items():
    print(f"HTTP {code}: {count}")
