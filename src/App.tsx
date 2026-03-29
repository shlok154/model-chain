import { useState, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./lib/queryClient";
import { WalletProvider } from "./context/WalletContext";
import { AuthProvider } from "./context/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import Footer from "./components/Footer";

// Marketplace loads eagerly (landing page — LCP target)
import MarketplacePage from "./pages/MarketplacePage";

// All other pages are lazy-loaded — each becomes a separate JS chunk.
const DashboardPage   = lazy(() => import("./pages/DashboardPage"));
const UploadPage      = lazy(() => import("./pages/UploadPage"));
const WalletPage      = lazy(() => import("./pages/WalletPage"));
const ProfilePage     = lazy(() => import("./pages/ProfilePage"));
const ModelDetailPage = lazy(() => import("./pages/ModelDetailPage"));
const InsightsPage    = lazy(() => import("./pages/InsightsPage"));
const NotFoundPage    = lazy(() => import("./pages/NotFoundPage"));

/** Inline skeleton shown while a lazy page chunk is downloading. */
function PageSkeleton() {
  return (
    <div className="page" style={{ paddingTop: 40 }}>
      <div
        className="model-card--skeleton"
        style={{ height: 32, width: 220, marginBottom: 32, borderRadius: 8 }}
      />
      <div className="loading-grid">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="model-card model-card--skeleton" />
        ))}
      </div>
    </div>
  );
}

/**
 * Wrap each lazy route in its OWN Suspense so only the switching page
 * shows a skeleton — the sidebar, header, and footer are never suspended.
 * A single global Suspense around <Routes> would blank the whole shell.
 */
function S({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <AuthProvider>
          <div className="app-shell">
            {sidebarOpen && (
              <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
            )}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <div className="app-content">
              <header className="mobile-header">
                <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
                  <span /><span /><span />
                </button>
                <span className="mobile-logo">⬡ ModelChain</span>
              </header>
              <main className="app-main">
                {/* Each lazy route has its own Suspense boundary so only the
                    transitioning page suspends — never the whole shell. */}
                <Routes>
                  <Route path="/"          element={<MarketplacePage />} />
                  <Route path="/dashboard" element={<S><DashboardPage /></S>} />
                  <Route path="/upload"    element={<S><UploadPage /></S>} />
                  <Route path="/wallet"    element={<S><WalletPage /></S>} />
                  <Route path="/profile"   element={<S><ProfilePage /></S>} />
                  <Route path="/model/:id" element={<S><ModelDetailPage /></S>} />
                  <Route path="/insights"  element={<S><InsightsPage /></S>} />
                  <Route path="*"          element={<S><NotFoundPage /></S>} />
                </Routes>
              </main>
              <Footer />
            </div>
          </div>
        </AuthProvider>
      </WalletProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
