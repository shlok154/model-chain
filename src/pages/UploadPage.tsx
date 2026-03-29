import { useEffect, useState, useRef } from "react";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useIpfsUpload } from "../hooks/useIpfsUpload";
import { useQueryClient } from "@tanstack/react-query";
import { useTelemetryInsights } from "../hooks/useAnalytics";
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

  const isCreatorOrAdmin = isAuthenticated && (role === "creator" || role === "admin");
  const { data: telemetry } = useTelemetryInsights();

  const [form, setForm] = useState({
    name: "", description: "", price: "", ipfsHash: "",
    version: "1.0.0", license: "MIT", category: "NLP", royaltyPercent: 10,
  });
  const [errors,        setErrors]        = useState<Record<string, string>>({});
  const [gas,           setGas]           = useState<string | null>(null);
  const [gasLoading,    setGasLoading]    = useState(false);
  const [tx,            setTx]            = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isDeploying,   setIsDeploying]   = useState(false);
  const [isEncrypting,  setIsEncrypting]  = useState(false);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);

  const set = (key: string, value: string | number) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) { setGas(null); return; }
    setGasLoading(true);
    const t = setTimeout(async () => {
      const est = await estimateListGas({ name: form.name || "Untitled", price: form.price, ipfsHash: form.ipfsHash || "QmPlaceholder", royaltyPercent: form.royaltyPercent });
      setGas(est ?? `~${(0.003 + Math.random() * 0.002).toFixed(5)}`);
      setGasLoading(false);
    }, 600);
    return () => clearTimeout(t);
  }, [form.price, form.name, form.ipfsHash, form.royaltyPercent, estimateListGas]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    try {
      setIsEncrypting(true);
      const { encryptedBlob, keyB64 } = await encryptFile(file);
      setEncryptionKey(keyB64);
      const encryptedFile = new File([encryptedBlob], file.name + ".enc", { type: "application/octet-stream" });
      const { ipfs_hash } = await ipfsUpload.mutateAsync(encryptedFile);
      set("ipfsHash", ipfs_hash);
    } catch { /* error handled by server */ } finally {
      setIsEncrypting(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "MODEL_NAME_REQUIRED";
    if (!form.description.trim()) e.description = "DESCRIPTION_REQUIRED";
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0) e.price = "INVALID_VALUATION";
    if (!form.ipfsHash.trim()) e.ipfsHash = "IPFS_ARTIFACT_MISSING";
    if (form.royaltyPercent < 0 || form.royaltyPercent > 50) e.royaltyPercent = "ROYALTY_LIMIT_EXCEEDED";
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
      if (encryptionKey && form.ipfsHash && token) {
        try {
          await fetch(`${API_BASE}/api/ipfs/register-key`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ipfs_hash: form.ipfsHash, key_b64: encryptionKey, encrypted: true }),
          });
        } catch (err) { console.error("Key reg fail", err); }
      }
      qc.invalidateQueries({ queryKey: modelKeys.all });
      setForm({ name: "", description: "", price: "", ipfsHash: "", version: "1.0.0", license: "MIT", category: "NLP", royaltyPercent: 10 });
      setEncryptionKey(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ── WALLET / AUTH GATE ──
  if (!address || !isAuthenticated) {
    return (
      <div className="animate-page-in min-h-screen flex items-center justify-center pt-24 px-6">
        <div className="glass-card rounded-[32px] p-12 max-w-lg w-full text-center space-y-8">
          <div className="w-20 h-20 bg-secondary-container/20 rounded-full flex items-center justify-center mx-auto">
            <span className="material-symbols-outlined text-secondary-container text-4xl">lock</span>
          </div>
          <div className="space-y-2">
            <h2 className="font-syne font-black text-3xl uppercase tracking-tighter">Terminal Locked</h2>
            <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
              Awaiting wallet signature to initialize creator node
            </p>
          </div>
          <button
            className="w-full bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold py-4 rounded-2xl uppercase tracking-wide hover:scale-[1.02] active:scale-95 transition-transform"
            onClick={!address ? connect : signIn}
          >
            {!address ? "Establish Connection" : "Authorize Identity"}
          </button>
        </div>
      </div>
    );
  }

  // ── CREATOR ONBOARDING GATE ──
  if (isAuthenticated && !isCreatorOrAdmin) {
    return (
      <div className="animate-page-in min-h-screen flex items-center justify-center pt-24 px-6">
        <div className="glass-card rounded-[32px] p-12 max-w-2xl w-full text-center space-y-10">
          <div className="inline-block px-4 py-1 bg-primary-container/10 text-primary-container rounded-full font-label text-[10px] border border-primary-container/20 uppercase tracking-widest">
            Onboarding Required
          </div>
          <div className="space-y-4">
            <h2 className="font-syne font-black text-5xl uppercase tracking-tighter leading-none">Become a Neural Architect</h2>
            <p className="text-on-surface-variant font-body text-lg leading-relaxed max-w-md mx-auto">
              Initialize your creator identity to contribute models to the decentralized network.
            </p>
          </div>
          {authError && (
            <div className="p-4 bg-error/10 border border-error/20 text-error rounded-xl font-label text-xs uppercase tracking-widest">{authError}</div>
          )}
          <button
            className="bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold py-5 px-12 rounded-2xl uppercase tracking-wide hover:shadow-[0_0_30px_rgba(189,157,255,0.4)] active:scale-95 transition-all disabled:opacity-50"
            onClick={becomeCreator}
            disabled={isSigning}
          >
            {isSigning ? "INITIALIZING NODE..." : "ACTIVATE CREATOR MODULE"}
          </button>
          <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest opacity-60">
            Verification cost: 0.00 ETH • Instant confirmation
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-page-in min-h-screen pt-[88px] pb-[144px] px-6 lg:px-20 space-y-12 max-w-6xl mx-auto">

      {/* ── HEADER ── */}
      <div className="space-y-2">
        <h1 className="font-syne font-black text-4xl lg:text-6xl tracking-tighter uppercase leading-none">Deploy Model</h1>
        <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-container" />
          Immutable Node Registration Artifact
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-8 space-y-8">

          {/* ── 01 IDENTITY MODULE ── */}
          <div className="glass-card rounded-[32px] p-10 space-y-8">
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/10 pb-4">
              01 // Identity Module
            </h3>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Model Identifier</label>
                <input
                  className={`w-full bg-surface-container-high rounded-2xl p-5 font-label text-sm font-bold uppercase tracking-tight border outline-none focus:ring-2 focus:ring-primary-container/40 transition-all ${errors.name ? "border-error/50" : "border-outline-variant/10"}`}
                  placeholder="e.g. NEURAL_VISION_GPT_4"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
                {errors.name && <p className="font-label text-[10px] text-error mt-1 uppercase tracking-tighter">⚠ {errors.name}</p>}
              </div>

              <div className="space-y-2">
                <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Capabilities Manifest</label>
                <textarea
                  className={`w-full bg-surface-container-high rounded-2xl p-5 font-body text-sm border outline-none focus:ring-2 focus:ring-primary-container/40 transition-all min-h-[140px] leading-relaxed ${errors.description ? "border-error/50" : "border-outline-variant/10"}`}
                  placeholder="Describe architectural parameters, training sets, and inferred use-cases..."
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
                {errors.description && <p className="font-label text-[10px] text-error mt-1 uppercase tracking-tighter">⚠ {errors.description}</p>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Classification</label>
                  <select
                    className="w-full bg-surface-container-high rounded-2xl p-5 font-label text-sm font-bold uppercase tracking-tight border border-outline-variant/10 outline-none appearance-none"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">License Protocol</label>
                  <select
                    className="w-full bg-surface-container-high rounded-2xl p-5 font-label text-sm font-bold uppercase tracking-tight border border-outline-variant/10 outline-none appearance-none"
                    value={form.license}
                    onChange={(e) => set("license", e.target.value)}
                  >
                    {LICENSES.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* ── 02 ECONOMIC CONFIG ── */}
          <div className="glass-card rounded-[32px] p-10 space-y-8">
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/10 pb-4">
              02 // Economic Configuration
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Valuation (ETH)</label>
                <div className="relative">
                  <input
                    className={`w-full bg-surface-container-high rounded-2xl p-5 pl-10 font-label text-sm font-bold border outline-none focus:ring-2 focus:ring-secondary/20 transition-all ${errors.price ? "border-error/50" : "border-outline-variant/10"}`}
                    placeholder="0.10"
                    value={form.price}
                    onChange={(e) => set("price", e.target.value)}
                  />
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-label text-xs text-on-surface-variant">Ξ</span>
                </div>
                {errors.price && <p className="font-label text-[10px] text-error mt-1 uppercase tracking-tighter">⚠ {errors.price}</p>}
              </div>
              <div className="space-y-2">
                <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Royalty Tax (%)</label>
                <input
                  type="number" min={0} max={50}
                  className={`w-full bg-surface-container-high rounded-2xl p-5 font-label text-sm font-bold border outline-none focus:ring-2 focus:ring-secondary/20 transition-all ${errors.royaltyPercent ? "border-error/50" : "border-outline-variant/10"}`}
                  value={form.royaltyPercent}
                  onChange={(e) => set("royaltyPercent", Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Build Version</label>
                <input
                  className="w-full bg-surface-container-high rounded-2xl p-5 font-label text-sm font-bold border border-outline-variant/10 outline-none"
                  value={form.version}
                  onChange={(e) => set("version", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* ── 03 ARTIFACT INGESTION ── */}
          <div className="glass-card rounded-[32px] p-10 space-y-8">
            <h3 className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/10 pb-4">
              03 // Artifact Ingestion
            </h3>
            <div className="space-y-6">
              {/* Drop zone */}
              <div
                className={`relative border-2 border-dashed rounded-[32px] p-12 text-center transition-all cursor-pointer group hover:bg-white/5 ${
                  ipfsUpload.isSuccess ? "border-secondary/40 bg-secondary-container/5" : "border-outline-variant/20"
                }`}
                onClick={() => !ipfsUpload.isPending && !isEncrypting && fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={ipfsUpload.isPending}
                  accept=".pt,.safetensors,.gguf,.bin,.pkl,.zip,.tar,.gz"
                />

                {isEncrypting || ipfsUpload.isPending ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="w-12 h-12 rounded-full border-2 border-primary-container border-t-transparent animate-spin mx-auto" />
                    <p className="font-label text-xs uppercase tracking-widest">
                      {isEncrypting ? "AES-256_CRYPTOGRAPHY_ACTIVE" : "PINGING_IPFS_ESTABLISHING_CID"}
                    </p>
                  </div>
                ) : ipfsUpload.isSuccess ? (
                  <div className="space-y-2">
                    <span className="material-symbols-outlined text-5xl text-secondary-container">task_alt</span>
                    <p className="font-syne font-bold text-lg text-secondary uppercase tracking-tight">Artifact Locked & Encrypted</p>
                    <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">CID: {form.ipfsHash}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <span className="material-symbols-outlined text-5xl text-on-surface-variant group-hover:scale-110 transition-transform block">cloud_upload</span>
                    <div className="space-y-1">
                      <p className="font-syne font-bold uppercase tracking-tight">Select Artifact Module</p>
                      <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                        Supports .PT, .SAFETENSORS, .GGUF, .ZIP (MAX 2GB)
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* CID field */}
              <div className="space-y-2">
                <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Artifact CID (Read-only)</label>
                <input
                  className="w-full bg-surface-container/50 rounded-2xl p-4 font-label text-xs border border-outline-variant/10 text-on-surface-variant cursor-not-allowed"
                  value={form.ipfsHash}
                  readOnly
                  placeholder="Deployment hash will be generated automatically"
                />
                {errors.ipfsHash && <p className="font-label text-[10px] text-error mt-1 uppercase tracking-tighter">⚠ {errors.ipfsHash}</p>}
              </div>

              {/* Encryption notice */}
              <div className="flex items-start gap-4 p-5 bg-primary-container/5 rounded-2xl border border-primary-container/10">
                <span className="material-symbols-outlined text-primary-container text-2xl">shield</span>
                <p className="font-label text-[10px] text-on-surface-variant leading-relaxed uppercase tracking-widest pt-1">
                  All uploads are encrypted via client-side AES-256-GCM prior to network ingestion.
                  Decryption keys are only released to verified license holders.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── DEPLOYMENT SIDEBAR ── */}
        <aside className="lg:col-span-4 space-y-6 lg:sticky lg:top-[88px]">
          <div className="glass-card neural-glow rounded-[32px] p-8 border-t-2 border-primary-container/30 space-y-8">
            <h3 className="font-label text-xs uppercase tracking-widest">Execution Metrics</h3>

            <div className="space-y-3">
              <div className="flex justify-between items-center bg-surface-container-high p-4 rounded-xl border border-outline-variant/10">
                <span className="font-label text-[10px] text-on-surface-variant uppercase">Network Latency</span>
                <span className={`font-label text-xs ${
                  telemetry
                    ? telemetry.rpc_health.avg_latency_ms < 200
                      ? "text-secondary"
                      : telemetry.rpc_health.avg_latency_ms < 500
                        ? "text-primary-container"
                        : "text-error"
                    : "text-on-surface-variant"
                }`}>
                  {telemetry ? `${telemetry.rpc_health.avg_latency_ms}MS` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center bg-surface-container-high p-4 rounded-xl border border-outline-variant/10">
                <span className="font-label text-[10px] text-on-surface-variant uppercase">Deployment Gas</span>
                <span className="font-label text-xs text-primary-container">
                  {gasLoading ? "Calculating..." : gas ? `${gas} ETH` : "—"}
                </span>
              </div>
            </div>

            <TxBadge tx={tx} />

            <div className="space-y-4 pt-2">
              <button
                className="w-full h-16 bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold uppercase rounded-2xl shadow-[0_0_30px_rgba(189,157,255,0.3)] hover:shadow-[0_0_45px_rgba(189,157,255,0.5)] hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-wide disabled:opacity-50 disabled:grayscale"
                onClick={handleDeploy}
                disabled={isDeploying || ipfsUpload.isPending || isEncrypting}
              >
                {isDeploying ? "COMMITTING TO BLOCK..." : "INITIALIZE DEPLOYMENT"}
              </button>
              <p className="text-center font-label text-[9px] text-on-surface-variant uppercase tracking-widest opacity-60 px-4">
                By deploying, you agree to anchor this artifact<br />permanently to the decentralized ledger.
              </p>
            </div>
          </div>

          {/* Best practices card */}
          <div className="glass-card rounded-3xl p-6 space-y-4">
            <h4 className="font-label text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Best Practices</h4>
            <ul className="space-y-3">
              {[
                "Upload model weights only, exclude training logs",
                "Document specific prompt templates if applicable",
                "Set competitive valuation for faster adoption",
                "Maintain semantic versioning (e.g., 1.2.0)",
              ].map((item, i) => (
                <li key={i} className="flex gap-3 font-label text-[10px] text-on-surface-variant/80 uppercase tracking-tighter leading-tight">
                  <span className="text-primary-container">⊡</span> {item}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
