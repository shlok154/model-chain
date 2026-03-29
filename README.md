# ModelChain v7

Decentralized AI model marketplace — Ethereum + IPFS + FastAPI backend.

![Build](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Python](https://img.shields.io/badge/backend-FastAPI-green)
![React](https://img.shields.io/badge/frontend-React%20%2B%20TS-blue)
![Web3](https://img.shields.io/badge/web3-Ethereum-purple)
![IPFS](https://img.shields.io/badge/storage-IPFS-orange)
![Database](https://img.shields.io/badge/db-Supabase-lightgrey)
![Cache](https://img.shields.io/badge/cache-Redis-red)
![Stack](https://img.shields.io/badge/stack-React%20%7C%20FastAPI%20%7C%20Web3-blueviolet)
![Infra](https://img.shields.io/badge/infra-Supabase%20%7C%20Redis%20%7C%20IPFS-black)

> **Security model documentation**: See [`SECURITY.md`](./SECURITY.md) for a full
> layer-by-layer breakdown of how auth, JWT, backend enforcement, smart contracts,
> and IPFS access control interact.

---

## Architecture

![Architecture](./assets/architecture-v3.png)

```
Browser (React + React Query)
    │
    ├── MetaMask (ethers.js)  →  Smart Contract (Sepolia)
    ├── Supabase (public reads via anon key)
    └── HTTP → FastAPI Backend (Security Layer)
                        │
                        ├── Redis (nonce + cache + rate limit + checkpoint)
                        ├── Supabase (PostgreSQL, service role writes)
                        ├── IPFS (Pinata proxy, streaming)
                        ├── Web3 RPC (Alchemy fallback)
                        └── Event Listener (blockchain → DB sync)
```

---

## Security Model

**The FastAPI backend is the security boundary — not Supabase RLS.**

| Layer          | Key Used    | Purpose                 |
| -------------- | ----------- | ----------------------- |
| Frontend reads | Anon key    | Public marketplace data |
| Backend reads  | Anon key    | Cached queries          |
| Backend writes | Service key | Secure mutations        |
| Event listener | Service key | Trusted sync            |

Supabase RLS is treated as a **secondary defense**, while FastAPI enforces all
access control using JWT + wallet verification.

---

## High-Level Flow

```
User → Purchase (Blockchain)
     → Event Listener → DB (cache)

Download Request:
     → DB check (fast)
     → Blockchain fallback (truth)
     → Self-heal DB
     → Stream from IPFS
     → Log download
```

---

## Self-Healing Backend

```
DB miss detected
    ↓
Blockchain confirms ownership
    ↓
Allow access
    ↓
Auto-upsert into DB
```

Ensures **eventual consistency without blocking users**.

---

## IPFS Downloads

```
GET /api/ipfs/download/{hash}
    ↓
JWT required
    ↓
Ownership verified
    ↓
Stream from IPFS (constant memory)
```

---

## Core Components

* **Frontend:** React + TypeScript + React Query
* **Backend:** FastAPI + Python
* **Blockchain:** Solidity + Ethers.js
* **Infra:** Supabase (PostgreSQL), Redis, IPFS (Pinata)
* **Sync Layer:** Event Listener (chain → DB)

---

---

## ⚡ Performance Optimizations

- Route-based code splitting (lazy + Suspense)
- Vendor chunk splitting (React, ethers, Supabase)
- Skeleton loading for better UX
- Preconnect for external services (Alchemy, Supabase, Pinata)
- Optimized caching strategy

---

## Key Engineering Design

* Backend-enforced access control (not frontend trust)
* Blockchain as **source of truth**
* Database as **performance cache**
* Self-healing fallback mechanism
* Fault-tolerant RPC handling
* Streaming-based file delivery (no memory overload)

---

## Summary

A production-grade decentralized marketplace combining:

* **Web3 guarantees** (ownership, trust)
* **Web2 performance** (caching, UX)
* **Resilient backend systems** (self-healing, fallback logic)
