import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { logEvent } from "../lib/analytics";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    logEvent("error_event_logged", { 
      error_message: error.message, 
      error_stack: error.stack,
      priority: "critical" 
    });
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="animate-page-in min-h-screen flex items-center justify-center p-6 lg:p-20 relative overflow-hidden bg-surface-container-lowest">
          {/* Critical glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-red-500/10 blur-[120px] rounded-full opacity-40 pointer-events-none" />
          
          <div className="max-w-md w-full space-y-10 relative z-10 text-center">
            <div className="space-y-4">
               <div className="text-6xl font-extrabold font-mono tracking-tighter text-red-500 select-none animate-pulse">!</div>
               <div className="space-y-1">
                  <h2 className="text-3xl font-extrabold uppercase tracking-tight text-on-surface">System_Failure</h2>
                  <p className="text-[10px] font-mono text-on-surface-variant uppercase tracking-[0.3em] opacity-60">Protocol Execution Aborted</p>
               </div>
            </div>

            <div className="p-10 glass-card rounded-[40px] border border-red-500/20 shadow-2xl space-y-8 bg-red-500/5">
               <div className="space-y-4">
                  <p className="text-sm text-on-surface-variant leading-relaxed font-medium">
                    The application encountered an unrecoverable exception in the neural layer. This event has been logged for architectural review.
                  </p>
                  {this.state.error && (
                    <div className="p-4 bg-black/40 rounded-xl border border-red-500/10 overflow-hidden">
                       <p className="text-[9px] font-mono text-red-400/70 uppercase truncate tracking-widest">{this.state.error.message}</p>
                    </div>
                  )}
               </div>
               
               <button 
                 className="w-full bg-red-500 text-white font-extrabold py-5 rounded-2xl uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(239,68,68,0.2)] hover:shadow-[0_0_50px_rgba(239,68,68,0.4)] transition-all active:scale-95 text-xs" 
                 onClick={() => window.location.reload()}
               >
                 INITIATE_RESCUE_HANDSHAKE
               </button>
            </div>
            
            <p className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest opacity-30">
              Error Core: {Math.random().toString(16).slice(2, 10).toUpperCase()} // SESSION_ID_TERMINATED
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
