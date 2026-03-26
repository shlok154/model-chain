# ModelChain

A decentralized marketplace for buying, selling, and licensing AI models on Ethereum. Model ownership is tracked on-chain, files are stored on IPFS, and creator profiles are managed through Supabase.

![ModelChain](https://img.shields.io/badge/Network-Sepolia-6f3ff5) ![License](https://img.shields.io/badge/License-MIT-00e5c3) ![React](https://img.shields.io/badge/React-19-61dafb) ![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636)

---

## What it does

- **Browse** AI models listed by creators across categories — NLP, Computer Vision, LLM, Audio, Tabular, Generative
- **Purchase** models with ETH — ownership is recorded on-chain instantly
- **List your own models** with custom pricing, royalties, and IPFS-hosted weights
- **Withdraw earnings** directly to your wallet
- **Creator profiles** with bio, social links, and model portfolio stored in Supabase

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Blockchain | Ethereum (Sepolia), Solidity 0.8.20, ethers.js v6 |
| Database | Supabase (PostgreSQL) |
| Storage | IPFS (via Pinata or web3.storage) |
| Wallet | MetaMask |

---

## Smart Contract

Deployed on Sepolia testnet:

```
0x3131f5ea556cbeBe3A09F3AB42EDb8F3C630240D
```

The contract handles:
- Listing models with price, IPFS hash, royalty %
- Purchasing models with ETH — access granted on-chain
- Withdrawing creator earnings
- Checking ownership / access per wallet

---

## Project Structure

```
src/
├── components/        # Sidebar, Footer, TxBadge
├── context/           # WalletContext — MetaMask connection & state
├── contracts/         # ABI + deployed contract address
├── hooks/             # useMarketplace, useProfile, useEthPrice, useDashboardStats
├── lib/               # Supabase client
├── pages/             # Marketplace, Dashboard, Upload, Wallet, Profile, ModelDetail
└── types/             # Shared TypeScript interfaces
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MetaMask browser extension
- Supabase account (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/yourusername/modelchain.git
cd modelchain
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase/schema.sql`
3. Go to **Settings → API** and copy your URL and anon key

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and connect MetaMask on **Sepolia testnet**.

---

## Deploying the Contract

The Hardhat project is in `modelchain-contracts/`. See its [README](modelchain-contracts/README.md) for full instructions.

```bash
cd modelchain-contracts
npm install
npm run compile
npm run deploy:sepolia
```

Paste the deployed address into `src/contracts/marketplace.ts`.

---

## Deploying the Frontend

### Vercel (recommended)

```bash
npm run build
npx vercel
```

Add your environment variables in **Vercel Dashboard → Settings → Environment Variables**:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

### Manual build

```bash
npm run build
# output is in dist/
```

---

## How it works

```
User connects MetaMask
        ↓
Browses models (fetched from Supabase)
        ↓
Clicks Purchase → ethers.js sends ETH to contract
        ↓
Contract records ownership on-chain
        ↓
User gets access to IPFS model download
        ↓
Creator earnings accumulate in contract
        ↓
Creator withdraws ETH to their wallet
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

---

## License

MIT — see [LICENSE](LICENSE)

---

## Disclaimer

Use at your own risk. This project is for educational and demonstration purposes. Smart contract interactions on mainnet involve real funds — always audit contracts before use with real ETH. Not financial advice.
