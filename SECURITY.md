# ModelChain Security Model

## TL;DR

> **FastAPI is the security boundary. Supabase RLS is a secondary defence.**

---

## Layer-by-Layer Breakdown

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Identity: MetaMask wallet signature                       │
│  - User proves ownership of wallet via personal_sign (no gas)        │
│  - Nonce is single-use, stored in Redis with 5-minute TTL            │
│  - Replay attacks impossible (nonce consumed on verification)        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│  LAYER 2 — Session: FastAPI JWT (HS256, configurable expiry)         │
│  - Issued only after successful wallet signature verification         │
│  - Contains: { wallet, wallet_address, role, exp, iat }              │
│  - JWT_SECRET must be ≥32 chars — validated at startup               │
│  - Validated on every authenticated API call by FastAPI              │
│  - Wallet address is ALWAYS extracted from the JWT, never from       │
│    query params or request body — callers cannot spoof identity       │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│  LAYER 3 — Authorisation: FastAPI route guards                       │
│  - get_current_wallet()         → any authenticated wallet           │
│  - require_creator_or_admin()   → role in {creator, admin}           │
│  - require_admin()              → role == admin                       │
│  - All ownership checks done in Python before any DB write           │
│  - Purchase verification is done in FastAPI before review insert     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│  LAYER 4 — Storage: Supabase (RLS as secondary defence)              │
│                                                                       │
│  Key used depends on operation:                                       │
│  ┌─────────────────────────┬──────────────────┬────────────────────┐ │
│  │ Operation               │ Key              │ Reason             │ │
│  ├─────────────────────────┼──────────────────┼────────────────────┤ │
│  │ Public model reads      │ anon key         │ RLS enforced       │ │
│  │ Public review reads     │ anon key         │ RLS enforced       │ │
│  │ Backend writes (any)    │ service key      │ FastAPI validates  │ │
│  │ Backend analytics       │ service key      │ FastAPI filters by │ │
│  │                         │                  │ wallet from JWT    │ │
│  │ Event listener          │ service key      │ Trusted process    │ │
│  └─────────────────────────┴──────────────────┴────────────────────┘ │
│                                                                       │
│  ⚠ The backend does NOT forward the user's JWT to Supabase.           │
│    Therefore Supabase cannot enforce per-user RLS on backend queries. │
│    FastAPI is the enforcement layer; RLS guards only direct client    │
│    access (e.g. if someone calls Supabase directly with the anon key).│
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│  LAYER 5 — Funds: Smart contract (Solidity, on-chain)                │
│  - ETH payments go directly to the contract, never through backend   │
│  - Escrow holds funds until buyer confirms or 7-day timeout elapses  │
│  - Earnings accumulate in contract mapping; withdrawn via MetaMask   │
│  - Owner (deployer wallet) can: pause, slash nodes, refund escrow,   │
│    withdraw platform fees                                            │
│  - ReentrancyGuard on all ETH-moving functions                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What This Means In Practice

### ✅ What IS protected by FastAPI

| Endpoint | Protection |
|---|---|
| `POST /api/ipfs/upload` | JWT required + creator/admin role |
| `GET /api/ipfs/download/{hash}` | JWT required + purchase or creator check in Python |
| `POST /api/models/{id}/reviews` | JWT required + purchase verification in Python |
| `GET /api/analytics/dashboard` | JWT required + wallet scoped to JWT claim in Python |
| `POST /auth/nonce` | Rate limited (10/min per IP) |
| `POST /auth/verify` | Rate limited (5/min per IP) |

### ⚠ What is NOT protected and why that's acceptable

| Item | Status | Reason |
|---|---|---|
| `GET /api/models` | Public, no auth | Marketplace listings are public |
| `GET /api/models/{id}/reviews` | Public, no auth | Reviews are public |
| IPFS CID exposure | Known limitation | IPFS is a public network; the CID itself is not a secret. The backend gateway is the recommended download path. Anyone who knows the CID can access it directly via public IPFS gateways. Protect sensitive models via licence enforcement, not IPFS obscurity. |

---

## Owner / Admin Separation

| Actor | Capabilities |
|---|---|
| **Contract Owner** (deployer wallet) | Pause contract, set platform fee, slash nodes, refund escrows, withdraw platform fees |
| **Backend Admin** (`ADMIN_WALLETS` env var) | Upload models (creator rights), bypass creator role check |
| **Creator** | Upload models, manage own listings, withdraw own earnings |
| **User** | Browse, purchase, review (after purchase), confirm delivery |

> The contract owner and backend admin are **independent**. The backend admin wallet
> does not automatically have smart contract owner privileges, and vice versa.
> In production, set `ADMIN_WALLETS` to your ops wallet address(es).

---

## IPFS Content Access

This is a known limitation of all IPFS-based systems:

- IPFS CIDs are content-addressed and **globally public**
- Anyone who obtains a CID can retrieve the file via any public IPFS gateway
- The backend download proxy (`/api/ipfs/download/{hash}`) **verifies purchase before serving** but cannot prevent access via raw gateways
- **Mitigation strategy**: Do not store plaintext model weights for high-value proprietary models on IPFS without encryption. Consider encrypting the file before upload and distributing the decryption key only to verified purchasers via a separate authenticated endpoint.

---

## Security Checklist for Production

- [ ] `JWT_SECRET` is ≥32 random chars (use `python -c "import secrets; print(secrets.token_hex(32))"`)
- [ ] `SUPABASE_SERVICE_KEY` is the `service_role` key, NOT the anon key
- [ ] `ALLOWED_ORIGINS` contains only `https://` origins (no `http://` in production)
- [ ] `ADMIN_WALLETS` is set to your deployer/ops wallet address
- [ ] Redis is not publicly accessible (use a private network or password)
- [ ] Pinata JWT is not committed to source control
- [ ] Contract is deployed and `MARKETPLACE_ADDRESS` is set (not the zero address)
- [ ] Run `settings.validate_security()` on startup (already enforced in `main.py`)
