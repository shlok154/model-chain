import { Link, useLocation } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useModels } from "../hooks/useModels";

const navLinks = [
  { href: "/marketplace", label: "Marketplace", icon: "storefront" },
  { href: "/upload",      label: "Sell",         icon: "add_box" },
  { href: "/dashboard",   label: "Dashboard",    icon: "speed" },
  { href: "https://docs.modelchain.xyz", label: "Docs", icon: "description", external: true },
];

export default function Sidebar() {
  const location   = useLocation();
  const { address, connect, isConnecting } = useWallet();

  // Data ticker uses marketplace data keyed to most popular models
  const { data } = useModels({ sort_by: "purchases", limit: 10 });
  const models   = data?.models ?? [];
  const tickerItems = models.length > 0
    ? models.map((m) => `${m.name.toUpperCase()} SOLD FOR ${m.price} ETH`)
    : ["MODELCHAIN NETWORK ACTIVE", "CONNECTING TO NODES...", "SYSTEM STATUS: OPERATIONAL"];

  const isActive = (href: string) => location.pathname === href;

  return (
    <>
      {/* ── DESKTOP NAVBAR (md+) ──────────────────────────────── */}
      <nav className="fixed top-0 left-0 w-full h-16 hidden md:flex items-center px-10 justify-between z-50 bg-slate-950/80 backdrop-blur-xl border-b border-white/10 shadow-[0_0_40px_rgba(189,157,255,0.08)]">
        {/* Logo + nav links */}
        <div className="flex items-center gap-10">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-5 h-5 bg-gradient-to-br from-primary-container to-secondary-container rotate-45 rounded-sm shadow-[0_0_12px_rgba(189,157,255,0.4)] group-hover:shadow-[0_0_20px_rgba(189,157,255,0.6)] transition-shadow" />
            <span className="font-syne font-black tracking-tighter uppercase text-xl bg-gradient-to-r from-primary-container to-secondary-container bg-clip-text text-transparent">
              MODELCHAIN
            </span>
          </Link>

          <div className="flex gap-8">
            {navLinks.map((link) => (
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-label text-xs uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  to={link.href}
                  className={`font-label text-xs uppercase tracking-widest transition-colors pb-0.5 ${
                    isActive(link.href)
                      ? "text-primary border-b-2 border-primary nav-active-glow"
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  {link.label}
                </Link>
              )
            ))}
          </div>
        </div>

        {/* Wallet */}
        <div className="flex items-center gap-3">
          {address && (
            <span className="font-label text-xs border border-outline-variant/30 px-4 py-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-highest transition-colors cursor-default">
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
          )}
          <button
            onClick={connect}
            disabled={isConnecting}
            className="btn-shimmer bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold uppercase text-xs px-5 py-2 rounded-lg active:scale-95 transition-transform shadow-[0_0_15px_rgba(189,157,255,0.2)] hover:shadow-[0_0_25px_rgba(189,157,255,0.35)] disabled:opacity-50"
          >
            {isConnecting ? "CONNECTING..." : address ? "WALLET CONNECTED" : "CONNECT WALLET"}
          </button>
        </div>
      </nav>

      {/* ── MOBILE HEADER (< md) ─────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 w-full h-16 z-50 bg-slate-950/80 backdrop-blur-xl border-b border-white/10 flex items-center px-6 justify-between">
        <Link to="/" className="font-syne font-black tracking-tighter uppercase text-lg bg-gradient-to-r from-primary-container to-secondary-container bg-clip-text text-transparent">
          MODELCHAIN
        </Link>
        {address ? (
          <span className="font-label text-[10px] border border-outline-variant/30 px-3 py-1 rounded-lg text-on-surface-variant">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={isConnecting}
            className="bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold uppercase text-[10px] px-4 py-1.5 rounded-lg active:scale-95 transition-transform"
          >
            {isConnecting ? "..." : "CONNECT"}
          </button>
        )}
      </header>

      {/* ── MOBILE BOTTOM NAV (< md, sits above ticker) ──────── */}
      <div className="md:hidden fixed bottom-10 left-0 w-full h-16 z-40 bg-slate-950/80 backdrop-blur-md border-t border-white/5 flex items-center justify-around" style={{ zIndex: 45 }}>
        {navLinks.map((link) => {
          const active = isActive(link.href);
          return link.external ? (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.label}
              className="flex flex-col items-center gap-1 flex-1 py-2 text-on-surface-variant active:scale-90 transition-transform duration-150"
            >
              <span className="material-symbols-outlined text-xl">{link.icon}</span>
              <span className="font-label text-[10px] uppercase tracking-widest">{link.label}</span>
            </a>
          ) : (
            <Link
              key={link.href}
              to={link.href}
              aria-label={link.label}
              className={`flex flex-col items-center gap-1 flex-1 py-2 transition-all duration-150 active:scale-90 ${
                active ? "text-secondary bg-secondary/10 rounded-xl px-3" : "text-on-surface-variant"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{link.icon}</span>
              <span className="font-label text-[10px] uppercase tracking-widest">{link.label}</span>
            </Link>
          );
        })}
      </div>

      {/* ── DATA TICKER (fixed bottom-0, all breakpoints) ─────── */}
      <div className="fixed bottom-0 left-0 w-full h-10 bg-black border-t border-secondary/20 flex items-center overflow-hidden z-50">
        <div className="whitespace-nowrap flex animate-marquee will-change-transform">
          {[...tickerItems, ...tickerItems].map((item, i) => (
            <span
              key={i}
              className="mx-10 font-label text-[10px] uppercase tracking-widest text-secondary/80 flex items-center gap-2 flex-shrink-0"
              style={{ minWidth: "200px" }}
            >
              <span className="w-1 h-1 rounded-full bg-secondary inline-block" />
              {item}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
