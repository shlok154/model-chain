/**
 * Phase 3/4 — Typed API client
 * Thin wrapper around fetch that points at the Python backend.
 * All reads also fall back to direct Supabase queries if backend is unavailable.
 */

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init?.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${url}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(url: string, token?: string | null) => request<T>(url, { method: "GET" }, token),
  post:   <T>(url: string, body: unknown, token?: string | null) =>
            request<T>(url, { method: "POST", body: JSON.stringify(body) }, token),
  delete: <T>(url: string, token?: string | null) => request<T>(url, { method: "DELETE" }, token),
};
