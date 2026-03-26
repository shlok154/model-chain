import { useEffect, useState } from "react";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import TxBadge from "../components/TxBadge";
import type { Transaction } from "../types";

const LICENSES = ["MIT", "Apache 2.0", "CC BY 4.0", "CC BY-NC 4.0", "GPL-3.0", "Proprietary"];
const CATEGORIES = ["NLP", "Computer Vision", "LLM", "Audio", "Tabular", "Generative", "Other"];

export default function UploadPage() {
  const { address, connect } = useWallet();
  const { listModel, isDemo } = useMarketplace();

  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    ipfsHash: "",
    version: "1.0.0",
    license: "MIT",
    category: "NLP",
    royaltyPercent: 10,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [gas, setGas] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    setGas((0.003 + Math.random() * 0.002).toFixed(5));
  }, []);

  const set = (key: string, value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Model name is required.";
    if (!form.description.trim()) e.description = "Description is required.";
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0)
      e.price = "Enter a valid price in ETH.";
    if (!form.ipfsHash.trim()) e.ipfsHash = "IPFS hash is required.";
    if (form.royaltyPercent < 0 || form.royaltyPercent > 50)
      e.royaltyPercent = "Royalty must be between 0 and 50%.";
    return e;
  };

  const handleDeploy = async () => {
    if (!address) { connect(); return; }
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setIsDeploying(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await listModel(form);
    setTx(result);
    setIsDeploying(false);
    if (result.status === "confirmed") {
      setForm({ name: "", description: "", price: "", ipfsHash: "", version: "1.0.0", license: "MIT", category: "NLP", royaltyPercent: 10 });
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload Model</h1>
          <p className="page-subtitle">
            List your AI model on-chain
            {isDemo && <span className="demo-badge">Demo Mode</span>}
          </p>
        </div>
      </div>

      <div className="form-layout">
        <div className="form-card">
          <div className="form-section">
            <h3 className="form-section-title">Model Info</h3>

            <div className="field">
              <label className="field-label">Model Name</label>
              <input
                className={`field-input ${errors.name ? "field-input--error" : ""}`}
                placeholder="e.g. Sentiment Analyzer Pro"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>

            <div className="field">
              <label className="field-label">Description</label>
              <textarea
                className={`field-input field-textarea ${errors.description ? "field-input--error" : ""}`}
                placeholder="Describe your model's capabilities, training data, and use cases…"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
              />
              {errors.description && <span className="field-error">{errors.description}</span>}
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label">Category</label>
                <select className="field-input field-select" value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">License</label>
                <select className="field-input field-select" value={form.license} onChange={(e) => set("license", e.target.value)}>
                  {LICENSES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">On-Chain Settings</h3>

            <div className="field-row">
              <div className="field">
                <label className="field-label">Price (ETH)</label>
                <input
                  className={`field-input ${errors.price ? "field-input--error" : ""}`}
                  placeholder="0.10"
                  value={form.price}
                  onChange={(e) => set("price", e.target.value)}
                />
                {errors.price && <span className="field-error">{errors.price}</span>}
              </div>
              <div className="field">
                <label className="field-label">Royalty %</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  className={`field-input ${errors.royaltyPercent ? "field-input--error" : ""}`}
                  value={form.royaltyPercent}
                  onChange={(e) => set("royaltyPercent", Number(e.target.value))}
                />
                {errors.royaltyPercent && <span className="field-error">{errors.royaltyPercent}</span>}
              </div>
            </div>

            <div className="field">
              <label className="field-label">IPFS Hash</label>
              <input
                className={`field-input ${errors.ipfsHash ? "field-input--error" : ""}`}
                placeholder="QmXoypiz…"
                value={form.ipfsHash}
                onChange={(e) => set("ipfsHash", e.target.value)}
              />
              {errors.ipfsHash && <span className="field-error">{errors.ipfsHash}</span>}
              <span className="field-hint">Upload your model to IPFS first (e.g. via Pinata or web3.storage)</span>
            </div>

            <div className="field">
              <label className="field-label">Version</label>
              <input
                className="field-input"
                value={form.version}
                onChange={(e) => set("version", e.target.value)}
              />
            </div>
          </div>

          <div className="form-footer">
            <div className="gas-estimate">
              Estimated gas: <strong>{gas ? `${gas} ETH` : "Calculating…"}</strong>
            </div>
            <TxBadge tx={tx} />
            <button
              className="btn btn--primary btn--full"
              onClick={handleDeploy}
              disabled={isDeploying}
            >
              {!address
                ? "Connect Wallet to Deploy"
                : isDeploying
                ? "Deploying to chain…"
                : "Deploy Model"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
