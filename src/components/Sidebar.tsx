import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

const NAV_LINKS = [
  { href: "/", label: "Marketplace", icon: "⬡" },
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/upload", label: "Upload", icon: "⊕" },
  { href: "/wallet", label: "Wallet", icon: "◎" },
  { href: "/profile", label: "Profile", icon: "◉" },
];

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Sidebar() {
  const location = useLocation();
  const { address, connect, isConnecting } = useWallet();

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="logo-block">
          <span className="logo-glyph">⬡</span>
          <span className="logo-text">ModelChain</span>
        </div>

        <nav className="nav-links">
          {NAV_LINKS.map((link) => {
            const isActive = location.pathname === link.href;
            return (
              <Link
                key={link.href}
                to={link.href}
                className={`nav-link ${isActive ? "nav-link--active" : ""}`}
              >
                <span className="nav-icon">{link.icon}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-bottom">
        {address ? (
          <div className="wallet-chip wallet-chip--connected">
            <span className="wallet-dot" />
            <span className="wallet-addr">{shortAddress(address)}</span>
          </div>
        ) : (
          <button
            className="wallet-chip wallet-chip--disconnected"
            onClick={connect}
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
        <p className="sidebar-network">Sepolia Testnet</p>
      </div>
    </aside>
  );
}
