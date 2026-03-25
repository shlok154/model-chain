import { Routes, Route } from "react-router-dom";
import { WalletProvider } from "./context/WalletContext";
import Sidebar from "./components/Sidebar";
import MarketplacePage from "./pages/MarketplacePage";
import DashboardPage from "./pages/DashboardPage";
import UploadPage from "./pages/UploadPage";
import WalletPage from "./pages/WalletPage";
import ProfilePage from "./pages/ProfilePage";
import ModelDetailPage from "./pages/ModelDetailPage";

export default function App() {
  return (
    <WalletProvider>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<MarketplacePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/model/:id" element={<ModelDetailPage />} />
          </Routes>
        </main>
      </div>
    </WalletProvider>
  );
}
