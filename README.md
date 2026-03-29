# ModelChain v5

Decentralized AI model marketplace — Ethereum + IPFS + Python backend.

> **Security model documentation**: See [`SECURITY.md`](./SECURITY.md) for a full
> layer-by-layer breakdown of how auth, JWT, RLS, the smart contract, and IPFS
> access control interact. Required reading before deploying to production.

## Architecture

```
Browser (React 19 + React Query)
    │
    ├── MetaMask (ethers.js v6)  →  Sepolia Contract
    ├── Supabase JS              →  Supabase DB (public reads via anon key)
    └── HTTP                    →  Python Backend (FastAPI)
                                        │
                                        ├── Redis (cache + rate limit + nonce store + checkpoint)
                                        ├── Supabase (service role for all writes)
                                        ├── Pinata (IPFS upload proxy)
                                        └── Web3 event listener (blockchain → DB sync)
```

## Security Model

**The FastAPI backend is the security boundary — not Supabase RLS.**

This is an explicit architectural decision (Fix 4). Here is what that means in practice:

| Layer | Key Used | Purpose |
|---|---|---|
| Frontend reads | Anon key | Public marketplace data |
| Backend public reads | Anon key | Cached model/review reads |
| Backend authenticated writes | Service key | Reviews, purchases, user upserts |
| Backend analytics | Service key | Auth validated by FastAPI first |
| Event listener | Service key | Trusted internal process |

**Why not RLS as primary?**

The backend does not forward the user's JWT to Supabase, so Supabase cannot use
`current_setting('request.jwt.claims')` to enforce per-user policies on the backend's
queries. FastAPI validates the JWT, extracts the wallet address, and then explicitly
filters all queries by that wallet — this is the enforcement layer.

Supabase RLS policies remain in place as a **secondary defence** for any direct client
access, but they are not the primary security mechanism for backend-originated requests.

**IPFS Downloads**

Direct `ipfs.io` links are not exposed to users. All downloads go through:
```
GET /api/ipfs/download/{hash}  →  JWT required  →  purchase check  →  stream from Pinata gateway
```

## Quick Start

### 1. Frontend
```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL, VITE_API_URL
npm run dev
```

### 2. Backend
```bash
cd backend
pip install -r requirements.txt   # httpx==0.27.2 required for supabase==2.10.0
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### 3. Event Listener
```bash
cd backend
python -m app.event_listener
# Checkpoint is stored in Redis — survives restarts
```

### 4. Docker (all-in-one)
```bash
cd backend
cp .env.example .env
docker compose up
```

### 5. Smart Contracts
```bash
cd modelchain-contracts
npm install    # installs @openzeppelin/contracts
npm run compile
npm test
npm run deploy:sepolia
# Paste deployed address into src/contracts/marketplace.ts
```

### 6. Database Migrations
```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link to your project
supabase link --project-ref your-project-ref

# Apply all migrations in order
supabase db push

# Create a new migration
supabase migration new my_change_name
```

## Role System

Roles are assigned dynamically at sign-in time:

| Role | How assigned |
|---|---|
| `user` | Default for all new wallets |
| `creator` | Assigned when wallet has at least one listed model |
| `admin` | Wallet address in `ADMIN_WALLETS` env var |

Roles are stored in `users.role` and embedded in the JWT. The Upload page and
`/api/ipfs/upload` endpoint require `creator` or `admin` role.

## Auth Flow

1. User connects MetaMask → `WalletContext`
2. User clicks "Sign In" → `AuthContext.signIn()`
3. GET `/auth/nonce?wallet=0x...` → nonce stored in Redis (5 min TTL)
4. MetaMask signs the nonce message (no gas)
5. POST `/auth/verify` → backend recovers signer, validates, issues JWT
6. JWT stored in `localStorage`, sent as `Authorization: Bearer` on all API calls
7. Role assigned dynamically: admin > creator (has models) > user

## Environment Variables

### Frontend (`.env`)
| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_API_URL` | Backend URL (default: http://localhost:8000) |

### Backend (`backend/.env`)
| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Anon key — public reads |
| `SUPABASE_SERVICE_KEY` | **Service role key** — never expose publicly |
| `JWT_SECRET` | Random 32+ char secret (`python -c "import secrets; print(secrets.token_hex(32))"`) |
| `ALCHEMY_SEPOLIA_URL` | Alchemy RPC URL |
| `MARKETPLACE_ADDRESS` | Deployed contract address |
| `REDIS_URL` | Redis connection string |
| `PINATA_JWT` | Pinata JWT for IPFS uploads |
| `ADMIN_WALLETS` | Comma-separated admin wallet addresses |

## GitHub Secrets (CI/CD)

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `RAILWAY_TOKEN`

## What Changed in v5

### Security Model Clarity (Issue 1)
- **`SECURITY.md`** — new dedicated document with full layer-by-layer architecture diagram
  (Wallet → JWT → FastAPI guards → Supabase key strategy → Smart contract → IPFS)
- **Owner/Admin separation** explicitly documented: contract owner ≠ backend admin
- **IPFS exposure note** returned on upload response so callers know the CID is public
- **Auth model explainer** added to WalletPage UI — visible to all users
- README updated with link to SECURITY.md and production checklist

### Analytics Reliability (Issue 2)
- **Period-over-period comparison** — current 30d revenue/sales vs prior 30d, with % change
- **Purchase consistency cross-check** — detects when `models.purchases` counter diverges
  from actual purchase rows; warns in both API response and Dashboard UI
- **`actual_purchases`** field in top_models uses row count (not counter) as source of truth
- **Buyer retention** — repeat buyer count and retention rate %
- **Weekly revenue (MTD)** — current month breakdown by week
- **Revenue share %** per model in top_models table
- Dashboard UI surfaces all new metrics with period-comparison card and weekly bar chart

### Event Listener Durability (Issue 3)
- **Dead-letter queue** — failed events written to Redis list `modelchain:event_listener:dead_letter`
  (capped at 500, LIFO). Viewable in admin panel. No chain re-scan needed to inspect failures.
- **Health state** — listener writes `modelchain:event_listener:health` to Redis (60s TTL)
  so `/health` endpoint and admin panel can surface listener status in real time
- All event handlers now pass failures to dead-letter instead of silently swallowing them

### IPFS Content Exposure (Issue 4)
- Explicitly documented in SECURITY.md as a known limitation of IPFS-based systems
- Upload response includes `ipfs_exposure_note` field
- Download endpoint uses **streaming** via `httpx.stream()` — no full-file buffer in server RAM
- Mitigation strategy documented: encrypt before upload, distribute key via separate auth endpoint

### IPFS Upload Memory Handling (Issue 5)
- Upload route now streams in chunks with early size-guard (unchanged behaviour, better comments)
- Download route uses `httpx.AsyncClient.stream()` with 64 KB chunks — constant memory regardless of file size
- `HEAD` request used to read content-type before streaming body

### Owner / Withdraw Flow (Issue 6)
- **New `/api/admin/platform` endpoint** — admin-only route returning: platform earnings (from contract),
  platform fee %, contract owner address, paused state, escrow timeout, min stake, model count
- **Admin panel in WalletPage** — visible only to `role=admin` users; shows all above stats,
  event listener health, and dead-letter queue with links to Etherscan
- Role badge displayed in wallet status row
- Contract owner vs backend admin separation explained in both SECURITY.md and WalletPage UI

### Multi-layer Auth Mental Model (Issue 7)
- Auth model explainer card added to WalletPage (always visible, not just for admins)
- SECURITY.md covers all three layers: Wallet → JWT → Smart contract
- README and SECURITY.md cross-reference each other

### Analytics Depth (Issue 8)
- Period comparison, weekly chart, retention, revenue share, consistency warnings
- All new fields backward-compatible (optional in TypeScript types with `?`)

### Event Listener Production-Readiness (Issue 9)
- Dead-letter queue + health heartbeat make failures observable and actionable
- Redis checkpoint already in v4; v5 adds health TTL so stale listeners are detectable

### UX Rough Edges (Issue 10)
- Stat cards have hover lift animation
- Clickable top-model rows have proper `focus-visible` outline
- Role badge visible in wallet status row
- Consistency warnings shown as dismissible banner (not a hard error)
- `actual_purchases` shown in top models so counter drift is visible to creators

## What Changed in v4

- **Fix 1**: httpx pinned to 0.27.2 (compatible with supabase==2.10.0)
- **Fix 2**: Removed malformed `{contracts,ignition/modules}/` duplicate directory
- **Fix 3**: Role column added to users table; upload route requires creator/admin role; `deps.py` has `require_creator_or_admin` and `require_admin` guards
- **Fix 4**: Security model explicitly documented — FastAPI is the boundary, Supabase is storage. README updated accordingly
- **Fix 5**: FK constraint added: `reviews.user_address → users.wallet_address`; backend now uses `reviewer:users!user_address(...)` join alias; frontend updated to match
- **Fix 6**: Analytics endpoint uses service key with clear rationale — FastAPI validates JWT first, then queries DB by wallet
- **Fix 7**: Direct `ipfs.io` links removed from ModelDetailPage; all downloads go through authenticated `/api/ipfs/download/{hash}` endpoint with purchase verification
- **Fix 8**: `signer.getAddress()` already fixed in your version
- **Fix 9**: ProfilePage already uses `?creator=<wallet>` param correctly
- **Fix 10**: IPFS upload uses chunk streaming with size guard (already in your version)
- **Fix 11**: Event listener checkpoint stored in Redis (key: `modelchain:event_listener:checkpoint`) — survives container restarts; exponential backoff on repeated errors
- **Fix 12**: Review sign-in prompt is now a proper UI element separate from the submit button — `review-signin-prompt` CSS class, clear text, enabled sign-in button
