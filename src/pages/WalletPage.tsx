import { useState } from "react";
import { useWallet } from "../context/WalletContext";
import { SUPPORTED_CHAINS } from "../contracts/marketplace";

export default function WalletPage() {
  const { address, balance, chainId, isConnecting, error, connect, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const chainName = chainId ? (SUPPORTED_CHAINS[chainId] ?? `Chain ${chainId}`) : null;
  const isUnsupported = chainId !== null && !SUPPORTED_CHAINS[chainId];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Wallet</h1>
          <p className="page-subtitle">Manage your Ethereum connection</p>
        </div>
      </div>

      <div className="wallet-layout">
        {error && (
          <div className="error-banner">{error}</div>
        )}

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
            <button
              className="btn btn--primary btn--lg"
              onClick={connect}
              disabled={isConnecting}
            >
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
          <div className="wallet-info-card">
            <div className="wallet-status-row">
              <span className="wallet-dot wallet-dot--lg" />
              <span className="wallet-status-text">Connected</span>
              {chainName && (
                <span className={`chain-badge ${isUnsupported ? "chain-badge--warn" : ""}`}>
                  {chainName}
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
            </div>

            <div className="wallet-actions">
              <a
                href={`https://sepolia.etherscan.io/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn--secondary"
              >
                View on Etherscan ↗
              </a>
              <button className="btn btn--danger" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
