import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useModel, useModelReviews, useSubmitReview } from "../hooks/useModels";
import { useOwnership } from "../hooks/useOwnership";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useEthPrice } from "../hooks/useEthPrice";
import TxBadge from "../components/TxBadge";
import NeuralChip from "../components/NeuralChip";
import { decryptBlob } from "../lib/encryption";
import type { Transaction } from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={`text-xl transition-colors ${
            (hover || value) >= star ? "text-secondary" : "text-on-surface-variant/30"
          }`}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => onChange && setHover(star)}
          onMouseLeave={() => onChange && setHover(0)}
          disabled={!onChange}
        >
          {(hover || value) >= star ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

export default function ModelDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const modelId  = Number(id);

  const { data: model, isLoading, isError } = useModel(modelId);
  const { data: reviews = [] }              = useModelReviews(modelId);
  const submitReview                        = useSubmitReview(modelId);

  const { purchaseModel, checkAccess }     = useMarketplace();
  const { address, connect }              = useWallet();
  const { isAuthenticated, isSigning, signIn, authFetch } = useAuth();
  const { toUsd, ethPrice }               = useEthPrice();
  const { owns, markOwned }               = useOwnership();

  const [hasAccess,     setHasAccess]     = useState<boolean | null>(null);
  const [tx,            setTx]            = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isPurchasing,  setIsPurchasing]  = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Mouse-tilt handler for avatar card (desktop only; CSS disables on mobile)
  const handleTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left)  / rect.width  - 0.5;
    const y = (e.clientY - rect.top)   / rect.height - 0.5;
    e.currentTarget.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 10}deg) scale(1.04)`;
  };
  const resetTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.transform = "rotateY(0deg) rotateX(0deg) scale(1)";
  };

  useEffect(() => {
    if (!model || !address) { setHasAccess(null); return; }
    let cancelled = false;
    checkAccess(modelId).then((v) => { if (!cancelled) setHasAccess(v); });
    return () => { cancelled = true; };
  }, [model, address, modelId, checkAccess]);

  const isOwned = owns(modelId) || hasAccess;

  const [reviewRating,  setReviewRating]  = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSuccess, setReviewSuccess] = useState(false);

  const handleSecureDownload = async () => {
    if (!model) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const res = await authFetch(`${API_BASE}/api/ipfs/download/${model.ipfsHash}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Download failed (${res.status})`);
      }
      const encryptedBlob = await res.blob();
      const keyRes = await authFetch(`${API_BASE}/api/ipfs/key/${model.ipfsHash}`);
      if (!keyRes.ok) { _triggerDownload(encryptedBlob, model); return; }
      const { encrypted, key_b64 } = await keyRes.json();
      if (encrypted && key_b64) {
        const plainBlob = await decryptBlob(encryptedBlob, key_b64);
        _triggerDownload(plainBlob, model);
      } else {
        _triggerDownload(encryptedBlob, model);
      }
    } catch (e: any) {
      setDownloadError(e.message ?? "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  function _triggerDownload(blob: Blob, m: typeof model) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `${(m?.name ?? "model").replace(/\s+/g, "_")}_${m?.version ?? ""}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const handlePurchase = async () => {
    if (!address) { connect(); return; }
    if (!model) return;
    setIsPurchasing(true);
    setTx({ hash: null, status: "pending", error: null });
    const result = await purchaseModel(model.id, model.priceWei, model.price);
    setTx(result);
    if (result.status === "confirmed") {
      markOwned(modelId);
      const verified = await checkAccess(modelId);
      setHasAccess(verified);
    }
    setIsPurchasing(false);
  };

  const handleReview = async () => {
    if (!reviewRating) return;
    await submitReview.mutateAsync({ rating: reviewRating, comment: reviewComment });
    setReviewSuccess(true);
    setReviewRating(0);
    setReviewComment("");
  };

  // ── LOADING STATE ──
  if (isLoading) {
    return (
      <div className="animate-page-in min-h-screen pt-24 px-6 lg:px-20">
        <div className="skeleton h-8 w-32 mb-12 rounded-lg" />
        <div className="flex flex-col lg:flex-row gap-12">
          <div className="flex-1 space-y-6">
            <div className="skeleton h-64 rounded-2xl" />
            <div className="skeleton h-32 rounded-2xl" />
          </div>
          <div className="w-full lg:w-96">
            <div className="skeleton h-96 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // ── ERROR STATE ──
  if (isError || !model) {
    return (
      <div className="animate-page-in min-h-screen flex items-center justify-center pt-24">
        <div className="glass-card rounded-2xl p-12 text-center space-y-4">
          <h2 className="font-syne font-black text-4xl uppercase">Core Model Not Found</h2>
          <button
            className="font-label text-xs uppercase tracking-widest text-secondary underline underline-offset-8 hover:opacity-70 transition-opacity"
            onClick={() => navigate("/marketplace")}
          >
            Return to Marketplace
          </button>
        </div>
      </div>
    );
  }

  const avgRating   = (model as any).avg_rating ?? null;
  const reviewCount = (model as any).review_count ?? reviews.length;

  return (
    <div className="animate-page-in min-h-screen pt-[88px] pb-[144px] px-6 lg:px-20">
      {/* Back button */}
      <button
        className="flex items-center gap-2 font-label text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface mb-10 group mt-4"
        onClick={() => navigate(-1)}
      >
        <span className="group-hover:-translate-x-1 transition-transform">←</span>
        Back to network
      </button>

      <div className="flex flex-col lg:flex-row gap-12 items-start">

        {/* ── MAIN COLUMN ── */}
        <div className="flex-1 space-y-12">

          {/* Hero header */}
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              {/* Avatar */}
              <div
                className="w-40 h-40 rounded-[32px] bg-surface-container border border-outline-variant/10 overflow-hidden shadow-2xl flex-shrink-0 tilt-card"
                onMouseMove={handleTilt}
                onMouseLeave={resetTilt}
              >
                <img
                  src={`https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(model.name)}&backgroundColor=0b0e17`}
                  alt={`${model.name} model avatar`}
                  loading="lazy"
                  className="w-full h-full object-cover p-4 opacity-90"
                />
              </div>

              {/* Title block */}
              <div className="flex-1 pt-2 space-y-4">
                {/* Creator cluster — category chip + creator info */}
                <div className="flex flex-wrap items-center gap-3">
                  <NeuralChip label={model.category.toUpperCase()} />
                  <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
                    by <span className="text-secondary">{model.creator.slice(0, 8)}...{model.creator.slice(-6)}</span>
                  </span>
                </div>

                <h1 className="font-syne font-black text-4xl lg:text-6xl tracking-tighter uppercase leading-none">
                  {model.name}
                </h1>

                {avgRating && (
                  <div className="flex items-center gap-4">
                    <StarRating value={Math.round(avgRating)} />
                    <span className="font-label text-xs text-on-surface-variant">
                      {avgRating} / 5.0 ({reviewCount} Verified Reviews)
                    </span>
                  </div>
                )}
              </div>
            </div>

            <p className="font-body text-lg text-on-surface-variant leading-relaxed max-w-3xl">
              {model.description}
            </p>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "VERSION",  value: model.version },
              { label: "LICENSE",  value: model.license },
              { label: "ROYALTY",  value: `${model.royaltyPercent}%` },
              { label: "ADOPTION", value: `${model.purchases} BUYERS` },
            ].map((stat) => (
              <div key={stat.label} className="glass-card rounded-xl p-5">
                <div className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest mb-2">{stat.label}</div>
                <div className="font-label text-lg font-bold text-on-surface tracking-tighter uppercase truncate">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Provenance block */}
          <div className="space-y-4">
            <div className="flex items-center gap-3 font-label text-[10px] text-on-surface-variant uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Immutable Provenance
            </div>
            <div className="glass-card rounded-2xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest block mb-2">IPFS CONTENT HASH</span>
                  <p className="font-label text-xs break-all text-secondary/80">{model.ipfsHash}</p>
                </div>
                <div className="md:text-right">
                  <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest block mb-2">CREATOR AUTHORITY</span>
                  <p className="font-label text-xs text-on-surface-variant max-w-[240px] truncate">
                    {model.creator}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Reviews section */}
          <div className="space-y-10 pt-10">
            <div className="neural-divider" />
            <h3 className="font-syne font-bold text-2xl tracking-tighter uppercase">Verified Feedback</h3>

            {hasAccess && !reviewSuccess && (
              <div className="glass-card rounded-2xl p-8 border-t-2 border-secondary-container/30 space-y-6">
                <h4 className="font-label text-xs uppercase tracking-widest">Leave an Evaluation</h4>
                <StarRating value={reviewRating} onChange={setReviewRating} />
                <textarea
                  className="w-full bg-surface-container-high rounded-xl p-5 text-sm border border-outline-variant/10 focus:ring-2 focus:ring-secondary/20 outline-none transition-all min-h-[120px] font-body"
                  placeholder="Analyze your experience with this model..."
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  disabled={!isAuthenticated}
                />

                {!isAuthenticated ? (
                  <div className="flex flex-col items-start gap-4 p-4 border border-dashed border-outline-variant/20 rounded-xl">
                    <p className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Signature required to submit</p>
                    <button
                      className="glass-card px-6 py-2 rounded-lg font-label text-xs uppercase tracking-widest hover:border-secondary/30 transition-colors"
                      onClick={signIn}
                      disabled={isSigning}
                    >
                      {isSigning ? "WAITING..." : "Sign to verify"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="bg-gradient-to-r from-secondary-container to-secondary text-on-secondary font-syne font-bold uppercase py-3 px-10 rounded-xl active:scale-95 transition-transform disabled:grayscale"
                    onClick={handleReview}
                    disabled={!reviewRating || submitReview.isPending}
                  >
                    {submitReview.isPending ? "PROCESSING..." : "SUBMIT EVALUATION"}
                  </button>
                )}
              </div>
            )}

            {reviewSuccess && (
              <div className="p-4 bg-secondary-container/10 border border-secondary-container/20 text-secondary rounded-xl font-label text-xs uppercase tracking-widest">
                Evaluation received. Thank you for your input.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {reviews.length === 0 ? (
                <div className="col-span-full py-20 text-center border border-dashed border-outline-variant/20 rounded-2xl font-label text-xs text-on-surface-variant uppercase tracking-widest">
                  No public data points available
                </div>
              ) : reviews.map((r: any) => (
                <div key={r.id} className="glass-card rounded-2xl p-6 space-y-4">
                  <div className="flex justify-between items-start">
                    <StarRating value={r.rating} />
                    <span className="font-label text-[10px] text-on-surface-variant">
                      {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase()}
                    </span>
                  </div>
                  <p className="font-body text-sm leading-relaxed italic text-on-surface-variant">"{r.comment}"</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-outline-variant/10">
                    <div className="w-7 h-7 rounded-full bg-secondary/20 flex items-center justify-center font-label text-[10px] text-secondary">
                      {(r.reviewer?.display_name ?? r.user_address ?? "A")[0].toUpperCase()}
                    </div>
                    <span className="font-label text-[10px] uppercase tracking-widest">
                      {r.reviewer?.display_name ?? `${(r.user_address ?? "").slice(0, 6)}...${(r.user_address ?? "").slice(-4)}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── PURCHASE SIDEBAR ── */}
        <aside className="w-full lg:w-96 space-y-6 lg:sticky lg:top-[88px]">
          <div className="glass-card neural-glow rounded-[32px] p-8 border-t-2 border-primary-container/30 space-y-8">
            {/* Price */}
            <div className="space-y-1">
              <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest">Asset Valuation</span>
              <div className="flex items-baseline gap-2">
                <span className="font-label text-4xl font-bold">{model.price}</span>
                <span className="font-label text-2xl font-bold text-secondary">ETH</span>
              </div>
              <p className="font-label text-sm text-on-surface-variant">≈ {toUsd(model.price)} USD</p>
            </div>

            {/* CTA */}
            <div className="space-y-3">
              {hasAccess === null && address && !owns(modelId) ? (
                <button className="w-full h-14 bg-surface-container rounded-2xl font-label text-xs text-on-surface-variant uppercase tracking-widest animate-pulse" disabled>
                  Verifying Node Access...
                </button>
              ) : isOwned ? (
                <div className="space-y-3">
                  <div className="w-full bg-secondary-container/10 border border-secondary-container/20 p-4 rounded-xl flex items-center justify-center gap-2 text-secondary font-label text-xs uppercase tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-secondary" />
                    Node Link Active
                  </div>
                  <button
                    className="w-full h-14 bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold uppercase rounded-2xl shadow-[0_0_20px_rgba(189,157,255,0.3)] hover:shadow-[0_0_35px_rgba(189,157,255,0.5)] hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-wide disabled:opacity-50"
                    onClick={handleSecureDownload}
                    disabled={isDownloading}
                  >
                    {isDownloading ? "DECRYPTING..." : "INITIALIZE DOWNLOAD ↓"}
                  </button>
                </div>
              ) : (
                <button
                  className="w-full h-14 bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold uppercase rounded-2xl shadow-[0_0_20px_rgba(189,157,255,0.3)] hover:shadow-[0_0_35px_rgba(189,157,255,0.5)] hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-wide"
                  onClick={handlePurchase}
                  disabled={isPurchasing}
                >
                  {!address ? "CONNECT WALLET"
                    : isPurchasing ? "PROCESSING TX..."
                    : "ACQUIRE LICENSE"}
                </button>
              )}
              {downloadError && (
                <p className="text-center font-label text-[10px] text-error uppercase tracking-widest animate-pulse">{downloadError}</p>
              )}
            </div>

            <TxBadge tx={tx} />

            {/* Network context — uses live ETH price + model metadata */}
            <div className="pt-6 border-t border-outline-variant/10 space-y-3">
              <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest block">
                Network Context
              </span>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-label text-[10px] text-on-surface-variant/60 uppercase">ETH/USD</span>
                  <span className="font-label text-[10px] text-secondary">
                    {ethPrice ? `$${ethPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label text-[10px] text-on-surface-variant/60 uppercase">Listed</span>
                  <span className="font-label text-[10px] text-on-surface-variant">
                    {new Date((model as any).createdAt ?? (model as any).created_at ?? Date.now())
                      .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      .toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label text-[10px] text-on-surface-variant/60 uppercase">Buyers</span>
                  <span className="font-label text-[10px] text-on-surface-variant">{model.purchases}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-label text-[10px] text-on-surface-variant/60 uppercase">Royalty</span>
                  <span className="font-label text-[10px] text-on-surface-variant">{model.royaltyPercent}%</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
