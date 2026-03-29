import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "./lib/queryClient";
import { WalletProvider } from "./context/WalletContext";
import { AuthProvider } from "./context/AuthContext";
import Sidebar from "./components/Sidebar";
import Footer from "./components/Footer";
import MarketplacePage from "./pages/MarketplacePage";
import DashboardPage from "./pages/DashboardPage";
import UploadPage from "./pages/UploadPage";
import WalletPage from "./pages/WalletPage";
import ProfilePage from "./pages/ProfilePage";
import ModelDetailPage from "./pages/ModelDetailPage";
import NotFoundPage from "./pages/NotFoundPage";

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
                <Routes>
                  <Route path="/"          element={<MarketplacePage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/upload"    element={<UploadPage />} />
                  <Route path="/wallet"    element={<WalletPage />} />
                  <Route path="/profile"   element={<ProfilePage />} />
                  <Route path="/model/:id" element={<ModelDetailPage />} />
                  <Route path="*"          element={<NotFoundPage />} />
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
