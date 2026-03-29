import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useDashboardStats, useTelemetryInsights } from "../hooks/useAnalytics";
import { useMarketplace } from "../hooks/useMarketplace";
import { useEthPrice } from "../hooks/useEthPrice";
import TxBadge from "../components/TxBadge";
import type { Transaction } from "../types";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid,
} from "recharts";

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

// ── Chart tooltip ──────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
      <p style={{ fontWeight: 600, marginBottom: 2 }}>{label}</p>
      <p style={{ color: "var(--accent)" }}>{payload[0].value} ETH</p>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { address } = useWallet();
  const { isAuthenticated, signIn, isSigning } = useAuth();
  const { data: stats, isLoading, error: statsError } = useDashboardStats(address);
  const { data: insights, isLoading: insightsLoading } = useTelemetryInsights();
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

  const canWithdraw = earningsLoaded && parseFloat(earnings) > 0 && !!address;
  const pc = stats?.period_comparison;
  const br = stats?.buyer_retention;

  // ── Stat cards config ──────────────────────────────────────────────────────
  const conversionRate = insights
    ? (insights.conversion_funnel.purchased > 0 && insights.conversion_funnel.viewed > 0)
      ? ((insights.conversion_funnel.purchased / insights.conversion_funnel.viewed) * 100).toFixed(1) + "%"
      : "—"
    : "—";

  const statCards = stats
    ? [
        { label: "Total Earned",    value: `${stats.total_earned} ETH`, sub: toUsd(String(stats.total_earned)) },
        { label: "Total Sales",     value: String(stats.total_sales),   sub: `${stats.unique_buyers} unique buyers` },
        { label: "Models Listed",   value: String(stats.models_listed), sub: "" },
        { label: "Conversion Rate", value: conversionRate,              sub: "view → purchase" },
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

      {/* ── Data consistency warning */}
      {stats?.consistency_warnings && stats.consistency_warnings.length > 0 && (
        <div className="warn-banner" style={{ fontSize: 13 }}>
          ⚠ Purchase counter drift detected — analytics may be slightly inaccurate.
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

        {/* ── Monthly revenue — Recharts area chart ────────────────────────── */}
        <div className="chart-card">
          <h3 className="card-title">Monthly Revenue (ETH)</h3>
          {isLoading ? (
            <SkeletonCard height={200} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={stats?.monthly_revenue ?? []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="eth" stroke="var(--accent)" fill="url(#revenueGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── Two-column bottom section ────────────────────────────────────── */}
        <div className="dashboard-bottom">
          {/* Top models table */}
          {(isLoading || (stats?.top_models && stats.top_models.length > 0)) && (
            <div className="chart-card chart-card--grow">
              <h3 className="card-title">Model Performance</h3>
              {isLoading ? (
                <SkeletonCard height={160} />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="perf-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Price</th>
                        <th>Sales</th>
                        <th>Revenue</th>
                        <th>Rating</th>
                        <th>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats?.top_models ?? []).map((m) => (
                        <tr
                          key={m.id}
                          className="perf-table__row"
                          onClick={() => navigate(`/model/${m.id}`)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && navigate(`/model/${m.id}`)}
                        >
                          <td>
                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                            {m.category && <span className="model-category" style={{ marginLeft: 8 }}>{m.category}</span>}
                          </td>
                          <td>{m.price_eth} ETH</td>
                          <td>{m.actual_purchases ?? m.purchases}</td>
                          <td style={{ fontWeight: 600, color: "var(--green)" }}>{m.revenue} ETH</td>
                          <td>
                            {m.avg_rating != null ? (
                              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <Stars value={m.avg_rating} />
                                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{m.avg_rating}</span>
                              </span>
                            ) : "—"}
                          </td>
                          <td>
                            {m.revenue_share_pct != null && (
                              <span className="change-badge change-badge--neutral">{m.revenue_share_pct}%</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

        {/* ── Failure Insights Panel ───────────────────────────────────────── */}
        <div className="chart-card">
          <h3 className="card-title">Failure Insights</h3>
          <p className="card-subtitle">Top reasons users fail to complete transactions</p>
          {insightsLoading ? (
            <SkeletonCard height={120} />
          ) : insights && insights.failure_reasons.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <ResponsiveContainer width="100%" height={Math.max(120, insights.failure_reasons.length * 40)}>
                <BarChart data={insights.failure_reasons} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category" dataKey="reason" width={180}
                    tick={{ fill: "var(--text-2)", fontSize: 12 }} axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="var(--red)" radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="empty-state" style={{ marginTop: 12 }}>No transaction failures recorded yet.</div>
          )}
        </div>

        {/* ── RPC Reliability Panel ────────────────────────────────────────── */}
        <div className="chart-card">
          <h3 className="card-title">RPC Reliability</h3>
          {insightsLoading ? (
            <SkeletonCard height={80} />
          ) : insights ? (
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", marginTop: 12 }}>
              <div className="stat-card" style={{ flex: 1, minWidth: 140 }}>
                <span className="stat-label">Success Rate</span>
                <span className="stat-value" style={{ color: insights.rpc_health.success_rate >= 95 ? "var(--green)" : "var(--red)" }}>
                  {insights.rpc_health.success_rate}%
                </span>
                <div style={{ marginTop: 8, height: 6, background: "var(--bg-3)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${insights.rpc_health.success_rate}%`, background: insights.rpc_health.success_rate >= 95 ? "var(--green)" : "var(--red)", borderRadius: 3, transition: "width 0.5s ease" }} />
                </div>
              </div>
              <div className="stat-card" style={{ flex: 1, minWidth: 140 }}>
                <span className="stat-label">Avg Latency</span>
                <span className="stat-value">{insights.rpc_health.avg_latency_ms}ms</span>
              </div>
              <div className="stat-card" style={{ flex: 1, minWidth: 140 }}>
                <span className="stat-label">Total Calls</span>
                <span className="stat-value">{insights.rpc_health.total_calls}</span>
                <span className="stat-sub">{insights.rpc_health.errors} errors</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
