import { useState, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./lib/queryClient";
import { WalletProvider } from "./context/WalletContext";
import { AuthProvider } from "./context/AuthContext";
import Sidebar from "./components/Sidebar";
import Footer from "./components/Footer";

// Marketplace loads eagerly (landing page — LCP target)
import MarketplacePage from "./pages/MarketplacePage";

// All other pages are lazy-loaded — each becomes a separate JS chunk so the
// initial bundle shrinks dramatically (important for LCP and mobile TTI).
const DashboardPage   = lazy(() => import("./pages/DashboardPage"));
const UploadPage      = lazy(() => import("./pages/UploadPage"));
const WalletPage      = lazy(() => import("./pages/WalletPage"));
const ProfilePage     = lazy(() => import("./pages/ProfilePage"));
const ModelDetailPage = lazy(() => import("./pages/ModelDetailPage"));
const NotFoundPage    = lazy(() => import("./pages/NotFoundPage"));

/** Shown while a lazy page chunk is being fetched. Uses existing shimmer CSS. */
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
                <Suspense fallback={<PageSkeleton />}>
                  <Routes>
                    <Route path="/"          element={<MarketplacePage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/upload"    element={<UploadPage />} />
                    <Route path="/wallet"    element={<WalletPage />} />
                    <Route path="/profile"   element={<ProfilePage />} />
                    <Route path="/model/:id" element={<ModelDetailPage />} />
                    <Route path="*"          element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
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
