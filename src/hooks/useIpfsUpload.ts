/**
 * Phase 3 — IPFS upload via backend proxy (Pinata JWT never in browser)
 * Falls back to direct Pinata if VITE_PINATA_JWT is set (dev mode).
 */
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { API_BASE, ApiError } from "../lib/api";

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT as string | undefined;

export function useIpfsUpload() {
  const { token, isAuthenticated } = useAuth();

  return useMutation({
    mutationFn: async (file: File): Promise<{ ipfs_hash: string; size: number }> => {
      const formData = new FormData();
      formData.append("file", file);

      // Use backend proxy if authenticated (production path)
      if (isAuthenticated && token) {
        const res = await fetch(`${API_BASE}/api/ipfs/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new ApiError(res.status, err.detail ?? "Upload failed");
        }
        return res.json();
      }

      // Dev fallback: direct Pinata with browser JWT
      if (PINATA_JWT) {
        const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
          method: "POST",
          headers: { Authorization: `Bearer ${PINATA_JWT}` },
          body: formData,
        });
        if (!res.ok) throw new ApiError(res.status, `Pinata error: ${await res.text()}`);
        const data = await res.json();
        return { ipfs_hash: data.IpfsHash, size: data.PinSize };
      }

      throw new ApiError(401, "Sign in first to upload files, or set VITE_PINATA_JWT for dev mode.");
    },
  });
}
