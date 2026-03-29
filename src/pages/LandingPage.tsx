import { useNavigate } from "react-router-dom";
import { useModels } from "../hooks/useModels";
import { useTelemetryInsights } from "../hooks/useAnalytics";

export default function LandingPage() {
  const navigate = useNavigate();
  const { data: telemetry } = useTelemetryInsights();
  const { data: modelsData } = useModels({ limit: 1 });
  const { data: featuredData } = useModels({ sort_by: "purchases", order: "desc", limit: 3 });
  const featuredModels = featuredData?.models ?? [];

  return (
    <div className="animate-page-in min-h-screen flex flex-col pt-16 pb-10 overflow-x-hidden">
      
      {/* ── HERO SECTION ── */}
      <section className="flex-1 flex flex-col lg:flex-row items-center justify-between gap-12 px-6 lg:px-20 py-16 lg:py-24">
        
        {/* Left column — copy */}
        <div className="max-w-2xl z-10 text-center lg:text-left">
          {/* Status pill */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/10 border border-secondary/20 font-label text-[10px] text-secondary uppercase tracking-widest mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            SYSTEM STABLE
          </div>

          <h1 className="font-syne font-black text-[44px] lg:text-[88px] leading-[0.9] tracking-tighter text-on-surface uppercase mb-6">
            Decentralized<br />
            <span className="bg-gradient-to-r from-primary-container to-secondary-container bg-clip-text text-transparent">
              AI Economy
            </span>
          </h1>

          <p className="text-lg lg:text-xl text-on-surface-variant max-w-lg mb-10 leading-relaxed mx-auto lg:mx-0">
            Buy, sell, and license high-performance AI models directly on-chain.
            Powered by Ethereum, built for the autonomous future.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
            <button
              onClick={() => navigate('/marketplace')}
            className="btn-shimmer bg-gradient-to-r from-primary-container to-secondary-container text-on-primary-fixed font-syne font-bold px-8 py-4 rounded-lg shadow-[0_0_20px_rgba(189,157,255,0.3)] hover:shadow-[0_0_35px_rgba(189,157,255,0.5)] hover:scale-[1.02] active:scale-95 transition-all text-lg uppercase tracking-tight"
            >
              Explore Models
            </button>
            <button
              onClick={() => navigate('/upload')}
              className="px-8 py-4 rounded-lg border border-outline-variant/30 hover:bg-surface-container-high text-on-surface font-syne font-bold text-lg uppercase tracking-tight transition-colors"
            >
              List Your Model
            </button>
          </div>

          {/* Stats bar — wired to live API data */}
          <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                value: modelsData?.total != null
                  ? modelsData.total.toLocaleString()
                  : "—",
                label: "Active Models"
              },
              {
                value: telemetry?.tx_total != null
                  ? `${telemetry.tx_total.toLocaleString()}`
                  : "—",
                label: "TX Artifacts"
              },
              {
                value: telemetry?.rpc_health.success_rate != null
                  ? `${telemetry.rpc_health.success_rate}%`
                  : "—",
                label: "TX Success Rate"
              },
              {
                value: telemetry?.conversion_funnel.downloaded != null
                  ? `${telemetry.conversion_funnel.downloaded.toLocaleString()}`
                  : "—",
                label: "Safe Executions"
              },
            ].map((stat) => (
              <div key={stat.label} className="text-center lg:text-left">
                <div className="font-label text-2xl text-secondary font-bold mb-1">{stat.value}</div>
                <div className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column — Desktop float stack, wired to top 3 models by purchases */}
        <div 
          className="hidden lg:flex relative h-[500px] w-[480px] items-center justify-center float-stack"
          style={{ perspective: "1200px" }}
        >
          <div className="relative" style={{ transform: "rotateY(-12deg) rotateX(5deg)", height: "360px", width: "360px" }}>
            {(featuredModels.length > 0 ? featuredModels : [
              { id: 1, category: "LLM",  creator: "0x8a4...fcbc", name: "Neural LLM",    price: "0.45" },
              { id: 2, category: "CV",   creator: "0x09f...d5a1", name: "VisionNet",     price: "1.20" },
              { id: 3, category: "DIFF", creator: "0xbd9...ff9a", name: "DiffusionXL",   price: "0.08" },
            ] as any[]).slice(0, 3).map((model, i) => {
              const posClass   = ["absolute top-0 left-0", "absolute top-[60px] left-[40px]", "absolute top-[120px] left-[-20px]"][i];
              const floatClass = ["animate-float-1", "animate-float-2", "animate-float-3"][i];
              const borderCol  = i % 2 === 0 ? "border-primary-container" : "border-secondary-container";
              const textCol    = i % 2 === 0 ? "text-primary-container" : "text-secondary-container";
              const bgCol      = i % 2 === 0 ? "bg-primary-container/20 text-primary-container" : "bg-secondary-container/20 text-secondary-container";
              const shortAddr  = typeof model.creator === "string" && model.creator.length > 12
                ? `${model.creator.slice(0, 5)}...${model.creator.slice(-4)}`
                : model.creator;
              return (
                <div key={model.id} className={`w-[320px] h-[200px] glass-card rounded-2xl p-6 border-t-2 ${borderCol} ${floatClass} ${posClass}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className={`w-10 h-10 rounded-lg ${bgCol} flex items-center justify-center font-label text-xs font-bold`}>
                      {model.category.slice(0, 4).toUpperCase()}
                    </div>
                    <div className="font-label text-[10px] text-on-surface-variant">{shortAddr}</div>
                  </div>
                  <div className="font-syne font-bold text-sm uppercase tracking-tight truncate max-w-[200px] mb-1">{model.name}</div>
                  <div className="h-2 w-16 bg-surface-container-high rounded opacity-40" />
                  <div className={`absolute bottom-6 right-6 font-label text-xl ${textCol}`}>{model.price} ETH</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile hero visual */}
        <div className="lg:hidden mt-8 relative flex justify-center h-48 items-center">
          <div className="w-48 h-48 rounded-[24px] border-2 border-primary-container/20 rotate-[12deg] absolute" />
          <div className="w-48 h-48 rounded-[24px] border-2 border-secondary-container/20 rotate-[6deg] absolute" />
          <div className="w-48 h-48 rounded-[24px] glass-card flex items-center justify-center relative">
            <div className="flex flex-col items-center gap-3">
              <span className="text-4xl">⬡</span>
              <div className="w-20 h-1 bg-gradient-to-r from-primary-container to-secondary-container rounded-full" />
            </div>
          </div>
        </div>
      </section>

      {/* ── NEURAL DIVIDER ── */}
      <div className="neural-divider mx-6 lg:mx-20" />

      {/* ── FEATURES SECTION ── */}
      <section className="py-20 px-6 lg:px-20">
        <h2 className="font-syne font-black text-3xl lg:text-4xl tracking-tighter uppercase mb-12 text-center lg:text-left">
          Engineered for Trust
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: "verified", title: "Verifiable Ownership", desc: "Every model is an on-chain asset, guaranteeing provable ownership and instant transfer logic." },
            { icon: "currency_bitcoin", title: "Creator Royalties", desc: "Automated secondary sale royalties ensure model architects earn perpetually from their work." },
            { icon: "lock", title: "IPFS Protected", desc: "Decentralized storage via IPFS ensures model metadata and artifacts are immutable and censorship-resistant." },
          ].map((feat) => (
            <div key={feat.title} className="glass-card rounded-2xl p-8 pb-12 group">
              <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-primary-container/20 to-secondary-container/20 border border-primary-container/20 flex items-center justify-center mb-6 group-hover:border-primary-container/40 transition-colors">
                <span className="material-symbols-outlined text-primary-container text-3xl">{feat.icon}</span>
              </div>
              <h3 className="font-syne font-bold text-xl uppercase mb-4 tracking-tight text-on-surface">{feat.title}</h3>
              <p className="text-on-surface-variant leading-relaxed font-body">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
