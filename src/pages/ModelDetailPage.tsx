import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useModel, useModelReviews, useSubmitReview } from "../hooks/useModels";
import { useOwnership } from "../hooks/useOwnership";
import { useMarketplace } from "../hooks/useMarketplace";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useEthPrice } from "../hooks/useEthPrice";
import TxBadge from "../components/TxBadge";
import { decryptBlob } from "../lib/encryption";
import type { Transaction } from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ── Star rating component ──────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={`star ${(hover || value) >= star ? "star--active" : ""}`}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => onChange && setHover(star)}
          onMouseLeave={() => onChange && setHover(0)}
          disabled={!onChange}
          aria-label={`${star} star`}
        >★</button>
      ))}
    </div>
  );
}

export default function ModelDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const navigate   = useNavigate();
  const modelId    = Number(id);

  // Phase 5: React Query — no manual fetchModels needed
  const { data: model, isLoading, isError } = useModel(modelId);
  const { data: reviews = [] }              = useModelReviews(modelId);
  const submitReview                        = useSubmitReview(modelId);

  const { purchaseModel, checkAccess } = useMarketplace();
  const { address, connect }           = useWallet();
  const { isAuthenticated, isSigning, signIn, authFetch } = useAuth();
  const { toUsd }                      = useEthPrice();
  const { owns, markOwned }            = useOwnership();

  const [hasAccess,     setHasAccess]     = useState<boolean | null>(null); // null = still checking
  const [tx,            setTx]            = useState<Transaction>({ hash: null, status: "idle", error: null });
  const [isPurchasing,  setIsPurchasing]  = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Check access: Supabase purchase record first (fast), then on-chain contract as
  // source-of-truth. The on-chain check catches users whose DB record hasn't synced yet
  // due to event-listener lag — they paid, so they should get access immediately.
  useEffect(() => {
    if (!model || !address) { setHasAccess(null); return; }
    let cancelled = false;
    checkAccess(modelId).then((v) => { if (!cancelled) setHasAccess(v); });
    return () => { cancelled = true; };
  }, [model, address, modelId, checkAccess]);

  const isOwned = owns(modelId) || hasAccess;

  // Phase 4: Review form state
  const [reviewRating,  setReviewRating]  = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSuccess, setReviewSuccess] = useState(false);

  /** Download via authenticated backend proxy with client-side decryption. */
  const handleSecureDownload = async () => {
    if (!model) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      // Step 1: Fetch encrypted blob (purchase-gated)
      const res = await authFetch(`${API_BASE}/api/ipfs/download/${model.ipfsHash}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Download failed (${res.status})`);
      }
      const encryptedBlob = await res.blob();

      // Step 2: Fetch the decryption key (purchase-gated, returns null key if not encrypted)
      const keyRes = await authFetch(`${API_BASE}/api/ipfs/key/${model.ipfsHash}`);
      if (!keyRes.ok) {
        // Key endpoint unavailable — serve blob as-is (legacy unencrypted model)
        _triggerDownload(encryptedBlob, model);
        return;
      }
      const { encrypted, key_b64 } = await keyRes.json();

      // Step 3: Decrypt in browser if needed, then trigger browser download
      if (encrypted && key_b64) {
        const plainBlob = await decryptBlob(encryptedBlob, key_b64);
        _triggerDownload(plainBlob, model);
      } else {
        // File was not encrypted (legacy upload) — serve directly
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
      // Re-verify on-chain after tx confirms — source of truth is the contract
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

  if (isLoading) {
    return (
      <div className="page">
        <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div className="loading-placeholder">Loading model…</div>
      </div>
    );
  }

  if (isError || !model) {
    return (
      <div className="page">
        <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div className="empty-state">
          <p>Model not found.</p>
          <button className="btn btn--primary" onClick={() => navigate("/")}>Back to Marketplace</button>
        </div>
      </div>
    );
  }

  const avgRating = (model as any).avg_rating ?? null;
  const reviewCount = (model as any).review_count ?? reviews.length;

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>← Back</button>

      <div className="detail-layout">
        {/* ── Left: model info ───────────────────────────────────── */}
        <div className="detail-main">
          <div className="detail-header">
            <div className="detail-thumbnail">
              <img
                src={`https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(model.name)}&backgroundColor=080a0f&size=160`}
                alt=""
                loading="lazy"
                decoding="async"
                width="160"
                height="160"
              />
            </div>
            <span className="model-category">{model.category}</span>
            <h1 className="detail-title">{model.name}</h1>
            {/* Phase 4: average rating display */}
            {avgRating && (
              <div className="avg-rating">
                <StarRating value={Math.round(avgRating)} />
                <span className="avg-rating-label">{avgRating} ({reviewCount} review{reviewCount !== 1 ? "s" : ""})</span>
              </div>
            )}
            <p className="detail-desc">{model.description}</p>
          </div>

          <div className="detail-meta-grid">
            <div className="meta-item"><span className="meta-label">Version</span><span className="meta-value">{model.version}</span></div>
            <div className="meta-item"><span className="meta-label">License</span><span className="meta-value">{model.license}</span></div>
            <div className="meta-item"><span className="meta-label">Royalty</span><span className="meta-value">{model.royaltyPercent}%</span></div>
            <div className="meta-item"><span className="meta-label">Total Buyers</span><span className="meta-value">{model.purchases}</span></div>
          </div>

          <div className="ipfs-block">
            <span className="meta-label">IPFS Hash</span>
            {/* Fix 7: no direct IPFS link — hash shown for transparency but download is gated */}
            <span className="ipfs-link" title="Download available after purchase">
              {(model.ipfsHash ?? "").slice(0, 24)}…{(model.ipfsHash ?? "").slice(-8)}
            </span>
          </div>

          <div className="creator-block">
            <span className="meta-label">Creator</span>
            <span className="creator-addr">{model.creator}</span>
          </div>

          {/* Phase 4: Reviews section */}
          <div className="reviews-section">
            <h3 className="section-title">Reviews</h3>

            {/* Submit review — gated by purchase and sign-in */}
            {!hasAccess && address && (
              <div className="review-gate-notice">
                Purchase this model to leave a review.
              </div>
            )}

            {hasAccess && !reviewSuccess && (
              <div className="review-form">
                <p className="review-form-title">Leave a review</p>
                <StarRating value={reviewRating} onChange={setReviewRating} />
                <textarea
                  className="field-input field-textarea"
                  placeholder="Share your experience with this model…"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={3}
                  disabled={!isAuthenticated}
                />
                {/* Separate sign-in prompt — never nested inside/disabled the submit button */}
                {!isAuthenticated ? (
                  <div className="review-signin-prompt">
                    <p className="review-signin-text">Sign in with your wallet to submit a review.</p>
                    <button className="btn btn--primary" onClick={signIn} disabled={isSigning}>
                      {isSigning ? "Signing…" : "Sign In with Wallet"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn--primary"
                    onClick={handleReview}
                    disabled={!reviewRating || submitReview.isPending}
                  >
                    {submitReview.isPending ? "Submitting…" : reviewRating ? "Submit Review" : "Select a rating first"}
                  </button>
                )}
                {submitReview.isError && (
                  <div className="error-banner">{(submitReview.error as any)?.message ?? "Failed to submit review."}</div>
                )}
              </div>
            )}
            {reviewSuccess && <div className="info-banner">✓ Review submitted — thanks!</div>}

            {/* Review list */}
            {reviews.length === 0 ? (
              <p className="no-reviews">No reviews yet. Be the first!</p>
            ) : (
              <div className="review-list">
                {reviews.map((r: any) => (
                  <div key={r.id} className="review-card">
                    <div className="review-header">
                      <StarRating value={r.rating} />
                      <span className="review-author">
                        {r.reviewer?.display_name ?? `${(r.user_address ?? "").slice(0, 6)}…${(r.user_address ?? "").slice(-4)}`}
                      </span>
                      <span className="review-date">
                        {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    {r.comment && <p className="review-comment">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: purchase card ───────────────────────────────── */}
        <div className="detail-sidebar">
          <div className="purchase-card">
            <p className="purchase-price">{model.price} ETH</p>
            <p className="purchase-usd">{toUsd(model.price)}</p>

            {hasAccess === null && address && !owns(modelId) ? (
              <button className="btn btn--primary btn--full" disabled>Checking access…</button>
            ) : isOwned ? (
              <div className="access-granted">
                <div className="success-banner" style={{ background: "rgba(34, 211, 160, 0.1)", border: "1px solid rgba(34, 211, 160, 0.2)", color: "var(--green)", padding: "10px", borderRadius: "8px", margin: "0 auto 10px", fontSize: "13px", fontWeight: 600, width: "100%", textAlign: "center" }}>
                  Access unlocked ✅
                </div>
                <button
                  className="btn btn--primary"
                  onClick={handleSecureDownload}
                  disabled={isDownloading}
                >
                  {isDownloading ? "Decrypting & saving…" : "Download Model ↓"}
                </button>
                {downloadError && (
                  <div className="error-banner">{downloadError}</div>
                )}
              </div>
            ) : (
              <button className="btn btn--primary btn--full" onClick={handlePurchase} disabled={isPurchasing || !!isOwned}>
                {!address ? "Connect Wallet to Purchase"
                  : isOwned ? "Already Owned"
                  : isPurchasing ? "Processing transaction…"
                  : `Purchase for ${model.price} ETH`}
              </button>
            )}

            <TxBadge tx={tx} />
            <div className="purchase-info">
              <p>• Instant on-chain transfer of access</p>
              <p>• IPFS-pinned model weights included</p>
              <p>• {model.royaltyPercent}% royalty to creator on resale</p>
              <p>• 7-day escrow with buyer protection</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
