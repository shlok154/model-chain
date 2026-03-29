import { useTelemetryInsights } from "../hooks/useAnalytics";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie,
} from "recharts";

function SkeletonCard({ height = 80 }: { height?: number }) {
  return <div className="skeleton-card" style={{ height }} />;
}

const FUNNEL_COLORS = ["var(--accent)", "#6366f1", "var(--green)", "#06b6d4"];

export default function InsightsPage() {
  const { data: insights, isLoading, isError } = useTelemetryInsights();

  const funnelData = insights
    ? [
        { stage: "Viewed", count: insights.conversion_funnel.viewed },
        { stage: "Clicked", count: insights.conversion_funnel.clicked },
        { stage: "Purchased", count: insights.conversion_funnel.purchased },
        { stage: "Downloaded", count: insights.conversion_funnel.downloaded },
      ]
    : [];

  const txPieData = insights
    ? [
        { name: "Success", value: insights.tx_success_rate, color: "var(--green)" },
        { name: "Failed", value: insights.tx_failure_rate, color: "var(--red)" },
      ]
    : [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="page-subtitle">Telemetry-driven product analytics</p>
        </div>
      </div>

      {isError && (
        <div className="error-banner">Could not load telemetry data — showing demo insights.</div>
      )}

      <div className="dashboard-grid">
        {/* ── Conversion Funnel ──────────────────────────────────────────── */}
        <div className="chart-card">
          <h3 className="card-title">Conversion Funnel</h3>
          <p className="card-subtitle">Viewed → Clicked → Purchased → Downloaded</p>
          {isLoading ? (
            <SkeletonCard height={200} />
          ) : (
            <div style={{ marginTop: 16 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={funnelData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="stage"
                    tick={{ fill: "var(--text-2)", fontSize: 13, fontWeight: 600 }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} barSize={48}>
                    {funnelData.map((_, i) => (
                      <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Dropoff percentages */}
              {insights && (
                <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
                  {funnelData.slice(1).map((d, i) => {
                    const prev = funnelData[i].count;
                    const dropoff = prev > 0 ? ((1 - d.count / prev) * 100).toFixed(1) : "0";
                    return (
                      <span key={d.stage} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {funnelData[i].stage} → {d.stage}: <strong style={{ color: "var(--red)" }}>-{dropoff}%</strong>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Two-column: Success Rate + RPC Health ───────────────────────── */}
        <div className="dashboard-bottom">
          {/* Transaction Success Rate */}
          <div className="chart-card" style={{ flex: 1 }}>
            <h3 className="card-title">Transaction Success Rate</h3>
            {isLoading ? (
              <SkeletonCard height={200} />
            ) : insights ? (
              <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={txPieData}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={75}
                      dataKey="value"
                      startAngle={90} endAngle={-270}
                      strokeWidth={0}
                    >
                      {txPieData.map((d, i) => (
                        <Cell key={i} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  <p style={{ fontSize: 36, fontWeight: 700, color: "var(--green)", lineHeight: 1 }}>
                    {insights.tx_success_rate}%
                  </p>
                  <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                    Success rate ({insights.tx_total} total tx)
                  </p>
                  <div style={{ marginTop: 12, display: "flex", gap: 16 }}>
                    <div>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--green)", marginRight: 6 }} />
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>Confirmed</span>
                    </div>
                    <div>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--red)", marginRight: 6 }} />
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>Failed</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* RPC Health */}
          <div className="chart-card" style={{ flex: 1 }}>
            <h3 className="card-title">RPC Health</h3>
            {isLoading ? (
              <SkeletonCard height={140} />
            ) : insights ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 8 }}>
                {/* Success rate bar */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>Alchemy Provider</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: insights.rpc_health.success_rate >= 95 ? "var(--green)" : "var(--red)" }}>
                      {insights.rpc_health.success_rate}% success
                    </span>
                  </div>
                  <div style={{ height: 8, background: "var(--bg-3)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${insights.rpc_health.success_rate}%`,
                      background: insights.rpc_health.success_rate >= 95
                        ? "linear-gradient(90deg, var(--green), #34d399)"
                        : "linear-gradient(90deg, var(--red), #f87171)",
                      borderRadius: 4,
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", display: "block" }}>Avg Latency</span>
                    <span style={{ fontSize: 20, fontWeight: 700 }}>{insights.rpc_health.avg_latency_ms}ms</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", display: "block" }}>Total Calls</span>
                    <span style={{ fontSize: 20, fontWeight: 700 }}>{insights.rpc_health.total_calls.toLocaleString()}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", display: "block" }}>Errors</span>
                    <span style={{ fontSize: 20, fontWeight: 700, color: "var(--red)" }}>{insights.rpc_health.errors}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Failure Reasons Detail ───────────────────────────────────────── */}
        <div className="chart-card">
          <h3 className="card-title">Failure Breakdown</h3>
          {isLoading ? (
            <SkeletonCard height={120} />
          ) : insights && insights.failure_reasons.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(120, insights.failure_reasons.length * 44)}>
              <BarChart data={insights.failure_reasons} layout="vertical" margin={{ top: 8, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category" dataKey="reason" width={200}
                  tick={{ fill: "var(--text-2)", fontSize: 12 }} axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">No failures recorded. Great job!</div>
          )}
        </div>
      </div>
    </div>
  );
}
