import { useTelemetryInsights } from "../hooks/useAnalytics";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie,
} from "recharts";

const FUNNEL_COLORS = ["#bd9dff", "#6366f1", "#00eed3", "#06b6d4"];

export default function InsightsPage() {
  const { data: insights, isLoading, isError } = useTelemetryInsights();

  const funnelData = insights
    ? [
        { stage: "Viewed",     count: insights.conversion_funnel.viewed },
        { stage: "Clicked",    count: insights.conversion_funnel.clicked },
        { stage: "Purchased",  count: insights.conversion_funnel.purchased },
        { stage: "Downloaded", count: insights.conversion_funnel.downloaded },
      ]
    : [];

  const txPieData = insights
    ? [
        { name: "Success", value: insights.tx_success_rate,  color: "#00eed3" },
        { name: "Failed",  value: insights.tx_failure_rate, color: "#ff5555" },
      ]
    : [];

  return (
    <div className="animate-page-in min-h-screen pt-[88px] pb-[144px] px-6 lg:px-20 space-y-12 max-w-7xl mx-auto">

      {/* ── HEADER ── */}
      <div className="space-y-2">
        <h1 className="font-syne font-black text-4xl lg:text-6xl tracking-tighter uppercase leading-none">Telemetry</h1>
        <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-container animate-pulse" />
          Product Analytics &amp; Network Performance
        </p>
      </div>

      {isError && (
        <div className="p-4 bg-error/10 border border-error/20 text-error rounded-2xl font-label text-xs uppercase tracking-widest">
          ⚠ DATA_SYNC_FAILURE: Displaying cached telemetry modules
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ── ACQUISITION FUNNEL ── */}
        <div className="lg:col-span-12 glass-card rounded-[32px] p-10 space-y-10">
          <div className="flex justify-between items-end border-b border-outline-variant/10 pb-6">
            <div className="space-y-1">
              <h3 className="font-syne font-bold text-xl uppercase tracking-tight">Acquisition Funnel</h3>
              <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                Viewed → Clicked → Purchased → Downloaded
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="skeleton h-[280px] rounded-3xl" />
          ) : (
            <div className="space-y-8">
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      {FUNNEL_COLORS.map((color, i) => (
                        <linearGradient key={`grad-${i}`} id={`barGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={color} stopOpacity={1} />
                          <stop offset="100%" stopColor={color} stopOpacity={0.3} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis
                      dataKey="stage"
                      tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "JetBrains Mono", fontWeight: 700 }}
                      axisLine={false} tickLine={false} dy={10}
                    />
                    <YAxis
                      tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10, fontFamily: "JetBrains Mono" }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.03)" }}
                      contentStyle={{ background: "#161923", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", fontSize: "12px", fontFamily: "JetBrains Mono", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}
                      itemStyle={{ color: "#fff", fontWeight: "bold" }}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]} barSize={64}>
                      {funnelData.map((_, i) => (
                        <Cell key={i} fill={`url(#barGrad-${i})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Dropoff metrics */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-outline-variant/10">
                {funnelData.slice(1).map((d, i) => {
                  const prev    = funnelData[i].count;
                  const dropoff = prev > 0 ? ((1 - d.count / prev) * 100).toFixed(1) : "0";
                  return (
                    <div key={d.stage} className="glass-card rounded-xl p-4 space-y-1">
                      <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">
                        {funnelData[i].stage} → {d.stage}
                      </span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-label text-lg font-bold text-error">-{dropoff}%</span>
                        <span className="font-label text-[10px] text-on-surface-variant uppercase opacity-50">Dropoff</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── ON-CHAIN HEALTH ── */}
        <div className="lg:col-span-6 glass-card rounded-[32px] p-10 space-y-8">
          <h3 className="font-syne font-bold text-xl uppercase tracking-tight">On-Chain Health</h3>

          {isLoading ? (
            <div className="skeleton h-[200px] rounded-3xl" />
          ) : insights ? (
            <div className="flex flex-col md:flex-row items-center gap-10">
              <div className="relative flex-shrink-0">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={txPieData}
                      cx="50%" cy="50%"
                      innerRadius={65} outerRadius={85}
                      dataKey="value"
                      startAngle={90} endAngle={-270}
                      strokeWidth={0}
                      paddingAngle={4}
                    >
                      {txPieData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-label text-3xl font-bold text-secondary">{insights.tx_success_rate}%</span>
                  <span className="font-label text-[8px] text-on-surface-variant uppercase tracking-widest">Success</span>
                </div>
              </div>

              <div className="space-y-6 flex-1">
                <div className="space-y-1">
                  <div className="font-label text-4xl font-bold tracking-tighter text-on-surface">{insights.tx_total}</div>
                  <div className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">Total Transaction Artifacts</div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-secondary" />
                    <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant">
                      Confirmed: {((insights.tx_success_rate / 100) * insights.tx_total).toFixed(0)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-error" />
                    <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant">
                      Reverted: {((insights.tx_failure_rate / 100) * insights.tx_total).toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── PROVIDER LATENCY ── */}
        <div className="lg:col-span-6 glass-card rounded-[32px] p-10 space-y-8">
          <h3 className="font-syne font-bold text-xl uppercase tracking-tight">Provider Latency</h3>

          {isLoading ? (
            <div className="skeleton h-[200px] rounded-3xl" />
          ) : insights ? (
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Alchemy Cloud Connectivity</span>
                    <div className="font-label text-2xl font-bold flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${insights.rpc_health.success_rate >= 95 ? "bg-secondary animate-pulse" : "bg-error"}`} />
                      {insights.rpc_health.success_rate}% UPTIME
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Avg Latency</span>
                    <div className="font-label text-2xl font-bold text-primary-container">{insights.rpc_health.avg_latency_ms}MS</div>
                  </div>
                </div>

                <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-1000 ${insights.rpc_health.success_rate >= 95 ? "bg-secondary" : "bg-error"}`}
                    style={{ width: `${insights.rpc_health.success_rate}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 pt-4 border-t border-outline-variant/10">
                <div className="space-y-1">
                  <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">Inbound RPC Requests</span>
                  <div className="font-label text-xl font-bold">{insights.rpc_health.total_calls.toLocaleString()}</div>
                </div>
                <div className="space-y-1">
                  <span className="font-label text-[9px] text-on-surface-variant uppercase tracking-widest">Dropped Packets</span>
                  <div className="font-label text-xl font-bold text-error">{insights.rpc_health.errors}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── FAILURE BREAKDOWN ── */}
        <div className="lg:col-span-12 glass-card rounded-[32px] p-10 space-y-8">
          <div className="flex justify-between items-center">
            <h3 className="font-syne font-bold text-xl uppercase tracking-tight">Failure Reason Breakdown</h3>
            <span className="px-3 py-1 bg-error/10 text-error rounded-full font-label text-[9px] border border-error/20 uppercase tracking-widest">
              Exception Analytics
            </span>
          </div>

          {isLoading ? (
            <div className="skeleton h-[140px] rounded-3xl" />
          ) : insights && insights.failure_reasons.length > 0 ? (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={insights.failure_reasons} layout="vertical" margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category" dataKey="reason" width={180}
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "JetBrains Mono" }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.03)" }}
                    contentStyle={{ background: "#161923", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px", fontSize: "12px", fontFamily: "JetBrains Mono" }}
                  />
                  <Bar dataKey="count" fill="rgba(255, 85, 85, 0.35)" radius={[0, 8, 8, 0]} barSize={24}>
                    {insights.failure_reasons.map((_, i) => (
                      <Cell key={i} stroke="#ff5555" strokeWidth={1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-20 text-center space-y-4 bg-secondary-container/5 rounded-[32px] border border-dashed border-secondary/10">
              <span className="material-symbols-outlined text-5xl text-secondary block">check_circle</span>
              <p className="font-label text-xs text-on-surface-variant uppercase tracking-widest">
                System stabilized. No exceptions recorded in trace.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
