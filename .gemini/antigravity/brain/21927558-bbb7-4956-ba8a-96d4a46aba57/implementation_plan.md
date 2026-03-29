# Stabilize & Polish: Production-Grade Hardening

This plan outlines the final set of high-level improvements to ensure the Web3 marketplace is incredibly robust, accessible, and fault-tolerant in a production environment.

## User Review Required

> [!WARNING]
> I will be adding a generic log endpoint to the backend (FastAPI) to capture client-side RPC errors and failed purchases. This will simply print to the backend logs for now. Does that sound sufficient for your initial analytics tracking?

## Proposed Changes

---

### Backend Components

#### [MODIFY] [analytics.py](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/backend/app/routes/analytics.py)
- **Feature:** Client Telemetry Endpoint.
- Add a highly generic `POST /api/analytics/log` endpoint accepting an event name, error message, and context.
- This will allow the React frontend to report failed Web3 transactions (e.g. "insufficient funds", "user rejected") or RPC timeouts directly to backend standard out.

---

### Frontend Mechanics & Architecture

#### [NEW] [ErrorBoundary.tsx](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/components/ErrorBoundary.tsx)
- **Feature:** Global Crash Protection.
- Standard React class component with `getDerivedStateFromError`.
- Catches any render-cycle crashes (e.g., malformed data) instead of white-screening the whole app. Provides a clean fallback UI with a "Reload Page" button.

#### [MODIFY] [App.tsx](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/App.tsx)
- Wrap the `<Suspense>` bounded routes in the new `<ErrorBoundary>` so that a crash in any lazy-loaded page doesn't wreck the application shell (Header/Sidebar).

#### [MODIFY] [useOwnership.ts](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/hooks/useOwnership.ts)
- Add `refetchOnMount: "always"` to the ownership query. While `staleTime: 5m` prevents spamming during regular interaction, `refetchOnMount` ensures that if a user navigates away to a new session block and mounts a high-value route, it double-checks the source of truth asynchronously.

#### [MODIFY] [useMarketplace.ts](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/hooks/useMarketplace.ts)
- In the `catch` blocks for `purchaseModel`, `listModel`, and `withdraw`, asynchronously fire `api.post("/api/analytics/log")` to track real user failure rates without blocking the UI.

---

### Frontend Styling & Accessibility

#### [MODIFY] [index.css](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/index.css)
- **Micro-CLS Skeleton Fix:** Adjust `.model-card--skeleton` padding, height, and gap properties to **identically match** the loaded `.model-card` height based on the new flex constraints. 
- **Focus States:** Add explicit `:focus-visible` outlines to `button`, `a`, and `.model-card` so keyboard users can navigate intuitively.

#### [MODIFY] [MarketplacePage.tsx](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/pages/MarketplacePage.tsx) & [ModelDetailPage.tsx](file:///c:/Users/shlok/Downloads/model-chain-v7/model-chain-v6/src/pages/ModelDetailPage.tsx)
- Ensure all interactive elements have semantic `aria-labels` and `role="button"` where div-clicks are used.
- Force `onKeyDown` listeners wherever `onClick` is used on non-button elements, mapping the `Enter` key to select models. (Accessibility parity).

## Open Questions

> [!IMPORTANT]  
> Are there any specific analytics events other than failed purchases, deployments (`listModel`), and RPC timeouts that you want me to capture right away?

## Verification Plan

### Automated Tests
- I'll restart the development server and verify that React compiles cleanly with the new TypeScript ErrorBoundary.
### Manual Verification
- I will verify visually that the skeleton cards match the final card heights to prevent any micro layout shifts.
- I will simulate a failed purchase transaction and verify the network tab shows a successful POST request to the new `/api/analytics/log` telemetry endpoint.
