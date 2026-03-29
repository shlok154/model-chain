import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { queryClient } from "./lib/queryClient";
import { api, API_BASE } from "./lib/api";

// ── Prefetch the first page of marketplace models ──────────────────────────
// This fires immediately when the JS bundle loads — before React even mounts.
// By the time the user sees the Marketplace page, the data is already in cache.
queryClient.prefetchQuery({
  queryKey: ["models", "list", { page: 0, limit: 20, sort_by: "created_at", order: "desc" }],
  queryFn: () =>
    api.get<{ data: any[]; total: number }>(
      `${API_BASE}/api/models?page=0&limit=20&sort_by=created_at&order=desc`
    ).catch(() => null),
  staleTime: 30_000,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
