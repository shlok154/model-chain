import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";

interface NavLink {
  href: string;
  label: string;
  icon: string;
  /** If set, only these roles may see this link. Unauthenticated users never see gated links. */
  roles?: string[];
}

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Marketplace", icon: "⬡" },
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/upload", label: "Upload", icon: "⊕", roles: ["creator", "admin"] },
  { href: "/wallet", label: "Wallet", icon: "◎" },
  { href: "/profile", label: "Profile", icon: "◉" },
];

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { address, connect, isConnecting } = useWallet();
  const { role, isAuthenticated } = useAuth();

  const visibleLinks = NAV_LINKS.filter((link) => {
    if (!link.roles) return true; // no gate → always visible
    if (!isAuthenticated || !role) return false;
    return link.roles.includes(role);
  });

  return (
    <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
      <div className="sidebar-top">
        <div className="logo-block">
          <span className="logo-glyph">⬡</span>
          <span className="logo-text">ModelChain</span>
          <button className="sidebar-close" onClick={onClose} aria-label="Close menu">✕</button>
        </div>

        <nav className="nav-links">
          {visibleLinks.map((link) => {
            const isActive = location.pathname === link.href;
            return (
              <Link
                key={link.href}
                to={link.href}
                onClick={onClose}
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
