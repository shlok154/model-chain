# ModelChain — Web3 AI Marketplace (React + TypeScript + Vite)

This project provides a modern full-stack setup for building a **decentralized AI model marketplace** using React, TypeScript, and Web3 integrations.

It includes a clean frontend architecture with fast development using Vite, along with Supabase and blockchain interaction via Ethers.js.

---

## ⚡ Tech Stack

- **Frontend:** React + TypeScript + Vite  
- **Styling:** Tailwind CSS  
- **Backend Services:** Supabase (Auth + Database)  
- **Web3:** Ethers.js (Smart contract interaction)  
- **Linting:** ESLint  

---

## 🚀 Features

- Fast development with **Vite + HMR**
- Type-safe code with **TypeScript**
- Scalable structure (components, hooks, context)
- Supabase integration for backend services
- Web3-ready architecture for blockchain interactions

---

## 📦 Project Setup

### Install dependencies

    npm install

### Run development server

    npm run dev

### Build for production

    npm run build

### Preview build

    npm run preview

---

## 🔐 Environment Setup

Create a `.env` file in the root:

    VITE_SUPABASE_URL=your_supabase_url
    VITE_SUPABASE_ANON_KEY=your_anon_key

---

## 📁 Project Structure

    src/
    ├── components/     # Reusable UI components
    ├── pages/          # Route-based pages
    ├── hooks/          # Custom React hooks
    ├── context/        # Global state management
    ├── lib/            # API, Supabase, Web3 configs
    ├── App.tsx
    ├── main.tsx

---

## 🔗 Web3 Integration

The project is designed to support:

- Smart contract interaction via **Ethers.js**
- Wallet integration (future scope)
- Decentralized transactions for model usage/purchase

---

## 🧠 Supabase Integration

Used for:

- Authentication  
- Database (model listings, users, etc.)  
- Row-level security (RLS)  

---

## 🛠️ ESLint Configuration

The project uses a modern ESLint setup with TypeScript support.

To enable stricter type-aware linting:

    export default defineConfig([
      {
        files: ['**/*.{ts,tsx}'],
        extends: [
          tseslint.configs.recommendedTypeChecked,
          tseslint.configs.strictTypeChecked,
        ],
        languageOptions: {
          parserOptions: {
            project: ['./tsconfig.app.json', './tsconfig.node.json'],
          },
        },
      },
    ])

---

## 🎨 Styling (Tailwind CSS)

Tailwind is configured via:

- `tailwind.config.js`
- `postcss.config.js`

You can directly use utility classes inside components.

---

## 📌 Notes

- Do not commit `.env` files  
- Ensure Supabase keys are correctly configured  
- Keep smart contract logic modular inside `/lib` or `/contracts`

---

## 🔮 Future Enhancements

- Wallet authentication (MetaMask, WalletConnect)
- On-chain payments
- Model rating & review system
- Decentralized storage (IPFS)

---

## 🤝 Contributing

1. Fork the repo  
2. Create a new branch  
3. Make changes  
4. Submit a pull request  

---

## 📄 License

MIT
