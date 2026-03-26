import { useEffect } from "react";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import { useDashboardStats } from "../hooks/useDashboardStats";
import { useEthPrice } from "../hooks/useEthPrice";
import TxBadge from "../components/TxBadge";
import { useState } from "react";
import type { Transaction } from "../types";

export default function DashboardPage() {
  const { address } = useWallet();
  const { getEarnings, withdrawEarnings, isDemo } = useMarketplace();
  const { stats, isLoading: statsLoading, fetchStats } = useDashboardStats();
  const { toUsd } = useEthPrice();

  const [earnings, setEarnings] = useState<string>("0");
  const [tx, setTx] = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  useEffect(() => {
    if (address) {
      getEarnings().then(setEarnings);
      fetchStats(address);
    } else {
      fetchStats("demo");
    }
  }, [address, getEarnings, fetchStats]);

  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await withdrawEarnings();
    setTx(result);
    if (result.status === "confirmed") setEarnings("0");
    setIsWithdrawing(false);
  };

  const maxEth = stats ? Math.max(...stats.monthlyRevenue.map((d) => d.eth), 0.01) : 0.01;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            Your creator analytics
            {isDemo && <span className="demo-badge">Demo Data</span>}
          </p>
        </div>
      </div>

      {!address && (
        <div className="info-banner">Connect your wallet to see your real earnings.</div>
      )}

      <div className="dashboard-grid">
        {/* Stats Row */}
        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-label">Total Earned</span>
            <span className="stat-value">
              {statsLoading ? "—" : `${stats?.totalEarned ?? "0"} ETH`}
            </span>
            {stats && <span className="stat-sub">{toUsd(stats.totalEarned)}</span>}
          </div>
          <div className="stat-card">
            <span className="stat-label">Models Listed</span>
            <span className="stat-value">{statsLoading ? "—" : stats?.modelsListed ?? 0}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Sales</span>
            <span className="stat-value">{statsLoading ? "—" : stats?.totalSales ?? 0}</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg. Royalty</span>
            <span className="stat-value">{statsLoading ? "—" : `${stats?.avgRoyalty ?? 0}%`}</span>
          </div>
        </div>

        {/* Chart */}
        <div className="chart-card">
          <h3 className="card-title">Monthly Revenue (ETH)</h3>
          {statsLoading ? (
            <div className="chart-skeleton" />
          ) : (
            <div className="bar-chart">
              {(stats?.monthlyRevenue ?? []).map((d) => (
                <div key={d.month} className="bar-col">
                  <span className="bar-value">{d.eth > 0 ? d.eth : ""}</span>
                  <div className="bar" style={{ height: `${(d.eth / maxEth) * 140}px` }} />
                  <span className="bar-label">{d.month}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Withdraw */}
        <div className="withdraw-card">
          <h3 className="card-title">Available Earnings</h3>
          <p className="withdraw-amount">{earnings} ETH</p>
          <p className="withdraw-usd">{toUsd(earnings) || "Connect wallet to see balance"}</p>
          <button
            className="btn btn--primary"
            onClick={handleWithdraw}
            disabled={isWithdrawing || parseFloat(earnings) === 0 || !address}
          >
            {isWithdrawing ? "Withdrawing…" : "Withdraw Earnings"}
          </button>
          <TxBadge tx={tx} />
          {!address && <p className="hint-text">Connect wallet to withdraw.</p>}
        </div>
      </div>
    </div>
  );
}
