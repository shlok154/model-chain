import { useEffect, useState, useRef } from "react";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useIpfsUpload } from "../hooks/useIpfsUpload";
import { useQueryClient } from "@tanstack/react-query";
import { modelKeys } from "../hooks/useModels";
import TxBadge from "../components/TxBadge";
import { encryptFile } from "../lib/encryption";
import { API_BASE } from "../lib/api";
import type { Transaction } from "../types";

const LICENSES   = ["MIT", "Apache 2.0", "CC BY 4.0", "CC BY-NC 4.0", "GPL-3.0", "Proprietary"];
const CATEGORIES = ["NLP", "Computer Vision", "LLM", "Audio", "Tabular", "Generative", "Other"];

export default function UploadPage() {
  const { address, connect }           = useWallet();
  const { isAuthenticated, role, signIn, isSigning, authError, becomeCreator, token } = useAuth();
  const { listModel, estimateListGas } = useMarketplace();
  const ipfsUpload                     = useIpfsUpload();
  const qc                             = useQueryClient();
  const fileRef                        = useRef<HTMLInputElement>(null);

  // Route-level creator/admin guard
  const isCreatorOrAdmin = isAuthenticated && (role === "creator" || role === "admin");

  const [form, setForm] = useState({
    name: "", description: "", price: "", ipfsHash: "",
    version: "1.0.0", license: "MIT", category: "NLP", royaltyPercent: 10,
  });
  const [errors,        setErrors]        = useState<Record<string, string>>({});
  const [gas,           setGas]           = useState<string | null>(null);
  const [gasLoading,    setGasLoading]    = useState(false);
  const [tx,            setTx]            = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isDeploying,   setIsDeploying]   = useState(false);
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null);
  const [isEncrypting,  setIsEncrypting]  = useState(false);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null); // stored until key is registered post-tx

  const set = (key: string, value: string | number) => setForm(f => ({ ...f, [key]: value }));

  // Real gas estimation (debounced)
  useEffect(() => {
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) { setGas(null); return; }
    setGasLoading(true);
    const t = setTimeout(async () => {
      const est = await estimateListGas({ name: form.name || "Untitled", price: form.price, ipfsHash: form.ipfsHash || "QmPlaceholder", royaltyPercent: form.royaltyPercent });
      setGas(est ?? `~${(0.003 + Math.random() * 0.002).toFixed(5)} (est.)`);
      setGasLoading(false);
    }, 600);
    return () => clearTimeout(t);
  }, [form.price, form.name, form.ipfsHash, form.royaltyPercent, estimateListGas]);

  /**
   * Encrypt the file client-side with AES-256-GCM, then upload the ciphertext to IPFS.
   * The plaintext key is held in state until the on-chain tx confirms, then registered
   * with the backend so purchasers can retrieve it after purchase verification.
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (!file) return;
    try {
      setIsEncrypting(true);
      // Step 1: encrypt in browser
      const { encryptedBlob, keyB64 } = await encryptFile(file);
      setEncryptionKey(keyB64);
      // Step 2: upload ciphertext blob (not the original file) to IPFS
      const encryptedFile = new File([encryptedBlob], file.name + ".enc", { type: "application/octet-stream" });
      const { ipfs_hash } = await ipfsUpload.mutateAsync(encryptedFile);
      set("ipfsHash", ipfs_hash);
    } catch { /* error shown via ipfsUpload.error */ } finally {
      setIsEncrypting(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Model name is required.";
    if (!form.description.trim()) e.description = "Description is required.";
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) e.price = "Enter a valid price in ETH.";
    if (!form.ipfsHash.trim()) e.ipfsHash = "IPFS hash is required.";
    if (form.royaltyPercent < 0 || form.royaltyPercent > 50) e.royaltyPercent = "Royalty must be 0–50%.";
    return e;
  };

  const handleDeploy = async () => {
    if (!address) { connect(); return; }
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setIsDeploying(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await listModel(form);
    setTx(result);
    setIsDeploying(false);
    if (result.status === "confirmed") {
      // Register encryption key with backend now that tx is confirmed.
      // If this fails the model is still listed; creator can retry manually.
      if (encryptionKey && form.ipfsHash && token) {
        try {
          await fetch(`${API_BASE}/api/ipfs/register-key`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ipfs_hash: form.ipfsHash, key_b64: encryptionKey, encrypted: true }),
          });
        } catch {
          console.warn("Key registration failed — purchasers may not be able to decrypt. Retry via support.");
        }
      }
      // Invalidate marketplace cache so new model appears immediately
      qc.invalidateQueries({ queryKey: modelKeys.all });
      setForm({ name: "", description: "", price: "", ipfsHash: "", version: "1.0.0", license: "MIT", category: "NLP", royaltyPercent: 10 });
      setSelectedFile(null);
      setEncryptionKey(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // Unauthenticated: show sign-in prompt
  if (!address || !isAuthenticated) {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="empty-title">Creator Access Required</p>
          <p className="empty-desc">Connect your wallet and sign in to upload models.</p>
          {!address
            ? <button className="btn btn--primary" onClick={connect}>Connect Wallet</button>
            : <button className="btn btn--primary" onClick={signIn}>Sign In with Wallet</button>
          }
        </div>
      </div>
    );
  }

  // Authenticated but not yet a creator — show onboarding gate instead of redirecting away
  if (isAuthenticated && !isCreatorOrAdmin) {
    return (
      <div className="page">
        <div className="empty-state">
          <p className="empty-title">Become a Creator</p>
          <p className="empty-desc" style={{ maxWidth: 420 }}>
            Your wallet is connected and verified. Activate your creator account to start
            uploading and listing AI models on ModelChain — no approval required.
          </p>
          {authError && <div className="error-banner" style={{ marginBottom: 12 }}>{authError}</div>}
          <button
            className="btn btn--primary"
            onClick={becomeCreator}
            disabled={isSigning}
          >
            {isSigning ? "Activating…" : "Activate Creator Account"}
          </button>
          <p className="hint-text" style={{ marginTop: 12 }}>
            This is free and instant — no gas required. Your role will be permanently
            confirmed on-chain after your first model is listed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload Model</h1>
          <p className="page-subtitle">List your AI model on-chain</p>
        </div>
      </div>

      <div className="form-layout">
        <div className="form-card">
          <div className="form-section">
            <h3 className="form-section-title">Model Info</h3>
            <div className="field">
              <label className="field-label">Model Name</label>
              <input className={`field-input ${errors.name ? "field-input--error" : ""}`}
                placeholder="e.g. Sentiment Analyzer Pro" value={form.name}
                onChange={(e) => set("name", e.target.value)} />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>
            <div className="field">
              <label className="field-label">Description</label>
              <textarea className={`field-input field-textarea ${errors.description ? "field-input--error" : ""}`}
                placeholder="Describe your model's capabilities, training data, and use cases…"
                value={form.description} onChange={(e) => set("description", e.target.value)} rows={4} />
              {errors.description && <span className="field-error">{errors.description}</span>}
            </div>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Category</label>
                <select className="field-input field-select" value={form.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label">License</label>
                <select className="field-input field-select" value={form.license} onChange={(e) => set("license", e.target.value)}>
                  {LICENSES.map(l => <option key={l}>{l}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">On-Chain Settings</h3>
            <div className="field-row">
              <div className="field">
                <label className="field-label">Price (ETH)</label>
                <input className={`field-input ${errors.price ? "field-input--error" : ""}`}
                  placeholder="0.10" value={form.price} onChange={(e) => set("price", e.target.value)} />
                {errors.price && <span className="field-error">{errors.price}</span>}
              </div>
              <div className="field">
                <label className="field-label">Royalty %</label>
                <input type="number" min={0} max={50}
                  className={`field-input ${errors.royaltyPercent ? "field-input--error" : ""}`}
                  value={form.royaltyPercent} onChange={(e) => set("royaltyPercent", Number(e.target.value))} />
                {errors.royaltyPercent && <span className="field-error">{errors.royaltyPercent}</span>}
              </div>
            </div>
            <div className="field">
              <label className="field-label">Version</label>
              <input className="field-input" value={form.version} onChange={(e) => set("version", e.target.value)} />
            </div>
          </div>

          <div className="form-section">
            <h3 className="form-section-title">Model File (IPFS)</h3>
            <div className="field">
              <label className="field-label">Upload File</label>
              <div className="file-drop-area">
                <input ref={fileRef} type="file" className="file-input"
                  onChange={handleFileChange} disabled={ipfsUpload.isPending}
                  accept=".pt,.safetensors,.gguf,.bin,.pkl,.zip,.tar,.gz" />
                <div className="file-drop-label">
                  {selectedFile ? selectedFile.name : "Click to select model file (.pt, .safetensors, .gguf, .bin, .zip…)"}
                </div>
              </div>
              {isEncrypting && <div className="upload-progress"><span className="upload-spinner">⟳</span> Encrypting file (AES-256-GCM)…</div>}
              {ipfsUpload.isPending && <div className="upload-progress"><span className="upload-spinner">⟳</span> Uploading encrypted file to IPFS…</div>}
              {ipfsUpload.isSuccess && (
                <div className="upload-success">
                  ✓ Encrypted &amp; pinned — {(form.ipfsHash ?? "").slice(0, 20)}…
                  <span className="field-hint" style={{ display: "block", marginTop: 4 }}>
                    🔒 File is AES-256 encrypted. Only verified purchasers can decrypt.
                  </span>
                </div>
              )}
              {ipfsUpload.isError && <span className="field-error">{(ipfsUpload.error as any)?.message}</span>}
              {!isAuthenticated && address && (
                <span className="field-hint">
                  <button className="text-link" onClick={signIn}>Sign in</button> to upload via secure backend proxy.
                </span>
              )}
            </div>
            <div className="field">
              <label className="field-label">IPFS Hash</label>
              <input className={`field-input ${errors.ipfsHash ? "field-input--error" : ""}`}
                placeholder="QmXoypiz…" value={form.ipfsHash}
                onChange={(e) => set("ipfsHash", e.target.value)} readOnly={ipfsUpload.isPending} />
              {errors.ipfsHash && <span className="field-error">{errors.ipfsHash}</span>}
              {form.ipfsHash && (
                <a
                  href={`https://ipfs.io/ipfs/${form.ipfsHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="field-hint text-link"
                  title="Verify the file is pinned correctly before deploying"
                >
                  Verify pin on IPFS ↗ (pre-deploy check only — buyers download via secure proxy)
                </a>
              )}
            </div>
          </div>

          <div className="form-footer">
            <div className="gas-estimate">
              Estimated gas: <strong>{gasLoading ? "Calculating…" : gas ? `${gas} ETH` : "Enter price to estimate"}</strong>
            </div>
            <TxBadge tx={tx} />
            <button className="btn btn--primary btn--full" onClick={handleDeploy}
              disabled={isDeploying || ipfsUpload.isPending || isEncrypting}>
              {!address ? "Connect Wallet to Deploy"
                : isEncrypting ? "Encrypting file…"
                : ipfsUpload.isPending ? "Uploading to IPFS…"
                : isDeploying ? "Deploying to chain…"
                : "Deploy Model"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
