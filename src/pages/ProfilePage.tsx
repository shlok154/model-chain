import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { useOwnProfile, useSaveProfile } from "../hooks/useProfile";
import { useModels } from "../hooks/useModels";

export default function ProfilePage() {
  const { address, connect } = useWallet();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Phase 5: React Query — replaces old fetchProfile / fetchModels pattern
  const { data: profile, isLoading } = useOwnProfile(address);
  const saveProfile = useSaveProfile(address);

  // Fetch ALL models for this creator via server-side filter (not just first page)
  const { data: modelsData } = useModels(
    address ? { creator: address } : {}
  );
  const myModels = modelsData?.models ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ display_name: "", bio: "", twitter: "", github: "" });

  // Sync form when profile loads
  useEffect(() => {
    if (profile) setForm({
      display_name: profile.display_name ?? "",
      bio:          profile.bio          ?? "",
      twitter:      profile.twitter      ?? "",
      github:       profile.github       ?? "",
    });
  }, [profile]);

  const handleSave = async () => {
    await saveProfile.mutateAsync({
      display_name: form.display_name || null,
      bio:          form.bio          || null,
      twitter:      form.twitter      || null,
      github:       form.github       || null,
    });
    setIsEditing(false);
  };

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  const displayName = profile?.display_name || (address ? shortAddr(address) : "");

  if (!address) {
    return (
      <div className="page">
        <div className="page-header"><div><h1 className="page-title">Profile</h1></div></div>
        <div className="connect-card">
          <div className="connect-icon">◉</div>
          <h2 className="connect-title">Not Connected</h2>
          <p className="connect-desc">Connect your wallet to view your profile.</p>
          <button className="btn btn--primary" onClick={connect}>Connect Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">
            Your creator identity on ModelChain
            {!isSupabaseConfigured() && <span className="demo-badge">Demo Mode</span>}
          </p>
        </div>
        {!isAuthenticated && (
          <span className="hint-text" style={{ fontSize: 13, alignSelf: "center" }}>
            Sign in for full profile sync
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="loading-placeholder">Loading profile…</div>
      ) : (
        <div className="profile-layout">
          {saveProfile.isError && (
            <div className="error-banner">{(saveProfile.error as any)?.message}</div>
          )}
          {saveProfile.isSuccess && !isEditing && (
            <div className="info-banner">✓ Profile saved successfully.</div>
          )}

          {/* Profile card */}
          <div className="profile-card">
            <div className="profile-avatar">
              {(profile?.display_name ?? address).slice(0, 2).toUpperCase()}
            </div>
            <div className="profile-info">
              {isEditing ? (
                <input className="field-input profile-name-input" placeholder="Display name"
                  value={form.display_name}
                  onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
              ) : (
                <h2 className="profile-name">{displayName}</h2>
              )}
              <p className="profile-addr">{address}</p>
              {profile?.is_verified && <span className="verified-badge">✔ Verified Creator</span>}
            </div>
            <div className="profile-card-actions">
              {isEditing ? (
                <>
                  <button className="btn btn--primary" onClick={handleSave}
                    disabled={saveProfile.isPending}>
                    {saveProfile.isPending ? "Saving…" : "Save"}
                  </button>
                  <button className="btn btn--secondary" onClick={() => setIsEditing(false)}>Cancel</button>
                </>
              ) : (
                <button className="btn btn--secondary" onClick={() => setIsEditing(true)}>Edit Profile</button>
              )}
            </div>
          </div>

          {/* Edit form */}
          {isEditing && (
            <div className="profile-edit-card">
              <h3 className="form-section-title">About</h3>
              <div className="field">
                <label className="field-label">Bio</label>
                <textarea className="field-input field-textarea" rows={3}
                  placeholder="Tell people about yourself…" value={form.bio}
                  onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label className="field-label">Twitter / X</label>
                  <input className="field-input" placeholder="@username" value={form.twitter}
                    onChange={e => setForm(f => ({ ...f, twitter: e.target.value }))} />
                </div>
                <div className="field">
                  <label className="field-label">GitHub</label>
                  <input className="field-input" placeholder="username" value={form.github}
                    onChange={e => setForm(f => ({ ...f, github: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          {/* About section (view mode) */}
          {!isEditing && (profile?.bio || profile?.twitter || profile?.github) && (
            <div className="profile-about-card">
              {profile.bio && <p className="profile-bio">{profile.bio}</p>}
              <div className="profile-links">
                {profile.twitter && (
                  <a href={`https://twitter.com/${profile.twitter.replace("@", "")}`}
                    target="_blank" rel="noreferrer" className="profile-link">
                    𝕏 {profile.twitter}
                  </a>
                )}
                {profile.github && (
                  <a href={`https://github.com/${profile.github}`}
                    target="_blank" rel="noreferrer" className="profile-link">
                    ⌥ {profile.github}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="profile-stats">
            <div className="stat-card">
              <span className="stat-label">Models Listed</span>
              <span className="stat-value">{myModels.length}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total Sales</span>
              <span className="stat-value">{myModels.reduce((s, m) => s + m.purchases, 0)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Member Since</span>
              <span className="stat-value">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })
                  : "—"}
              </span>
            </div>
          </div>

          {/* Your models */}
          <div className="profile-models">
            <h3 className="section-title">Your Models</h3>
            {myModels.length === 0 ? (
              <div className="empty-state">
                <p>You haven't listed any models yet.</p>
                <button className="btn btn--primary" onClick={() => navigate("/upload")}>
                  Upload Your First Model
                </button>
              </div>
            ) : (
              <div className="model-grid">
                {myModels.map(m => (
                  <div key={m.id} className="model-card" onClick={() => navigate(`/model/${m.id}`)}>
                    <div className="model-card-top">
                      <span className="model-category">{m.category}</span>
                      <span className="model-purchases">{m.purchases} buyers</span>
                    </div>
                    <h3 className="model-name">{m.name}</h3>
                    <div className="model-card-footer">
                      <span className="model-price">{m.price} ETH</span>
                      <span className="model-license">{m.license}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isSupabaseConfigured() {
  return !!import.meta.env.VITE_SUPABASE_URL;
}
