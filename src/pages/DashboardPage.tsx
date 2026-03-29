import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useDashboardStats } from "../hooks/useAnalytics";
import { useMarketplace } from "../hooks/useMarketplace";
import { useEthPrice } from "../hooks/useEthPrice";
import TxBadge from "../components/TxBadge";
import type { Transaction } from "../types";

// ── Inline star display (read-only) ───────────────────────────────────────────
function Stars({ value }: { value: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <span className="inline-stars" aria-label={`${value} stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={`inline-star ${rounded >= s ? "inline-star--full" : rounded >= s - 0.5 ? "inline-star--half" : ""}`}>
          ★
        </span>
      ))}
    </span>
  );
}

function SkeletonCard({ height = 80 }: { height?: number }) {
  return <div className="skeleton-card" style={{ height }} />;
}

// ── Change badge (+12.3% / -5.1%) ──────────────────────────────────────────────
function ChangeBadge({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return <span className="change-badge change-badge--neutral">no prior data</span>;
  const positive = pct >= 0;
  return (
    <span className={`change-badge ${positive ? "change-badge--up" : "change-badge--down"}`}>
      {positive ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { address } = useWallet();
  const { isAuthenticated, signIn, isSigning } = useAuth();
  const { data: stats, isLoading, error: statsError } = useDashboardStats(address);
  const { withdrawEarnings, getEarnings } = useMarketplace();
  const { toUsd } = useEthPrice();

  const [earnings,       setEarnings]       = useState<string>("0");
  const [earningsLoaded, setEarningsLoaded] = useState(false);
  const [tx,             setTx]             = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isWithdrawing,  setIsWithdrawing]  = useState(false);

  useEffect(() => {
    if (address) {
      setEarningsLoaded(false);
      getEarnings().then((v) => { setEarnings(v); setEarningsLoaded(true); });
    } else {
      setEarnings("0");
      setEarningsLoaded(false);
    }
  }, [address, getEarnings]);

  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await withdrawEarnings();
    setTx(result);
    if (result.status === "confirmed") setEarnings("0");
    setIsWithdrawing(false);
  };

  const maxEth    = stats ? Math.max(...(stats.monthly_revenue ?? []).map((d) => d.eth), 0.001) : 0.001;
  const maxWeekly = stats ? Math.max(...(stats.weekly_revenue_mtd ?? []).map((d) => d.eth), 0.001) : 0.001;
  const canWithdraw = earningsLoaded && parseFloat(earnings) > 0 && !!address;

  const pc = stats?.period_comparison;
  const br = stats?.buyer_retention;

  // ── Stat cards config ──────────────────────────────────────────────────────
  const statCards = stats
    ? [
        { label: "Total Earned",   value: `${stats.total_earned} ETH`, sub: toUsd(String(stats.total_earned)) },
        { label: "Models Listed",  value: String(stats.models_listed), sub: "" },
        { label: "Total Sales",    value: String(stats.total_sales),   sub: `${stats.unique_buyers} unique buyers` },
        { label: "Avg Royalty",    value: `${stats.avg_royalty}%`,     sub: "" },
        ...(stats.avg_rating != null
          ? [{ label: "Avg Rating", value: `${stats.avg_rating} / 5`, sub: `${stats.total_reviews} review${stats.total_reviews !== 1 ? "s" : ""}` }]
          : []),
      ]
    : [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Creator analytics &amp; earnings</p>
        </div>
        {address && !isAuthenticated && (
          <button className="btn btn--secondary" onClick={signIn} disabled={isSigning}>
            {isSigning ? "Signing…" : "⬡ Sign In to Sync"}
          </button>
        )}
      </div>

      {/* ── Banners ────────────────────────────────────────────────────────── */}
      {!address && (
        <div className="info-banner">Connect your wallet to see your real earnings and analytics.</div>
      )}
      {address && !isAuthenticated && (
        <div className="warn-banner">
          <strong>Showing demo data.</strong> Sign in with your wallet to unlock server-synced analytics.
        </div>
      )}
      {statsError && (
        <div className="error-banner">Could not load analytics — showing cached or demo data.</div>
      )}

      {/* ── Data consistency warning (only shown to creator if counter drifted) */}
      {stats?.consistency_warnings && stats.consistency_warnings.length > 0 && (
        <div className="warn-banner" style={{ fontSize: 13 }}>
          ⚠ Purchase counter drift detected — analytics may be slightly inaccurate.
          The platform operator has been notified. Affected models:{" "}
          {stats.consistency_warnings.map((w) => <code key={w} style={{ marginRight: 6 }}>{w}</code>)}
        </div>
      )}

      <div className="dashboard-grid">
        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <div className="stats-row stats-row--5">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="stat-card"><SkeletonCard height={54} /></div>
              ))
            : statCards.map((s) => (
                <div key={s.label} className="stat-card">
                  <span className="stat-label">{s.label}</span>
                  <span className="stat-value">{s.value}</span>
                  {s.sub && <span className="stat-sub">{s.sub}</span>}
                </div>
              ))}
        </div>

        {/* ── Period comparison (30d vs prior 30d) ────────────────────────── */}
        {(isLoading || pc) && (
          <div className="chart-card chart-card--compact">
            <h3 className="card-title">Last 30 Days vs Prior 30 Days</h3>
            {isLoading ? <SkeletonCard height={60} /> : pc ? (
              <div className="period-comparison-row">
                <div className="period-stat">
                  <span className="period-label">Revenue</span>
                  <span className="period-value">{pc.current_30d_revenue} ETH</span>
                  <ChangeBadge pct={pc.revenue_change_pct} />
                </div>
                <div className="period-divider" />
                <div className="period-stat">
                  <span className="period-label">Sales</span>
                  <span className="period-value">{pc.current_30d_sales}</span>
                  <ChangeBadge pct={pc.sales_change_pct} />
                </div>
                {br && (
                  <>
                    <div className="period-divider" />
                    <div className="period-stat">
                      <span className="period-label">Repeat Buyers</span>
                      <span className="period-value">{br.repeat_buyers}</span>
                      <span className="change-badge change-badge--neutral">{br.retention_rate}% retention</span>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* ── Monthly revenue chart ────────────────────────────────────────── */}
        <div className="chart-card">
          <h3 className="card-title">Monthly Revenue (ETH)</h3>
          {isLoading ? (
            <SkeletonCard height={160} />
          ) : (
            <div className="bar-chart">
              {(stats?.monthly_revenue ?? []).map((d) => (
                <div key={d.month} className="bar-col">
                  <span className="bar-value">{d.eth > 0 ? d.eth.toFixed(3) : ""}</span>
                  <div className="bar" style={{ height: `${(d.eth / maxEth) * 140}px` }} />
                  <span className="bar-label">{d.month}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Weekly revenue (current month to date) ───────────────────────── */}
        {(isLoading || (stats?.weekly_revenue_mtd && stats.weekly_revenue_mtd.length > 0)) && (
          <div className="chart-card chart-card--compact">
            <h3 className="card-title">This Month by Week (ETH)</h3>
            {isLoading ? (
              <SkeletonCard height={100} />
            ) : (
              <div className="bar-chart bar-chart--small">
                {(stats?.weekly_revenue_mtd ?? []).map((d) => (
                  <div key={d.week} className="bar-col">
                    <span className="bar-value">{d.eth > 0 ? d.eth.toFixed(3) : ""}</span>
                    <div className="bar" style={{ height: `${(d.eth / maxWeekly) * 80}px` }} />
                    <span className="bar-label">{d.week}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Two-column bottom section ────────────────────────────────────── */}
        <div className="dashboard-bottom">
          {/* Top models table */}
          {(isLoading || (stats?.top_models && stats.top_models.length > 0)) && (
            <div className="chart-card chart-card--grow">
              <h3 className="card-title">Top Models</h3>
              {isLoading ? (
                <SkeletonCard height={160} />
              ) : (
                <div className="top-models-list">
                  {(stats?.top_models ?? []).map((m, i) => (
                    <div
                      key={m.id}
                      className="top-model-row top-model-row--clickable"
                      onClick={() => navigate(`/model/${m.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/model/${m.id}`)}
                    >
                      <span className="top-model-rank">#{i + 1}</span>
                      <span className="top-model-name">{m.name}</span>
                      {m.category && <span className="model-category">{m.category}</span>}
                      {m.avg_rating != null && (
                        <span className="top-model-rating">
                          <Stars value={m.avg_rating} />
                          <span className="top-model-rating-label">{m.avg_rating}</span>
                        </span>
                      )}
                      <span className="top-model-sales">
                        {/* Use actual_purchases (from purchase rows) if available, else counter */}
                        {m.actual_purchases ?? m.purchases} sales
                      </span>
                      <span className="top-model-revenue">{m.revenue} ETH</span>
                      {m.revenue_share_pct != null && (
                        <span className="change-badge change-badge--neutral">{m.revenue_share_pct}%</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right column: category + withdraw */}
          <div className="dashboard-right-col">
            {(isLoading || (stats?.category_breakdown && Object.keys(stats.category_breakdown).length > 0)) && (
              <div className="chart-card">
                <h3 className="card-title">Models by Category</h3>
                {isLoading ? (
                  <SkeletonCard height={80} />
                ) : (
                  <div className="category-breakdown">
                    {Object.entries(stats?.category_breakdown ?? {}).map(([cat, count]) => (
                      <div key={cat} className="category-row">
                        <span className="model-category">{cat}</span>
                        <span className="category-count">{count as number} model{(count as number) !== 1 ? "s" : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Withdraw card */}
            <div className="withdraw-card">
              <h3 className="card-title">On-Chain Earnings</h3>
              {!earningsLoaded && address ? (
                <SkeletonCard height={40} />
              ) : (
                <>
                  <p className="withdraw-amount">{earnings} ETH</p>
                  {parseFloat(earnings) > 0 && (
                    <p className="withdraw-usd">{toUsd(earnings)}</p>
                  )}
                </>
              )}
              <button
                className="btn btn--primary"
                onClick={handleWithdraw}
                disabled={!canWithdraw || isWithdrawing}
                title={!address ? "Connect wallet" : parseFloat(earnings) === 0 ? "No earnings to withdraw" : ""}
              >
                {isWithdrawing ? "Withdrawing…" : "Withdraw Earnings"}
              </button>
              <TxBadge tx={tx} />
              {!address && <p className="hint-text">Connect wallet to withdraw.</p>}
              {address && parseFloat(earnings) === 0 && earningsLoaded && (
                <p className="hint-text">No on-chain earnings yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
