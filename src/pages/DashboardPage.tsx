import { useEffect, useState } from "react";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import TxBadge from "../components/TxBadge";
import type { Transaction } from "../types";

const MONTHLY_DATA = [
  { month: "Oct", eth: 0.18 },
  { month: "Nov", eth: 0.31 },
  { month: "Dec", eth: 0.52 },
  { month: "Jan", eth: 0.44 },
  { month: "Feb", eth: 0.78 },
  { month: "Mar", eth: 1.24 },
];

const MAX_ETH = Math.max(...MONTHLY_DATA.map((d) => d.eth));

export default function DashboardPage() {
  const { address } = useWallet();
  const { getEarnings, withdrawEarnings, isDemo } = useMarketplace();
  const [earnings, setEarnings] = useState<string>("0");
  const [tx, setTx] = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  useEffect(() => {
    if (address) getEarnings().then(setEarnings);
  }, [address, getEarnings]);

  const handleWithdraw = async () => {
    setIsWithdrawing(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await withdrawEarnings();
    setTx(result);
    if (result.status === "confirmed") setEarnings("0");
    setIsWithdrawing(false);
  };

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
            <span className="stat-value">3.47 ETH</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Models Listed</span>
            <span className="stat-value">4</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Total Sales</span>
            <span className="stat-value">892</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Avg. Royalty</span>
            <span className="stat-value">11.25%</span>
          </div>
        </div>

        {/* Chart */}
        <div className="chart-card">
          <h3 className="card-title">Monthly Revenue (ETH)</h3>
          <div className="bar-chart">
            {MONTHLY_DATA.map((d) => (
              <div key={d.month} className="bar-col">
                <span className="bar-value">{d.eth}</span>
                <div
                  className="bar"
                  style={{ height: `${(d.eth / MAX_ETH) * 140}px` }}
                />
                <span className="bar-label">{d.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Withdraw */}
        <div className="withdraw-card">
          <h3 className="card-title">Available Earnings</h3>
          <p className="withdraw-amount">{earnings} ETH</p>
          <p className="withdraw-usd">≈ ${(parseFloat(earnings) * 2500).toFixed(2)} USD</p>
          <button
            className="btn btn--primary"
            onClick={handleWithdraw}
            disabled={isWithdrawing || parseFloat(earnings) === 0 || !address}
          >
            {isWithdrawing ? "Withdrawing…" : "Withdraw Earnings"}
          </button>
          <TxBadge tx={tx} />
          {!address && (
            <p className="hint-text">Connect wallet to withdraw.</p>
          )}
        </div>
      </div>
    </div>
  );
}
