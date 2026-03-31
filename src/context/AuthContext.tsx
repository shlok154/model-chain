/**
 * Phase 1 — Wallet → JWT Authentication Context
 *
 * Flow:
 *   1. User clicks "Sign In" → calls signIn()
 *   2. We fetch a nonce from the backend (/auth/nonce)
 *   3. MetaMask signs the nonce message (eth_sign)
 *   4. We POST signature to /auth/verify → receive JWT
 *   5. JWT stored in localStorage, injected into every API call
 *   6. On app load, existing JWT is restored and validated
 */
import {
  createContext, useContext, useState, useCallback,
  useEffect, type ReactNode,
} from "react";
import { logEvent } from "../lib/analytics";
import { useWallet } from "./WalletContext";
import { useEthersSigner } from "../lib/wagmiAdapters";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "modelchain_jwt";

interface AuthState {
  token: string | null;
  role:  string | null;
  isAuthenticated: boolean;
  isSigning: boolean;
  authError: string | null;
}

interface AuthContextValue extends AuthState {
  signIn:  () => Promise<void>;
  signOut: () => void;
  becomeCreator: () => Promise<void>;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address } = useWallet();
  const signer = useEthersSigner();

  const [state, setState] = useState<AuthState>(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      try {
        const payload = JSON.parse(atob(stored.split(".")[1]));
        if (payload.exp * 1000 > Date.now()) {
          return { token: stored, role: payload.role, isAuthenticated: true, isSigning: false, authError: null };
        }
      } catch { /* expired / malformed */ }
    }
    return { token: null, role: null, isAuthenticated: false, isSigning: false, authError: null };
  });



  const signIn = useCallback(async () => {
    if (!address || !signer) return;
    setState(s => ({ ...s, isSigning: true, authError: null }));

    try {
      // 1. Get nonce
      const nonceRes = await fetch(`${API_BASE}/auth/nonce?wallet=${address}`);
      if (!nonceRes.ok) throw new Error("Failed to get nonce");
      const { message } = await nonceRes.json();

      // 2. Sign with MetaMask
      logEvent("signature_requested", { wallet: address });
      const signature = await signer.signMessage(message);
      logEvent("signature_success", { wallet: address });

      // 3. Verify → get JWT
      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: address, signature }),
      });
      if (!verifyRes.ok) {
        const err = await verifyRes.json();
        throw new Error(err.detail ?? "Verification failed");
      }
      const { access_token, role } = await verifyRes.json();

      localStorage.setItem(TOKEN_KEY, access_token);
      setState({ token: access_token, role, isAuthenticated: true, isSigning: false, authError: null });
    } catch (err: any) {
      setState(s => ({ ...s, isSigning: false, authError: err.code === 4001 ? "Signature rejected." : "Failed to sign in." }));
      logEvent("signature_rejected", { wallet: address, errorCode: err.code, errorMessage: err.message });
    }
  }, [address, signer]);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ token: null, role: null, isAuthenticated: false, isSigning: false, authError: null });
  }, []);

  /**
   * Elevate the current user to the 'creator' role without signing out.
   * Calls POST /auth/request-creator with the current JWT and swaps in the
   * returned token (which carries role=creator). This unblocks the upload
   * page for new users who haven't listed a model yet.
   */
  const becomeCreator = useCallback(async () => {
    if (!state.token) return;
    setState(s => ({ ...s, isSigning: true, authError: null }));
    try {
      const res = await fetch(`${API_BASE}/auth/request-creator`, {
        method: "POST",
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to become a creator");
      }
      const { access_token, role } = await res.json();
      localStorage.setItem(TOKEN_KEY, access_token);
      setState(s => ({ ...s, token: access_token, role, isSigning: false, authError: null }));
    } catch (err: any) {
      setState(s => ({ ...s, isSigning: false, authError: err.message ?? "Failed to become a creator" }));
    }
  }, [state.token]);

  /** Fetch wrapper that auto-injects the Bearer token. */
  const authFetch = useCallback(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
    return fetch(url, { ...init, headers });
  }, [state.token]);

  // If wallet disconnects, sign out
  useEffect(() => {
    if (!address && state.isAuthenticated) signOut();
  }, [address, state.isAuthenticated, signOut]);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut, becomeCreator, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
