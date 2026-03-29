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
      <div className="inline-flex items-center gap-3 px-4 py-2 bg-primary/10 text-primary rounded-xl text-[10px] font-mono tracking-widest border border-primary/20 shadow-lg shadow-primary/5 animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
        <span>TRANSACTION_SEALING...</span>
      </div>
    );
  }

  if (tx.status === "confirmed") {
    return (
      <div className="flex flex-col gap-3">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-secondary/10 text-secondary rounded-xl text-[10px] font-mono tracking-widest border border-secondary/20 shadow-lg shadow-secondary/5">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
          <span>✓ CONFIRMED_ON_CHAIN</span>
        </div>
        {tx.hash && !tx.hash.includes("demo") && (
          <a
            href={`${explorerBase}/${tx.hash}`}
            target="_blank"
            rel="noreferrer"
            className="text-[9px] font-mono text-on-surface-variant hover:text-secondary hover:underline underline-offset-4 transition-all px-2 uppercase tracking-widest opacity-70 hover:opacity-100"
          >
            VIEW_IN_SCANNER ↗
          </a>
        )}
      </div>
    );
  }

  if (tx.status === "failed") {
    return (
      <div className="inline-flex items-center gap-3 px-4 py-2 bg-red-500/10 text-red-400 rounded-xl text-[10px] font-mono tracking-widest border border-red-500/20 shadow-lg shadow-red-500/5">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        <span>✕ {tx.error?.toUpperCase().replace(/\s+/g, "_") ?? "EXECUTION_ABORTED"}</span>
      </div>
    );
  }

  return null;
}
