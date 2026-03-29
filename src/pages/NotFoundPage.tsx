import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="animate-page-in min-h-screen flex items-center justify-center p-6 lg:p-20 relative overflow-hidden text-center">
      {/* Background decoration */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/20 blur-[160px] rounded-full opacity-50 pointer-events-none" />
      
      <div className="max-w-xl space-y-12 relative z-10">
        <div className="space-y-4">
           <div className="text-[120px] lg:text-[180px] font-extrabold font-mono tracking-tighter leading-none text-white/10 select-none">404</div>
           <div className="space-y-2 -mt-10 lg:-mt-16">
              <h1 className="text-4xl lg:text-6xl font-extrabold uppercase tracking-tighter">Route_Lost</h1>
              <p className="text-on-surface-variant text-sm font-mono uppercase tracking-widest opacity-60">
                 The requested neural coordinate does not exist.
              </p>
           </div>
        </div>

        <div className="p-8 glass-card rounded-[32px] border border-outline-variant/10 space-y-6">
           <p className="text-sm lg:text-base text-on-surface-variant leading-relaxed">
             You've reached a decentralized dead-end. The model or page you are looking for has either been decommissioned or never existed in this sector.
           </p>
           <button 
             className="w-full bg-primary text-black font-extrabold py-5 rounded-2xl uppercase tracking-widest hover:shadow-[0_0_40px_rgba(189,157,255,0.4)] transition-all active:scale-95 flex items-center justify-center gap-3" 
             onClick={() => navigate("/")}
           >
             <span className="text-lg">⬡</span> RETURN_TO_NUCLEUS
           </button>
        </div>
      </div>
    </div>
  );
}
