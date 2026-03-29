import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
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
const LandingPage     = lazy(() => import("./pages/LandingPage"));
const DashboardPage   = lazy(() => import("./pages/DashboardPage"));
const UploadPage      = lazy(() => import("./pages/UploadPage"));
const WalletPage      = lazy(() => import("./pages/WalletPage"));
const ProfilePage     = lazy(() => import("./pages/ProfilePage"));
const ModelDetailPage = lazy(() => import("./pages/ModelDetailPage"));
const InsightsPage    = lazy(() => import("./pages/InsightsPage"));
const NotFoundPage    = lazy(() => import("./pages/NotFoundPage"));

function usePageTitle() {
  const location = useLocation();
  useEffect(() => {
    const titles: Record<string, string> = {
      "/":            "ModelChain — Decentralized AI Marketplace",
      "/marketplace": "Marketplace — ModelChain",
      "/dashboard":   "Dashboard — ModelChain",
      "/upload":      "Deploy Model — ModelChain",
      "/wallet":      "Neural Vault — ModelChain",
      "/profile":     "Profile — ModelChain",
      "/insights":    "Telemetry — ModelChain",
    };
    // Model detail pages use a dynamic title — set a sensible default
    const title = titles[location.pathname]
      ?? (location.pathname.startsWith("/model/")
        ? "Model Detail — ModelChain"
        : "ModelChain");
    document.title = title;
  }, [location.pathname]);
}

/** Skeleton shown while a lazy chunk is downloading. */
function PageSkeleton() {
  return (
    <div className="p-10 mt-10">
      <div className="skeleton h-8 w-56 mb-8 rounded-lg" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="skeleton h-64 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Wrap each lazy route in its OWN Suspense — only the switching page
 * shows a skeleton; the nav and footer are never suspended.
 */
function S({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  usePageTitle();
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <AuthProvider>
          {/* Noise grain overlay */}
          <div className="grain" aria-hidden="true" />

          {/* Ambient glow blobs */}
          <div
            className="glow-blob"
            style={{ width: 600, height: 600, background: "rgba(189,157,255,0.07)", top: -200, right: -200 }}
            aria-hidden="true"
          />
          <div
            className="glow-blob"
            style={{ width: 500, height: 500, background: "rgba(0,238,211,0.05)", bottom: 50, left: -150 }}
            aria-hidden="true"
          />

          {/* Navigation shell */}
          <Sidebar />

          {/* Main content */}
          <main className="relative z-10">
            <Routes>
              <Route path="/"          element={<S><LandingPage /></S>} />
              <Route path="/marketplace" element={<MarketplacePage />} />
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
        </AuthProvider>
      </WalletProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
