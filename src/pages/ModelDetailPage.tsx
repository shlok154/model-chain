import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import TxBadge from "../components/TxBadge";
import type { Model, Transaction } from "../types";

export default function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { models, fetchModels, purchaseModel, checkAccess } = useMarketplace();
  const { address, connect } = useWallet();

  const [model, setModel] = useState<Model | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [tx, setTx] = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isPurchasing, setIsPurchasing] = useState(false);

  useEffect(() => {
    if (models.length === 0) fetchModels();
  }, [fetchModels, models.length]);

  useEffect(() => {
    const found = models.find((m) => m.id === Number(id));
    setModel(found ?? null);
  }, [models, id]);

  useEffect(() => {
    if (model && address) {
      checkAccess(model.id).then(setHasAccess);
    }
  }, [model, address, checkAccess]);

  const handlePurchase = async () => {
    if (!address) { connect(); return; }
    if (!model) return;
    setIsPurchasing(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await purchaseModel(model.id, model.priceWei);
    setTx(result);
    if (result.status === "confirmed") setHasAccess(true);
    setIsPurchasing(false);
  };

  if (!model) {
    return (
      <div className="page">
        <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div className="loading-placeholder">Loading model…</div>
      </div>
    );
  }

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>

      <div className="detail-layout">
        <div className="detail-main">
          <div className="detail-header">
            <span className="model-category">{model.category}</span>
            <h1 className="detail-title">{model.name}</h1>
            <p className="detail-desc">{model.description}</p>
          </div>

          <div className="detail-meta-grid">
            <div className="meta-item">
              <span className="meta-label">Version</span>
              <span className="meta-value">{model.version}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">License</span>
              <span className="meta-value">{model.license}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Royalty</span>
              <span className="meta-value">{model.royaltyPercent}%</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Total Buyers</span>
              <span className="meta-value">{model.purchases}</span>
            </div>
          </div>

          <div className="ipfs-block">
            <span className="meta-label">IPFS Hash</span>
            <a
              href={`https://ipfs.io/ipfs/${model.ipfsHash}`}
              target="_blank"
              rel="noreferrer"
              className="ipfs-link"
            >
              {model.ipfsHash.slice(0, 24)}…{model.ipfsHash.slice(-8)}
            </a>
          </div>

          <div className="creator-block">
            <span className="meta-label">Creator</span>
            <span className="creator-addr">{model.creator}</span>
          </div>
        </div>

        <div className="detail-sidebar">
          <div className="purchase-card">
            <p className="purchase-price">{model.price} ETH</p>
            <p className="purchase-usd">≈ ${ (parseFloat(model.price) * 2500).toFixed(2) } USD</p>

            {hasAccess ? (
              <div className="access-granted">
                <span>✓ You own this model</span>
                <a
                  href={`https://ipfs.io/ipfs/${model.ipfsHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn--primary"
                >
                  Download ↗
                </a>
              </div>
            ) : (
              <button
                className="btn btn--primary btn--full"
                onClick={handlePurchase}
                disabled={isPurchasing}
              >
                {!address
                  ? "Connect Wallet to Purchase"
                  : isPurchasing
                  ? "Processing…"
                  : `Purchase for ${model.price} ETH`}
              </button>
            )}

            <TxBadge tx={tx} />

            <div className="purchase-info">
              <p>• Instant on-chain transfer of access</p>
              <p>• IPFS-pinned model weights included</p>
              <p>• {model.royaltyPercent}% royalty to creator on resale</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
