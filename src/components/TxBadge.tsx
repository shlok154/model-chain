import type { Transaction } from "../types";

interface Props {
  tx: Transaction;
  explorerBase?: string;
}

export default function TxBadge({
  tx,
  explorerBase = "https://sepolia.etherscan.io/tx",
}: Props) {
  if (tx.status === "idle") return null;

  if (tx.status === "pending") {
    return (
      <div className="tx-badge tx-badge--pending">
        <span className="tx-spinner" />
        <span>Transaction pending…</span>
      </div>
    );
  }

  if (tx.status === "confirmed") {
    return (
      <div className="tx-badge tx-badge--confirmed">
        <span>✓ Confirmed</span>
        {tx.hash && !tx.hash.includes("demo") && (
          <a
            href={`${explorerBase}/${tx.hash}`}
            target="_blank"
            rel="noreferrer"
            className="tx-link"
          >
            View on Etherscan ↗
          </a>
        )}
      </div>
    );
  }

  if (tx.status === "failed") {
    return (
      <div className="tx-badge tx-badge--failed">
        <span>✕ {tx.error ?? "Transaction failed"}</span>
      </div>
    );
  }

  return null;
}
