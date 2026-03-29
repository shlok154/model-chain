import { API_BASE } from "./api";

interface AnalyticsEvent {
  event: string;
  wallet?: string | null;
  modelId?: number | null;
  session_id: string;
  context?: Record<string, any>;
}

// ── Persistent Session Identity ────────────────────────────────────────────────
// Helps correlate funnels (e.g. click -> sign -> purchase -> retry) across reloads.
let _sessionId = localStorage.getItem("sessionId");
if (!_sessionId) {
  _sessionId = crypto.randomUUID();
  localStorage.setItem("sessionId", _sessionId);
}
export const sessionId = _sessionId;

/**
 * Lightweight telemetry wrapper
 * Fire-and-forget: does not block the main thread or UI interactions.
 */
export function logEvent(
  eventName: string,
  payload?: {
    wallet?: string | null;
    modelId?: number | null;
    [key: string]: any;
  }
) {
  // Extract top-level known fields, dump the rest into `context`
  const { wallet, modelId, ...context } = payload || {};

  const body: AnalyticsEvent = {
    event: eventName,
    wallet,
    modelId,
    session_id: sessionId,
    context: Object.keys(context).length > 0 ? context : undefined,
  };

  // non-blocking fetch
  fetch(`${API_BASE}/api/analytics/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Use keepalive: true so it doesn't fail if the user is navigating away from the page
    keepalive: true,
  }).catch(() => {
    // Fail silently in production to avoid polluting console or blocking user
  });
}
