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

// ── Read-only star display ────────────────────────────────────────
function Stars({ value }: { value: number }) {
  const rounded = Math.round(value * 2) / 2;
  return (
    <div className="flex gap-0.5 items-center" aria-label={`${value} stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={`text-[10px] ${rounded >= s ? "text-secondary" : "text-on-surface-variant/20"}`}>
          ★
        </span>
      ))}
    </div>
  );
}

// ── Chart tooltip ─────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card p-3 rounded-xl shadow-2xl">
      <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">{label}</p>
      <p className="font-label text-sm font-bold text-secondary">{payload[0].value} ETH</p>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { address } = useWallet();
  const { isAuthenticated, signIn, isSigning } = useAuth();
  const { data: stats, isLoading } = useDashboardStats(address);
  const { data: insights, isLoading: insightsLoading } = useTelemetryInsights();
  const { withdrawEarnings, getEarnings } = useMarketplace();
  const { toUsd } = useEthPrice();

  const [earnings,       setEarnings]       = useState<string>("0");
  const [earningsLoaded, setEarningsLoaded] = useState(false);
  const [tx,             setTx]             = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isWithdrawing,  setIsWithdrawing]  = useState(false);
  const [chartView,      setChartView]      = useState<"30D" | "7D">("30D");

  const chartData = chartView === "7D"
    ? (stats?.weekly_revenue_mtd ?? []).map(d => ({ ...d, month: d.week }))
    : (stats?.monthly_revenue ?? []);

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

  const conversionRate = insights
    ? (insights.conversion_funnel.purchased > 0 && insights.conversion_funnel.viewed > 0)
      ? ((insights.conversion_funnel.purchased / insights.conversion_funnel.viewed) * 100).toFixed(1) + "%"
      : "—"
    : "—";

  const statCards = stats
    ? [
        {
          label: "NET EARNINGS",
          value: `${stats.total_earned} ETH`,
          sub: toUsd(String(stats.total_earned)),
          icon: "payments",
          delta: stats.period_comparison?.revenue_change_pct ?? null,
        },
        {
          label: "SALES VOLUME",
          value: String(stats.total_sales),
          sub: `${stats.unique_buyers} DIRECT BUYERS`,
          icon: "trending_up",
          delta: stats.period_comparison?.sales_change_pct ?? null,
        },
        {
          label: "NODES DEPLOYED",
          value: String(stats.models_listed),
          sub: "ACTIVE ON-CHAIN",
          icon: "hub",
          delta: null,
        },
        {
          label: "CONVERSION RATE",
          value: conversionRate,
          sub: "VIEW → LICENSE",
          icon: "conversion_path",
          delta: null,
        },
      ] as { label: string; value: string; sub: string; icon: string; delta: number | null }[]
    : [];

  return (
    <div className="animate-page-in min-h-screen pt-[88px] pb-[144px] px-6 lg:px-20 space-y-12">

      {/* ── HEADER ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="font-syne font-black text-4xl lg:text-7xl tracking-tighter uppercase leading-none">Dashboard</h1>
          <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mt-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
            ANALYTICS_OVERVIEW // CREATOR NODE
          </p>
        </div>
        {address && !isAuthenticated && (
          <button
            className="glass-card px-6 py-3 rounded-xl font-label text-xs uppercase tracking-widest hover:border-secondary/30 transition-colors group"
            onClick={signIn}
            disabled={isSigning}
          >
            {isSigning ? "SIGNING..." : (
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">hexagon</span>
                SIGN IN TO SYNC
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── NO WALLET STATE ── */}
      {!address && (
        <div className="p-8 bg-secondary-container/5 border border-dashed border-secondary-container/20 rounded-2xl flex items-center justify-center text-center">
          <p className="font-label text-xs text-secondary uppercase tracking-widest leading-relaxed">
            Establish wallet connection to retrieve<br className="hidden md:block" />
            private node metrics and earnings.
          </p>
        </div>
      )}

      {/* ── DATA DRIFT WARNING ── */}
      {stats?.consistency_warnings && stats.consistency_warnings.length > 0 && (
        <div className="p-4 bg-error/10 border border-error/20 text-error rounded-xl font-label text-[10px] uppercase tracking-widest">
          ⚠ DATA DRIFT DETECTED: ON-CHAIN SYNC IN PROGRESS. METRICS MAY VARY BY ±0.2%
        </div>
      )}

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-stagger">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-40 rounded-3xl" />)
          : statCards.map((s) => (
            <div key={s.label} className="glass-card rounded-3xl p-6 hover:-translate-y-[4px] transition-transform duration-300">
              <div className="flex items-start justify-between mb-4">
                <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">{s.label}</h3>
                <span className="material-symbols-outlined text-xl text-secondary-container">{s.icon}</span>
              </div>
              <div className="font-label text-3xl font-bold tracking-tighter text-on-surface mb-2">
                {/^\d+$/.test(s.value) ? Number(s.value).toLocaleString() : s.value}
              </div>
              <div className="flex items-center justify-between gap-2 mt-auto">
                <div className="font-label text-[10px] text-secondary uppercase tracking-tighter">{s.sub}</div>
                {s.delta != null && (
                  <span className={`font-label text-[9px] px-2 py-0.5 rounded-full border uppercase tracking-widest ${
                    s.delta >= 0
                      ? "text-secondary border-secondary/20 bg-secondary/5"
                      : "text-error border-error/20 bg-error/5"
                  }`}>
                    {s.delta >= 0 ? "+" : ""}{s.delta.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          ))
        }
      </div>

      {/* ── CHARTS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Revenue chart */}
        <div className="lg:col-span-2 glass-card rounded-3xl p-8 space-y-8">
          <div className="flex justify-between items-center">
            <h3 className="font-label text-xs uppercase tracking-widest">Market Performance</h3>
            <div className="flex items-center gap-1">
              {(["30D", "7D"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setChartView(v)}
                  className={`font-label text-[10px] uppercase tracking-widest px-3 py-1 rounded-lg transition-all ${
                    chartView === v
                      ? "bg-secondary-container/20 text-secondary border border-secondary/30"
                      : "text-on-surface-variant hover:text-secondary border border-transparent"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {isLoading ? (
            <div className="skeleton h-64 rounded-xl" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#bd9dff" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#bd9dff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 4" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: "#606471", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#606471", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(189,157,255,0.2)", strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="eth" stroke="#bd9dff" fill="url(#revenueGrad)" strokeWidth={2} animationDuration={1200} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Earnings vault */}
        <div className="glass-card neural-glow rounded-3xl p-8 border-t-2 border-primary-container/30 space-y-8 flex flex-col justify-between">
          <div className="space-y-6">
            <h3 className="font-label text-xs uppercase tracking-widest pb-4 border-b border-outline-variant/10">Earnings Vault</h3>
            {!earningsLoaded && address ? (
              <div className="skeleton h-16 w-3/4 rounded-lg" />
            ) : (
              <div className="space-y-2">
                <div className="font-label text-5xl font-bold tracking-tighter text-on-surface">
                  {earnings} <span className="text-secondary">ETH</span>
                </div>
                {parseFloat(earnings) > 0 && (
                  <p className="font-label text-sm text-on-surface-variant uppercase">≈ {toUsd(earnings)} USD</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center font-label text-[10px] text-on-surface-variant">
                <span>NETWORK LOAD</span>
                <span className="text-secondary">
                  {stats ? `${Math.min((stats.total_sales / 1000) * 100, 100).toFixed(0)}%` : "—"}
                </span>
              </div>
              <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary transition-all duration-700 ease-out rounded-full"
                  style={{
                    width: stats
                      ? `${Math.min((stats.total_sales / 1000) * 100, 100).toFixed(1)}%`
                      : "0%"
                  }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              className="w-full h-14 bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold uppercase rounded-2xl shadow-[0_0_20px_rgba(189,157,255,0.3)] hover:shadow-[0_0_35px_rgba(189,157,255,0.5)] hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-wide disabled:opacity-30 disabled:grayscale"
              onClick={handleWithdraw}
              disabled={!canWithdraw || isWithdrawing}
            >
              {isWithdrawing ? "PROCESSING..." : "WITHDRAW FUNDS"}
            </button>
            <TxBadge tx={tx} />
            {!address && <p className="text-center font-label text-[10px] text-on-surface-variant uppercase">Connect wallet to access vault</p>}
          </div>
        </div>
      </div>

      {/* ── BOTTOM SECTION ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">

        {/* Model performance table */}
        <div className="space-y-6">
          <h3 className="font-syne font-bold text-2xl tracking-tighter uppercase leading-none">Node Efficiency</h3>
          <div className="overflow-hidden rounded-3xl border border-outline-variant/10 bg-surface-container/50">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/20 bg-surface-container-high/40">
                  <th className="px-6 py-4 font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Model ID</th>
                  <th className="px-6 py-4 font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Metrics</th>
                  <th className="px-6 py-4 font-label text-[10px] text-on-surface-variant uppercase tracking-widest text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}><td colSpan={3} className="px-6 py-4"><div className="skeleton h-12 rounded-lg" /></td></tr>
                  ))
                  : (stats?.top_models ?? []).length === 0
                    ? <tr><td colSpan={3} className="px-6 py-20 text-center font-label text-xs text-on-surface-variant uppercase">No active nodes detected</td></tr>
                    : (stats?.top_models ?? []).map((m) => (
                      <tr
                        key={m.id}
                        className="group hover:bg-white/5 transition-colors cursor-pointer border-b border-outline-variant/5 last:border-0"
                        onClick={() => navigate(`/model/${m.id}`)}
                      >
                        <td className="px-6 py-5">
                          <span className="block font-syne font-bold text-sm uppercase tracking-tight group-hover:text-secondary transition-colors mb-1">{m.name}</span>
                          <span className="px-2 py-0.5 bg-surface-container-highest rounded font-label text-[9px] text-on-surface-variant uppercase">
                            {(m as any).category || "GENERAL"}
                          </span>
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col gap-1">
                            <Stars value={m.avg_rating ?? 0} />
                            <span className="font-label text-[10px] text-on-surface-variant">{m.actual_purchases ?? m.purchases} SALES</span>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <span className="font-label text-sm font-bold">{m.revenue} <span className="text-secondary">ETH</span></span>
                        </td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>

        {/* System telemetry + failure chart */}
        <div className="space-y-10">
          <div>
            <h3 className="font-syne font-bold text-2xl tracking-tighter uppercase leading-none mb-6">System Telemetry</h3>
            <div className="grid grid-cols-2 gap-4">
              {insightsLoading ? (
                Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl" />)
              ) : (
                <>
                  <div className="glass-card rounded-2xl p-6">
                    <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest block mb-2">Network Latency</span>
                    <div className="font-label text-2xl font-bold text-on-surface">{insights?.rpc_health.avg_latency_ms ?? 0}MS</div>
                  </div>
                  <div className="glass-card rounded-2xl p-6">
                    <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest block mb-2">TX Success Rate</span>
                    <div className="font-label text-2xl font-bold text-secondary">{insights?.rpc_health.success_rate ?? 0}%</div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-label text-xs uppercase tracking-widest mb-4">Failure Distribution</h3>
            {insights && insights.failure_reasons.length > 0 ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={insights.failure_reasons} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis dataKey="reason" type="category" width={140} tick={{ fill: "#606471", fontSize: 9, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.02)" }}
                      contentStyle={{ background: "#161923", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "10px", fontFamily: "JetBrains Mono" }}
                    />
                    <Bar dataKey="count" fill="#bd9dff" radius={[0, 4, 4, 0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-12 text-center border border-dashed border-outline-variant/20 rounded-2xl font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                No failure data points recorded in this epoch
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BUYER RETENTION ── */}
      {stats?.buyer_retention && (
        <div className="glass-card rounded-3xl p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="space-y-1">
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Repeat Buyer Signal</h3>
            <div className="font-syne font-black text-3xl tracking-tighter">
              {stats.buyer_retention.retention_rate.toFixed(1)}
              <span className="text-secondary text-xl">%</span>
            </div>
            <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
              Retention Rate
            </p>
          </div>
          <div className="flex-1 flex flex-col gap-2 max-w-sm">
            <div className="flex justify-between font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
              <span>Repeat Buyers</span>
              <span className="text-secondary">{stats.buyer_retention.repeat_buyers} / {stats.unique_buyers}</span>
            </div>
            <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-container to-secondary-container rounded-full transition-all duration-700"
                style={{ width: `${Math.min(stats.buyer_retention.retention_rate, 100).toFixed(1)}%` }}
              />
            </div>
            <p className="font-label text-[9px] text-on-surface-variant/60 uppercase tracking-widest">
              {stats.buyer_retention.repeat_buyers} users returned for additional license acquisitions
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
