export default function Footer() {
  return (
    <footer className="w-full py-12 px-6 lg:px-20 border-t border-outline-variant/10 relative z-10 glass-card">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
        
        <div className="flex flex-col items-center md:items-start gap-2">
           <div className="text-lg font-extrabold tracking-tighter uppercase flex items-center gap-3">
              <span className="text-primary">⬡</span> ModelChain
           </div>
           <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.2em] opacity-60">Decentralized Intelligence Network</p>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-12">
           <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest max-w-[300px] text-center md:text-right leading-relaxed opacity-50">
             Smart contract interactions are irreversible. Operate with precise calculation. Not financial advice.
           </p>
           <div className="h-6 w-px bg-outline-variant/20 hidden md:block" />
           <a
             href="https://sepolia.etherscan.io"
             target="_blank"
             rel="noreferrer"
             className="text-[10px] font-mono text-secondary uppercase tracking-widest hover:underline underline-offset-4 decoration-secondary/30 transition-all font-bold"
           >
             SEP_SCAN_EXPLORER ↗
           </a>
        </div>

      </div>
      
      <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-outline-variant/5 text-center">
         <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.3em] opacity-40">© 2026 MODELCHAIN_PROTOCOL // DEEPLINK_ESTABLISHED</p>
      </div>
    </footer>
  );
}
