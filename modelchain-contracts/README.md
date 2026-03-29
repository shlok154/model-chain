# ModelChain Contracts

Hardhat project for deploying the ModelChain marketplace contract to Sepolia testnet.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Get an Alchemy RPC URL
1. Go to https://alchemy.com and create a free account
2. Create a new app → Ethereum → Sepolia
3. Copy the HTTPS URL

### 3. Get your MetaMask private key
1. Open MetaMask → click the three dots → Account Details
2. Click "Show private key" → enter your password
3. Copy the key (without the 0x prefix)

### 4. Get Sepolia test ETH
- https://sepoliafaucet.com  (requires Alchemy account)
- https://faucet.quicknode.com/ethereum/sepolia

### 5. Create your .env file
```bash
cp .env.example .env
```
Then fill in your `ALCHEMY_SEPOLIA_URL` and `PRIVATE_KEY`.

### 6. Compile
```bash
npm run compile
```

### 7. Deploy to Sepolia
```bash
npm run deploy:sepolia
```

You will see output like:
```
Deployed Addresses:
MarketplaceModule#ModelChainMarketplace - 0x4a7b3c9f...
```

### 8. Paste the address into your React app
Open `src/contracts/marketplace.ts` in your React project and replace:
```ts
export const MARKETPLACE_ADDRESS = "0x0000000000000000000000000000000000000000";
```
with:
```ts
export const MARKETPLACE_ADDRESS = "0x4a7b3c9f..."; // your deployed address
```

Your app is now fully on-chain!

## Verify on Etherscan (optional)
```bash
npx hardhat verify --network sepolia YOUR_CONTRACT_ADDRESS
```
