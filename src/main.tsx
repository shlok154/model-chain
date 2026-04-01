import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { queryClient } from "./lib/queryClient";
import { api } from "./lib/api";

import "@rainbow-me/rainbowkit/styles.css";
import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { QueryClientProvider } from "@tanstack/react-query";

const config = getDefaultConfig({
  appName: "ModelChain",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string,
  chains: [mainnet, sepolia],
});

// ── Prefetch the first page of marketplace models ──────────────────────────
// This fires immediately when the JS bundle loads — before React even mounts.
// By the time the user sees the Marketplace page, the data is already in cache.
queryClient.prefetchQuery({
  queryKey: ["models", "list", { page: 0, limit: 20, sort_by: "created_at", order: "desc" }],
  queryFn: () =>
    api.get<{ data: any[]; total: number }>(
      "/api/models?page=0&limit=20&sort_by=created_at&order=desc"
    ).catch(() => null),
  staleTime: 30_000,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme()}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
