import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useEthPrice } from "../hooks/useEthPrice";
import { SUPPORTED_CHAINS, MARKETPLACE_ABI, MARKETPLACE_ADDRESS } from "../contracts/marketplace";
import { supabase, isSupabaseReady } from "../lib/supabase";
import { api } from "../lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface EscrowRow {
  id: number;
  model_id: number;
  model_name: string;
  model_description?: string;
  model_category?: string;
  model_price_eth?: number;
  model_version?: string;
  model_license?: string;
  price_paid_eth: number;
  on_chain_tx: string | null;
  is_simulated?: boolean;
  purchased_at: string;
  escrow_id_onchain?: number;
  released?: boolean;
}

interface PlatformInfo {
  platform_earnings_eth: number;
  platform_fee_bps: number;
  platform_fee_pct: number;
  contract_owner: string;
  is_paused: boolean;
  model_count_onchain: number;
  escrow_timeout_hours: number;
  min_stake_eth: number;
}

interface AdminData {
  admin_wallet: string;
  contract: PlatformInfo | { error: string };
  listener_health: { status: string; block?: number; error?: string; updated_at?: number };
  dead_letter_count: number;
  dead_letters_recent: { event: string; tx_hash: string; error: string; ts: number }[];
}

// ── Purchases hook ─────────────────────────────────────────────────────────────

function useMyPurchases(address: string | null) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["purchases", address],
    queryFn: async (): Promise<EscrowRow[]> => {
      if (!address) return [];
      if (token) {
        try {
          return await api.get<EscrowRow[]>("/api/users/me/purchases", token);
        } catch { /* fall through */ }
      }
      if (isSupabaseReady()) {
        const { data } = await supabase
          .from("purchases")
          .select("id, model_id, price_paid_eth, on_chain_tx, purchased_at, models(name)")
          .eq("buyer_address", address.toLowerCase())
          .order("purchased_at", { ascending: false });
        return (data ?? []).map((row: any) => ({
          ...row,
          model_name: row.models?.name ?? `Model #${row.model_id}`,
        }));
      }
      return [];
    },
    enabled: !!address,
    staleTime: 30_000,
  });
}

// ── Confirm delivery mutation ──────────────────────────────────────────────────

function useConfirmDelivery() {
  const { provider } = useWallet();
  const qc = useQueryClient();
  const { address } = useWallet();

  return useMutation({
    mutationFn: async ({ modelId }: { modelId: number }) => {
      if (!provider) throw new Error("Wallet not connected");
      const signer    = await provider.getSigner();
      const contract  = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      const buyerAddr = await signer.getAddress();
      const escrowId  = await contract.buyerEscrow(modelId, buyerAddr);
      if (escrowId === 0n) throw new Error("No escrow found for this purchase");
      const escrow = await contract.escrows(escrowId);
      if (escrow.released) throw new Error("Escrow already released");
      if (escrow.refunded) throw new Error("Escrow was refunded");
      const tx = await contract.confirmDelivery(escrowId);
      await tx.wait();
      return { escrowId: Number(escrowId), txHash: tx.hash };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["purchases", address] });
    },
  });
}

// ── Admin panel hook ───────────────────────────────────────────────────────────

function useAdminData(token: string | null, role: string | null) {
  return useQuery({
    queryKey: ["admin", "platform"],
    queryFn: () => api.get<AdminData>("/api/admin/platform", token),
    enabled: role === "admin" && !!token,
    staleTime: 30_000,
  });
}

// ── Platform fee withdrawal (owner only) ──────────────────────────────────────

function useWithdrawPlatformFees() {
  const { provider } = useWallet();
  const qc           = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("Wallet not connected");
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      const owner    = await contract.owner();
      const caller   = await signer.getAddress();
      if (owner.toLowerCase() !== caller.toLowerCase()) {
        throw new Error("Only the contract owner can withdraw platform fees.");
      }
      const earnings = await contract.platformEarnings();
      if (earnings === 0n) throw new Error("No platform fees to withdraw.");
      const tx      = await contract.withdrawPlatformFees();
      const receipt = await tx.wait();
      return { txHash: tx.hash, amountEth: Number(earnings) / 1e18, blockNumber: receipt.blockNumber };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "platform"] });
    },
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const navigate  = useNavigate();
  const { address, balance, chainId, isConnecting, error, connect, disconnect } = useWallet();
  const { isAuthenticated, isSigning, signIn, signOut, token, role } = useAuth();
  const { toUsd } = useEthPrice();
  const [copied,       setCopied]       = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const { data: purchases = [], isLoading: purchasesLoading } = useMyPurchases(address);
  const confirmDelivery     = useConfirmDelivery();
  const withdrawPlatformFees = useWithdrawPlatformFees();
  const { data: adminData, isLoading: adminLoading } = useAdminData(token, role);

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const chainName = chainId ? (SUPPORTED_CHAINS[chainId] ?? `Chain ${chainId}`) : null;

  const handleConfirm = async (modelId: number) => {
    setConfirmingId(modelId);
    try {
      await confirmDelivery.mutateAsync({ modelId });
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className="animate-page-in min-h-screen pt-[88px] pb-[144px] px-6 lg:px-20 space-y-12 max-w-7xl mx-auto">

      {/* ── HEADER ── */}
      <div className="space-y-2">
        <h1 className="font-syne font-black text-4xl lg:text-6xl tracking-tighter uppercase leading-none">Neural Vault</h1>
        <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
          Identity &amp; Capital Command Center
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">

        {/* ── LEFT COLUMN: WALLET & IDENTITY ── */}
        <div className="lg:col-span-12 xl:col-span-5 space-y-8">

          {/* Wallet status card */}
          <div className="glass-card neural-glow rounded-[40px] p-10 relative overflow-hidden space-y-10">
            {/* Ambient glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-container/10 blur-[100px] -mr-32 -mt-32 rounded-full pointer-events-none" />

            {!address ? (
              <div className="text-center space-y-8 py-10 relative z-10">
                <div className="w-24 h-24 rounded-full glass-card flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined text-5xl text-on-surface-variant">account_balance_wallet</span>
                </div>
                <div className="space-y-2">
                  <h2 className="font-syne font-black text-3xl uppercase tracking-tight">Connect Module</h2>
                  <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest max-w-[200px] mx-auto opacity-70">
                    Awaiting Web3 Provider Handshake
                  </p>
                </div>
                <button
                  className="w-full bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold py-5 rounded-2xl uppercase tracking-wide hover:shadow-[0_0_40px_rgba(189,157,255,0.4)] active:scale-95 transition-all"
                  onClick={connect}
                  disabled={isConnecting}
                >
                  {isConnecting ? "HANDSHAKE IN PROGRESS..." : "ESTABLISH CONNECTION"}
                </button>
                {error && <p className="font-label text-[10px] text-error uppercase">{error}</p>}
              </div>
            ) : (
              <>
                {/* Node status row */}
                <div className="flex justify-between items-start relative z-10">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                      <span className="font-label text-[10px] font-bold text-secondary uppercase tracking-widest">NODE_ESTABLISHED</span>
                    </div>
                    <div className="font-label text-xs text-on-surface-variant uppercase tracking-widest">{chainName}</div>
                  </div>
                  <button
                    onClick={disconnect}
                    className="font-label text-[10px] text-error uppercase tracking-widest hover:underline underline-offset-4"
                  >
                    Terminate
                  </button>
                </div>

                {/* Vault address */}
                <div className="space-y-2 relative z-10">
                  <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest ml-1">VAULT_ADDRESS</label>
                  <div className="bg-surface-container-high p-5 rounded-2xl border border-outline-variant/10 flex justify-between items-center group/addr">
                    <span className="font-label text-xs font-bold truncate max-w-[180px] md:max-w-none">{address}</span>
                    <button
                      onClick={copy}
                      className="font-label text-[10px] text-secondary uppercase tracking-widest shrink-0 ml-4 hover:opacity-70 transition-opacity"
                    >
                      {copied ? "COPIED ✓" : "COPY_HEX"}
                    </button>
                  </div>
                </div>

                {/* Balance */}
                <div className="space-y-1 relative z-10">
                  <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest ml-1">LIQUID_CAPITAL</label>
                  <div className="flex items-baseline gap-4">
                    <span className="font-label text-6xl font-bold tracking-tighter">
                      {balance !== null ? parseFloat(balance).toFixed(4) : "0.0000"}
                    </span>
                    <span className="font-label text-2xl font-bold text-secondary">ETH</span>
                  </div>
                  {balance && (
                    <p className="font-label text-xs text-on-surface-variant uppercase opacity-60">≈ {toUsd(balance)} USD</p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-outline-variant/10 relative z-10">
                  <a
                    href={`https://sepolia.etherscan.io/address/${address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="glass-card py-4 rounded-xl font-label text-[10px] text-center hover:border-secondary/30 uppercase tracking-widest transition-colors"
                  >
                    Scanner ↗
                  </a>
                  <button
                    className={`py-4 rounded-xl font-label text-[10px] text-center uppercase tracking-widest transition-all ${
                      isAuthenticated
                        ? "bg-gradient-to-r from-secondary-container to-secondary text-on-secondary font-bold"
                        : "glass-card hover:border-secondary/30"
                    }`}
                    onClick={isAuthenticated ? signOut : signIn}
                    disabled={isSigning}
                  >
                    {isSigning ? "SIGNING..." : isAuthenticated ? "SESSION_ACTIVE" : "AUTHORIZE"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Trust indicators */}
          <div className="glass-card rounded-[32px] p-8 space-y-6">
            <div className="space-y-4">
              {[
                { label: "On-Chain Identity", status: !!address },
                { label: "Backend Auth (JWT)", status: isAuthenticated },
                { label: "Privileged Access",  status: !!role },
              ].map((item) => (
                <div key={item.label} className="flex justify-between items-center">
                  <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant">{item.label}</span>
                  <span className={`font-label text-[10px] uppercase tracking-widest ${item.status ? "text-secondary" : "text-on-surface-variant/30"}`}>
                    {item.status ? "SYNCED" : "LOCKED"}
                  </span>
                </div>
              ))}
            </div>
            <div className="pt-6 border-t border-dashed border-outline-variant/10 space-y-1">
              {[
                "Wallet proves identity (MetaMask signature).",
                "JWT Session enables high-speed API interaction.",
                "Escrows locked in ModelChain protocol contract.",
              ].map((line, i) => (
                <p key={i} className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest opacity-60 flex items-start gap-2">
                  <span className="text-secondary font-bold shrink-0">◈</span> {line}
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: ADMIN + PURCHASES ── */}
        <div className="lg:col-span-12 xl:col-span-7 space-y-8">

          {/* Admin command center */}
          {role === "admin" && (
            <div className="glass-card rounded-[40px] p-10 border-t-2 border-primary-container/40 space-y-10 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary-container/40 to-transparent" />
              <div className="flex justify-between items-center">
                <h3 className="font-syne font-bold text-2xl uppercase tracking-tight flex items-center gap-3">
                  <span className="text-primary-container">⬡</span> Architect Command
                </h3>
                <span className="px-3 py-1 bg-primary-container/10 text-primary-container rounded-full font-label text-[9px] border border-primary-container/20 uppercase tracking-widest">
                  Access Level: OWNER
                </span>
              </div>

              {adminLoading ? (
                <div className="space-y-4 animate-pulse">
                  <div className="skeleton h-20 rounded-2xl" />
                  <div className="skeleton h-20 rounded-2xl" />
                </div>
              ) : adminData ? (
                <div className="space-y-10">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: "FEES",      value: `${(adminData.contract as PlatformInfo).platform_fee_pct}%` },
                      { label: "VAULT_ETH", value: `${(adminData.contract as PlatformInfo).platform_earnings_eth}` },
                      { label: "MODELS",    value: String((adminData.contract as PlatformInfo).model_count_onchain) },
                      {
                        label: "STATUS",
                        value: (adminData.contract as PlatformInfo).is_paused ? "PAUSED" : "ACTIVE",
                        ok: !(adminData.contract as PlatformInfo).is_paused,
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="glass-card rounded-2xl p-5 text-center space-y-1">
                        <div className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">{stat.label}</div>
                        <div className={`font-label text-lg font-bold tracking-tighter ${"ok" in stat && stat.ok === false ? "text-error" : ""}`}>
                          {stat.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/10 pb-4">
                      Executive Actions
                    </h4>
                    <div className="flex flex-col md:flex-row gap-4">
                      <button
                        className="bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold px-8 py-5 rounded-2xl uppercase tracking-wide flex-1 disabled:opacity-50 hover:shadow-[0_0_30px_rgba(189,157,255,0.4)] active:scale-95 transition-all"
                        onClick={() => withdrawPlatformFees.mutate()}
                        disabled={withdrawPlatformFees.isPending || (adminData.contract as PlatformInfo).platform_earnings_eth === 0}
                      >
                        {withdrawPlatformFees.isPending
                          ? "WITHDRAWING..."
                          : `RECLAIM EARNINGS (${(adminData.contract as PlatformInfo).platform_earnings_eth} ETH)`}
                      </button>
                      <div className="flex-1 p-5 rounded-2xl border border-outline-variant/10 glass-card flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="font-label text-[9px] text-on-surface-variant uppercase">LISTENER_HEALTH</span>
                          <div className="font-label text-xs font-bold flex items-center gap-2 uppercase tracking-tight">
                            <span className={`w-2 h-2 rounded-full ${adminData.listener_health.status === "ok" ? "bg-secondary animate-pulse" : "bg-error"}`} />
                            {adminData.listener_health.status}_{adminData.listener_health.block ?? "N/A"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Acquisitions / escrow list */}
          <div className="glass-card rounded-[40px] p-10 space-y-10">
            <div className="flex justify-between items-center">
              <h3 className="font-syne font-bold text-2xl uppercase tracking-tight flex items-center gap-3">
                <span className="text-secondary">◈</span> Acquisitions
              </h3>
              <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                {purchases.length} total artifacts
              </span>
            </div>

            {purchasesLoading ? (
              <div className="space-y-6">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton h-32 rounded-[32px]" />)}
              </div>
            ) : purchases.length === 0 ? (
              <div className="py-20 text-center space-y-6 bg-secondary-container/5 rounded-[32px] border border-dashed border-secondary/10">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant block">inbox</span>
                <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest opacity-60">
                  No active acquisitions detected
                </p>
                <button
                  onClick={() => navigate("/marketplace")}
                  className="px-8 py-3 bg-gradient-to-r from-secondary-container to-secondary text-on-secondary font-syne font-bold rounded-xl font-label text-xs uppercase tracking-wide hover:scale-105 active:scale-95 transition-all"
                >
                  EXPLORE NETWORK
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {purchases.map((p) => {
                  const isConfirming = confirmingId === p.model_id;
                  const purchaseDate = new Date(p.purchased_at);
                  const escrowExpiry = new Date(purchaseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
                  const isExpired    = Date.now() > escrowExpiry.getTime();
                  const daysLeft     = Math.max(0, Math.ceil((escrowExpiry.getTime() - Date.now()) / 86_400_000));

                  return (
                    <div
                      key={p.id}
                      className="glass-card rounded-[32px] p-8 hover:border-secondary/20 transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-8 group"
                    >
                      {/* Left info */}
                      <div className="space-y-4 flex-1">
                        <div className="space-y-1">
                          <h4
                            className="font-syne font-bold text-xl uppercase tracking-tight flex items-center gap-3 group-hover:text-secondary transition-colors cursor-pointer"
                            onClick={() => navigate(`/model/${p.model_id}`)}
                          >
                            {p.model_name}
                          </h4>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                            <span className="font-bold">{purchaseDate.toLocaleDateString()}</span>
                            <span className="w-1 h-1 rounded-full bg-outline-variant" />
                            <span className="text-on-surface">{p.price_paid_eth} ETH</span>
                            {p.on_chain_tx && (
                              <>
                                <span className="w-1 h-1 rounded-full bg-outline-variant" />
                                <a
                                  href={`https://sepolia.etherscan.io/tx/${p.on_chain_tx}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-secondary hover:underline underline-offset-4"
                                >
                                  TX_SCAN ↗
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                        {p.model_description && (
                          <p className="font-body text-xs text-on-surface-variant line-clamp-2 italic opacity-80">
                            {p.model_description}
                          </p>
                        )}
                      </div>

                      {/* Right actions */}
                      <div className="flex flex-col items-end gap-3 shrink-0 w-full md:w-auto">
                        <div className={`w-full text-center md:w-auto px-4 py-2 rounded-full font-label text-[9px] font-bold uppercase tracking-widest border ${
                          isExpired
                            ? "bg-secondary-container/10 text-secondary border-secondary/20"
                            : "bg-primary-container/10 text-primary-container border-primary-container/20"
                        }`}>
                          {isExpired ? "ESCROW_RELEASED" : `ESCROW_LOCK: ${daysLeft}D`}
                        </div>
                        {!isExpired && MARKETPLACE_ADDRESS !== "0x0000000000000000000000000000000000000000" && (
                          <button
                            className="w-full h-12 glass-card hover:border-secondary/30 font-label text-xs uppercase tracking-widest rounded-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
                            onClick={() => handleConfirm(p.model_id)}
                            disabled={isConfirming || confirmDelivery.isPending}
                          >
                            {isConfirming ? "COORDINATING..." : "CONFIRM_RECEIPT"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
