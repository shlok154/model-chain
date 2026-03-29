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
    // Log the crash so we know about it asynchronously
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
        <div className="page" style={{ justifyContent: "center", alignItems: "center" }}>
          <div className="error-banner" style={{ maxWidth: 500, margin: "0 auto", textAlign: "center", padding: "32px 24px" }}>
            <h2 style={{ fontSize: 18, marginBottom: 12, color: "var(--red)" }}>Something went wrong.</h2>
            <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24 }}>
              The application encountered an unexpected error.
            </p>
            <button
              className="btn btn--primary"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
