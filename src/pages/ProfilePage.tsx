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

  const { data: profile, isLoading } = useOwnProfile(address);
  const saveProfile = useSaveProfile(address);

  const { data: modelsData } = useModels(
    address ? { creator: address } : {}
  );
  const myModels = modelsData?.models ?? [];

  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ display_name: "", bio: "", twitter: "", github: "" });

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

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  const displayName = profile?.display_name || (address ? shortAddr(address) : "");

  if (!address) {
    return (
      <div className="animate-page-in min-h-screen flex items-center justify-center pt-24 px-6">
        <div className="glass-card p-12 rounded-[32px] border border-outline-variant/10 max-w-lg text-center space-y-8">
           <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto text-3xl font-mono">P</div>
           <div className="space-y-2">
             <h2 className="text-3xl font-extrabold uppercase tracking-tighter">Identity Locked</h2>
             <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">Awaiting wallet connection to sync creator profile</p>
           </div>
           <button 
             className="w-full bg-primary text-black font-extrabold py-4 rounded-2xl uppercase tracking-widest hover:scale-[1.02] transition-transform active:scale-95"
             onClick={connect}
           >
             Establish Connection
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-page-in min-h-screen pt-[88px] pb-[144px] px-6 lg:px-20 space-y-16 max-w-7xl mx-auto">
      
      {/* PROFILE HEADER */}
      <div className="flex flex-col lg:flex-row gap-12 items-start lg:items-center justify-between border-b border-outline-variant/10 pb-16">
        <div className="flex flex-col md:flex-row gap-8 items-center md:items-start text-center md:text-left">
          <div className="w-32 h-32 md:w-40 md:h-40 rounded-[40px] bg-gradient-to-br from-primary/20 to-secondary/20 p-1 border border-outline-variant/20 shadow-2xl relative">
             <div className="w-full h-full rounded-[38px] bg-surface-container overflow-hidden">
                <img
                  src={`https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(address)}&backgroundColor=0b0e16`}
                  alt="" className="w-full h-full object-cover p-4"
                />
             </div>
             <div className="absolute -bottom-2 -right-2 bg-secondary text-black p-2 rounded-xl text-xs font-mono font-bold shadow-lg">
                ID_{shortAddr(address)}
             </div>
          </div>
          
          <div className="pt-2 space-y-4 max-w-full">
             <div className="flex flex-col md:flex-row items-center gap-4">
               <h1 className="text-4xl lg:text-6xl font-extrabold tracking-tighter uppercase leading-none truncate max-w-[280px] md:max-w-md">
                 {displayName}
               </h1>
               {profile?.is_verified && (
                 <span className="px-3 py-1 bg-secondary/10 text-secondary rounded-full text-[10px] font-mono border border-secondary/20 uppercase tracking-widest shrink-0">
                   Verified Architect
                 </span>
               )}
             </div>
             <p className="text-on-surface-variant font-mono text-[10px] uppercase tracking-widest break-all">
               NODE_ADDRESS: <span className="text-on-surface">{address}</span>
             </p>
             {!isAuthenticated && (
                <div className="inline-block px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-mono text-on-surface-variant uppercase tracking-widest animate-pulse">
                  Unauthenticated Display Only
                </div>
             )}
          </div>
        </div>

        <div className="flex gap-4 w-full md:w-auto">
           {isEditing ? (
             <>
               <button className="flex-1 md:flex-none px-10 py-4 bg-secondary text-black font-extrabold rounded-2xl uppercase tracking-widest text-xs active:scale-95 transition-all disabled:opacity-50" 
                 onClick={handleSave} disabled={saveProfile.isPending}>
                 {saveProfile.isPending ? "Syncing..." : "Commit Changes"}
               </button>
               <button className="flex-1 md:flex-none px-10 py-4 glass-card border border-outline-variant/10 rounded-2xl uppercase tracking-widest text-xs" 
                 onClick={() => setIsEditing(false)}>
                 Abort
               </button>
             </>
           ) : (
             <button className="w-full md:w-auto px-10 py-4 glass-card border border-outline-variant/20 hover:border-primary/40 rounded-2xl uppercase tracking-widest font-bold text-xs transition-all" 
               onClick={() => setIsEditing(true)}>
               Edit Architecture
             </button>
           )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* LEFT COLUMN: ABOUT & STATS */}
        <div className="lg:col-span-4 space-y-10">
          
          {/* STATS MODULE */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "NODES", value: myModels.length },
              { label: "ADOPTION", value: myModels.reduce((s, m) => s + m.purchases, 0) },
              { label: "SINCE", value: profile?.created_at ? new Date(profile.created_at).getFullYear() : "—" },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-container p-5 rounded-2xl border border-outline-variant/10 text-center space-y-1">
                 <div className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest">{stat.label}</div>
                 <div className="text-xl font-extrabold font-mono tracking-tighter">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* EDIT FORM / VIEW ABOUT */}
          <div className="glass-card p-8 rounded-[32px] border border-outline-variant/10 space-y-8">
            <h3 className="text-xs font-mono text-on-surface-variant uppercase tracking-widest border-b border-outline-variant/10 pb-4">Identity Manifest</h3>
            
            {isEditing ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest ml-1">SYSTEM_BIO</label>
                  <textarea 
                    className="w-full bg-surface-container rounded-xl p-5 text-sm border border-outline-variant/10 outline-none focus:ring-2 focus:ring-primary/20 transition-all min-h-[120px]"
                    placeholder="Input personality matrix..." value={form.bio}
                    onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest ml-1">TWITTER_X_ENDPOINT</label>
                  <input 
                    className="w-full bg-surface-container rounded-xl p-4 text-sm font-mono border border-outline-variant/10 outline-none"
                    placeholder="@identifier" value={form.twitter}
                    onChange={e => setForm(f => ({ ...f, twitter: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest ml-1">GITHUB_REPOSITORY</label>
                  <input 
                    className="w-full bg-surface-container rounded-xl p-4 text-sm font-mono border border-outline-variant/10 outline-none"
                    placeholder="identifier" value={form.github}
                    onChange={e => setForm(f => ({ ...f, github: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                <p className="text-on-surface-variant leading-relaxed italic text-sm">
                  {profile?.bio || "No data provided in the identity manifest."}
                </p>
                <div className="space-y-4">
                  {profile?.twitter && (
                    <a href={`https://twitter.com/${profile.twitter.replace("@", "")}`}
                      target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest group border border-outline-variant/10 p-3 rounded-xl hover:bg-white/5 transition-all">
                      <span className="text-primary font-bold">𝕏</span>
                      {profile.twitter}
                    </a>
                  )}
                  {profile?.github && (
                    <a href={`https://github.com/${profile.github}`}
                      target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest group border border-outline-variant/10 p-3 rounded-xl hover:bg-white/5 transition-all">
                      <span className="text-primary font-bold">⌥</span>
                      {profile.github}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: MODELS SHOWCASE */}
        <div className="lg:col-span-8 space-y-8">
           <div className="flex justify-between items-end">
             <h3 className="text-2xl font-extrabold tracking-tighter uppercase leading-none">Deployed Nodes</h3>
             <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{myModels.length} active instances</span>
           </div>

           {isLoading ? (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1,2].map(i => <div key={i} className="skeleton h-48 rounded-[32px]" />)}
             </div>
           ) : myModels.length === 0 ? (
             <div className="py-24 text-center border-2 border-dashed border-outline-variant/10 rounded-[40px] space-y-6">
                <p className="text-on-surface-variant font-mono uppercase text-xs tracking-widest">No nodes deployed to this address</p>
                <button 
                  className="px-8 py-3 bg-white text-black font-extrabold rounded-xl text-xs uppercase tracking-widest active:scale-95 transition-all"
                  onClick={() => navigate("/upload")}
                >
                  INITIALIZE NEW NODE
                </button>
             </div>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {myModels.map(m => (
                  <div 
                    key={m.id} 
                    className="bg-surface-container border border-outline-variant/10 rounded-[32px] p-6 hover:translate-y-[-8px] transition-all duration-300 cursor-pointer shadow-xl group"
                    onClick={() => navigate(`/model/${m.id}`)}
                  >
                    <div className="flex justify-between items-start mb-6">
                      <span className="px-3 py-1 bg-secondary/10 text-secondary rounded-full text-[9px] font-mono border border-secondary/20 uppercase tracking-widest">
                        {m.category.toUpperCase()}
                      </span>
                      <span className="text-[10px] font-bold font-mono text-on-surface-variant uppercase">{m.purchases} Nodes</span>
                    </div>
                    <h4 className="text-xl font-extrabold tracking-tight uppercase group-hover:text-primary transition-colors mb-2">
                       {m.name}
                    </h4>
                    <div className="flex justify-between items-center pt-6 border-t border-outline-variant/10">
                       <div className="text-lg font-bold font-mono">
                         {m.price} <span className="text-secondary">ETH</span>
                       </div>
                       <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">{m.license}</span>
                    </div>
                  </div>
                ))}
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

