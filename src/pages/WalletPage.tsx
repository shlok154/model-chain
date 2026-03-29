import { useState } from "react";
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
  price_paid_eth: number;
  on_chain_tx: string | null;
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
// Direct Supabase reads fail here because the browser Supabase client uses the
// anon key without the app JWT injected, so the "Buyers read own purchases" RLS
// policy (keyed on request.jwt.claims) always returns zero rows.
// We route through /api/users/me/purchases which validates the JWT in FastAPI
// and uses the service key with an explicit wallet filter.

function useMyPurchases(address: string | null) {
  const { token } = useAuth();
  return useQuery({
    queryKey: ["purchases", address],
    queryFn: async (): Promise<EscrowRow[]> => {
      if (!address) return [];

      // Primary: backend API (JWT-authenticated)
      if (token) {
        try {
          return await api.get<EscrowRow[]>("/api/users/me/purchases", token);
        } catch { /* fall through */ }
      }

      // Fallback: direct Supabase (only works if RLS is open or anon policy allows)
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
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);

      const buyerAddress = await signer.getAddress();
      const escrowId = await contract.buyerEscrow(modelId, buyerAddress);
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
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("Wallet not connected");
      const signer   = await provider.getSigner();
      const contract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);

      // Confirm caller is the contract owner before submitting
      const owner = await contract.owner();
      const caller = await signer.getAddress();
      if (owner.toLowerCase() !== caller.toLowerCase()) {
        throw new Error("Only the contract owner can withdraw platform fees.");
      }

      const earnings = await contract.platformEarnings();
      if (earnings === 0n) throw new Error("No platform fees to withdraw.");

      const tx = await contract.withdrawPlatformFees();
      const receipt = await tx.wait();
      return { txHash: tx.hash, amountEth: Number(earnings) / 1e18, blockNumber: receipt.blockNumber };
    },
    onSuccess: () => {
      // Refresh admin panel data
      qc.invalidateQueries({ queryKey: ["admin", "platform"] });
    },
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const { address, balance, chainId, isConnecting, error, connect, disconnect } = useWallet();
  const { isAuthenticated, isSigning, signIn, signOut, authError, token, role } = useAuth();
  const { toUsd } = useEthPrice();
  const [copied, setCopied] = useState(false);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  const { data: purchases = [], isLoading: purchasesLoading } = useMyPurchases(address);
  const confirmDelivery        = useConfirmDelivery();
  const withdrawPlatformFees   = useWithdrawPlatformFees();
  const { data: adminData, isLoading: adminLoading } = useAdminData(token, role);

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const chainName    = chainId ? (SUPPORTED_CHAINS[chainId] ?? `Chain ${chainId}`) : null;
  const isUnsupported = chainId !== null && !SUPPORTED_CHAINS[chainId];

  const handleConfirm = async (modelId: number) => {
    setConfirmingId(modelId);
    try {
      await confirmDelivery.mutateAsync({ modelId });
    } finally {
      setConfirmingId(null);
    }
  };

  // ── Auth model explainer (always visible) ──────────────────────────────────
  const authModelCard = (
    <div className="wallet-info-card" style={{ marginTop: 16 }}>
      <h3 className="card-title" style={{ marginBottom: 8 }}>How Authentication Works</h3>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
        <p style={{ marginBottom: 6 }}>
          <strong>Wallet</strong> → proves your on-chain identity (MetaMask signature, no gas)
        </p>
        <p style={{ marginBottom: 6 }}>
          <strong>JWT session</strong> → backend access token issued after wallet verification.
          Sent as <code>Authorization: Bearer</code> on every API call.
        </p>
        <p style={{ marginBottom: 6 }}>
          <strong>Smart contract</strong> → holds ETH payments and escrow. Only your private key
          can authorise on-chain transactions.
        </p>
        <p style={{ marginBottom: 0, opacity: 0.7 }}>
          FastAPI validates your JWT before any authenticated action.
          Supabase RLS is an additional secondary layer. The IPFS CID is public
          — downloads go through the authenticated backend proxy.
        </p>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Wallet</h1>
          <p className="page-subtitle">Manage your Ethereum connection</p>
        </div>
      </div>

      <div className="wallet-layout">
        {error     && <div className="error-banner">{error}</div>}
        {authError && <div className="error-banner">{authError}</div>}
        {isUnsupported && (
          <div className="warn-banner">
            ⚠ Unsupported network. Please switch to Sepolia Testnet in MetaMask.
          </div>
        )}

        {!address ? (
          <div className="connect-card">
            <div className="connect-icon">◎</div>
            <h2 className="connect-title">Connect Your Wallet</h2>
            <p className="connect-desc">
              Connect MetaMask to browse, purchase, and list AI models on-chain.
            </p>
            <button className="btn btn--primary btn--lg" onClick={connect} disabled={isConnecting}>
              {isConnecting ? "Connecting…" : "Connect MetaMask"}
            </button>
            <p className="connect-hint">
              Don't have MetaMask?{" "}
              <a href="https://metamask.io" target="_blank" rel="noreferrer" className="text-link">
                Install it here ↗
              </a>
            </p>
          </div>
        ) : (
          <>
            {/* ── Wallet info card ──────────────────────────────────────────── */}
            <div className="wallet-info-card">
              <div className="wallet-status-row">
                <span className="wallet-dot wallet-dot--lg" />
                <span className="wallet-status-text">Connected</span>
                {chainName && (
                  <span className={`chain-badge ${isUnsupported ? "chain-badge--warn" : ""}`}>
                    {chainName}
                  </span>
                )}
                {role && (
                  <span className="chain-badge" style={{ marginLeft: 4, background: role === "admin" ? "var(--accent)" : undefined }}>
                    {role}
                  </span>
                )}
              </div>

              <div className="wallet-address-block">
                <span className="meta-label">Address</span>
                <div className="address-row">
                  <span className="wallet-full-addr">{address}</span>
                  <button className="copy-btn" onClick={copy}>
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="wallet-balance-block">
                <span className="meta-label">Balance</span>
                <span className="wallet-balance">
                  {balance !== null ? `${parseFloat(balance).toFixed(4)} ETH` : "Loading…"}
                </span>
                {balance && (
                  <span className="hint-text">{toUsd(balance)}</span>
                )}
              </div>

              <div className="wallet-actions">
                <a href={`https://sepolia.etherscan.io/address/${address}`}
                  target="_blank" rel="noreferrer" className="btn btn--secondary">
                  View on Etherscan ↗
                </a>
                <button className="btn btn--danger" onClick={disconnect}>Disconnect</button>
              </div>
            </div>

            {/* ── Auth sign-in card ─────────────────────────────────────────── */}
            <div className="wallet-info-card" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                    {isAuthenticated ? "✓ Signed in to ModelChain" : "Sign in to ModelChain"}
                  </p>
                  <p className="hint-text">
                    {isAuthenticated
                      ? "Your session is active. Analytics, reviews, and uploads are fully synced."
                      : "Sign a message with MetaMask to unlock full features — no gas required."}
                  </p>
                </div>
                {isAuthenticated ? (
                  <button className="btn btn--secondary" onClick={signOut}>Sign Out</button>
                ) : (
                  <button className="btn btn--primary" onClick={signIn} disabled={isSigning}>
                    {isSigning ? "Signing…" : "Sign In"}
                  </button>
                )}
              </div>
            </div>

            {/* ── Auth model explainer ──────────────────────────────────────── */}
            {authModelCard}

            {/* ── Admin / Owner panel ───────────────────────────────────────── */}
            {role === "admin" && (
              <div className="wallet-info-card" style={{ marginTop: 16, borderLeft: "3px solid var(--accent)" }}>
                <h3 className="card-title" style={{ marginBottom: 12 }}>
                  ⬡ Platform Admin Panel
                </h3>
                <p className="hint-text" style={{ marginBottom: 12 }}>
                  You are signed in as an admin. The contract owner address is the deployer wallet
                  that can pause the contract, slash nodes, and withdraw platform fees via MetaMask.
                  Backend admin controls are managed here.
                </p>

                {adminLoading ? (
                  <div className="loading-placeholder" style={{ padding: "12px 0" }}>Loading platform data…</div>
                ) : adminData ? (
                  <div style={{ fontSize: 13 }}>
                    {/* Contract stats */}
                    {"error" in adminData.contract ? (
                      <div className="error-banner" style={{ marginBottom: 10 }}>
                        {(adminData.contract as { error: string }).error}
                      </div>
                    ) : (
                      <div className="admin-stats-grid">
                        {[
                          ["Contract Owner", (adminData.contract as PlatformInfo).contract_owner],
                          ["Platform Fee", `${(adminData.contract as PlatformInfo).platform_fee_pct}%`],
                          ["Platform Earnings", `${(adminData.contract as PlatformInfo).platform_earnings_eth} ETH`],
                          ["Escrow Timeout", `${(adminData.contract as PlatformInfo).escrow_timeout_hours}h`],
                          ["Min Stake", `${(adminData.contract as PlatformInfo).min_stake_eth} ETH`],
                          ["On-chain Models", String((adminData.contract as PlatformInfo).model_count_onchain)],
                          ["Contract Status", (adminData.contract as PlatformInfo).is_paused ? "⏸ PAUSED" : "✓ Active"],
                        ].map(([label, value]) => (
                          <div key={label} className="admin-stat-row">
                            <span style={{ color: "var(--text-muted)" }}>{label}</span>
                            <span style={{ fontWeight: 600 }}>{value}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Event listener health */}
                    <div style={{ marginTop: 14 }}>
                      <span style={{ fontWeight: 600 }}>Event Listener: </span>
                      <span className={`chain-badge ${
                        adminData.listener_health.status === "ok" ? "" :
                        adminData.listener_health.status === "error" ? "chain-badge--warn" : ""
                      }`}>
                        {adminData.listener_health.status}
                      </span>
                      {adminData.listener_health.block && (
                        <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                          block {adminData.listener_health.block}
                        </span>
                      )}
                      {adminData.listener_health.error && (
                        <div className="error-banner" style={{ marginTop: 6, fontSize: 12 }}>
                          {adminData.listener_health.error}
                        </div>
                      )}
                    </div>

                    {/* Dead-letter queue */}
                    {adminData.dead_letter_count > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <span style={{ fontWeight: 600 }}>Dead-Letter Queue: </span>
                        <span className="chain-badge chain-badge--warn">{adminData.dead_letter_count} failed events</span>
                        <div style={{ marginTop: 8 }}>
                          {adminData.dead_letters_recent.map((dl, i) => (
                            <div key={i} className="admin-stat-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                              <span style={{ fontWeight: 600 }}>{dl.event}</span>
                              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{dl.error}</span>
                              <a
                                href={`https://sepolia.etherscan.io/tx/${dl.tx_hash}`}
                                target="_blank" rel="noreferrer"
                                className="text-link" style={{ fontSize: 11 }}
                              >
                                {(dl.tx_hash ?? "").slice(0, 18)}… ↗
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {adminData.dead_letter_count === 0 && (
                      <p style={{ marginTop: 10, color: "var(--text-muted)" }}>✓ No failed events in dead-letter queue.</p>
                    )}

                    {/* Owner actions — withdraw platform fees */}
                    {"platform_earnings_eth" in adminData.contract && (
                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                        <p style={{ fontWeight: 600, marginBottom: 8 }}>Owner Actions</p>

                        {withdrawPlatformFees.isSuccess && (
                          <div className="info-banner" style={{ marginBottom: 8 }}>
                            ✓ Withdrew {withdrawPlatformFees.data?.amountEth.toFixed(6)} ETH
                            {" — "}
                            <a
                              href={`https://sepolia.etherscan.io/tx/${withdrawPlatformFees.data?.txHash}`}
                              target="_blank" rel="noreferrer" className="text-link"
                            >
                              View tx ↗
                            </a>
                          </div>
                        )}
                        {withdrawPlatformFees.isError && (
                          <div className="error-banner" style={{ marginBottom: 8 }}>
                            {(withdrawPlatformFees.error as any)?.message}
                          </div>
                        )}

                        <button
                          className="btn btn--primary"
                          style={{ marginRight: 8 }}
                          onClick={() => withdrawPlatformFees.mutate()}
                          disabled={
                            withdrawPlatformFees.isPending ||
                            (adminData.contract as PlatformInfo).platform_earnings_eth === 0
                          }
                        >
                          {withdrawPlatformFees.isPending
                            ? "Withdrawing…"
                            : `Withdraw ${(adminData.contract as PlatformInfo).platform_earnings_eth} ETH`}
                        </button>

                        <p className="hint-text" style={{ marginTop: 8 }}>
                          Sends all accumulated platform fees to the owner wallet.
                          Requires the connected wallet to be the contract deployer.
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {/* ── Purchases / Escrow panel ──────────────────────────────────── */}
            <div className="wallet-info-card" style={{ marginTop: 16 }}>
              <h3 className="card-title" style={{ marginBottom: 16 }}>Your Purchases</h3>

              {purchasesLoading ? (
                <div className="loading-placeholder" style={{ padding: "20px 0" }}>Loading purchases…</div>
              ) : purchases.length === 0 ? (
                <p className="hint-text">No purchases yet. Browse the marketplace to find models.</p>
              ) : (
                <div className="escrow-list">
                  {purchases.map(p => {
                    const isConfirming = confirmingId === p.model_id;
                    const purchaseDate = new Date(p.purchased_at);
                    const escrowExpiry = new Date(purchaseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
                    const isExpired    = Date.now() > escrowExpiry.getTime();
                    const daysLeft     = Math.max(0, Math.ceil((escrowExpiry.getTime() - Date.now()) / 86_400_000));

                    return (
                      <div key={p.id} className="escrow-row">
                        <div className="escrow-info">
                          <p className="escrow-model-name">{p.model_name}</p>
                          <p className="escrow-meta">
                            {p.price_paid_eth} ETH · {purchaseDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                          {p.on_chain_tx && (
                            <a href={`https://sepolia.etherscan.io/tx/${p.on_chain_tx}`}
                              target="_blank" rel="noreferrer" className="tx-link" style={{ fontSize: 11 }}>
                              View tx ↗
                            </a>
                          )}
                        </div>

                        <div className="escrow-actions">
                          {isExpired ? (
                            <span className="escrow-badge escrow-badge--released">Escrow released</span>
                          ) : (
                            <span className="escrow-badge escrow-badge--pending">{daysLeft}d escrow</span>
                          )}

                          {!isExpired && MARKETPLACE_ADDRESS !== "0x0000000000000000000000000000000000000000" && (
                            <button
                              className="btn btn--secondary"
                              style={{ fontSize: 12, padding: "6px 12px" }}
                              onClick={() => handleConfirm(p.model_id)}
                              disabled={isConfirming || confirmDelivery.isPending}
                            >
                              {isConfirming ? "Confirming…" : "Confirm Delivery"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {confirmDelivery.isError && (
                <div className="error-banner" style={{ marginTop: 12 }}>
                  {(confirmDelivery.error as any)?.message}
                </div>
              )}
              {confirmDelivery.isSuccess && (
                <div className="info-banner" style={{ marginTop: 12 }}>
                  ✓ Delivery confirmed — funds released to creator.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
