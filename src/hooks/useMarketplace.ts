/**
 * useMarketplace — on-chain MUTATIONS only.
 *
 * Responsibility split:
 *   useModels    (useModels.ts)     — all data FETCHING (React Query, cached, paginated)
 *   useMarketplace (this file)      — all on-chain ACTIONS (purchase, list, withdraw, gas, access)
 *
 * Pages should import useModels for reads and useMarketplace for writes.
 * Never call fetchModels/fetchModelById from here — use useModels instead.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { MARKETPLACE_ABI, MARKETPLACE_ADDRESS } from "../contracts/marketplace";
import { supabase, isSupabaseReady } from "../lib/supabase";
import type { Transaction } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isContractDeployed() {
  return MARKETPLACE_ADDRESS !== "0x0000000000000000000000000000000000000000";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMarketplace() {
  const { signer, provider, address } = useWallet();
  const { token } = useAuth();
  const qc = useQueryClient();

  const getContract = useCallback(
    (signerOrProvider?: ethers.Signer | ethers.Provider) =>
      new ethers.Contract(
        MARKETPLACE_ADDRESS,
        MARKETPLACE_ABI,
        signerOrProvider ?? provider ?? undefined
      ),
    [provider]
  );

  const getSignedContract = useCallback(() => {
    if (!signer) throw new Error("Wallet not connected");
    return new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
  }, [signer]);

  // ── Purchase ────────────────────────────────────────────────────────────────
  const purchaseModel = useCallback(
    async (modelId: number, priceWei: bigint, priceEth: string): Promise<Transaction> => {
      if (!isContractDeployed()) {
        try {
          await api.post("/api/models/simulate-purchase", {
            model_id: modelId,
            price_eth: parseFloat(priceEth)
          }, token);
          return { hash: "0xdemo...tx", status: "confirmed", error: null };
        } catch (err: any) {
          return { hash: null, status: "failed", error: err.message ?? "Simulation failed" };
        }
      }
      try {
        const contract = getSignedContract();
        const tx = await contract.purchaseModel(modelId, { value: priceWei });
        const receipt = await tx.wait();
        // Invalidate ownership cache so UI instantly reflects the new owned state.
        // The long 5-min staleTime + markOwned() handle the optimistic path;
        // this ensures the server-authoritative value is refreshed too.
        qc.invalidateQueries({ queryKey: ["ownership", address ?? ""] });
        return { hash: receipt.hash, status: "confirmed", error: null };
      } catch (err: any) {
        const msg = err.reason ?? err.message ?? "Transaction failed";
        let friendlyError: string;
        if (err.code === 4001) {
          friendlyError = "Transaction rejected by user.";
        } else if (msg.includes("insufficient funds")) {
          friendlyError = "Not enough ETH in your wallet to complete this purchase.";
        } else {
          friendlyError = msg;
        }
        return { hash: null, status: "failed", error: friendlyError };
      }
    },
    [getSignedContract, address]
  );

  // ── List model ──────────────────────────────────────────────────────────────
  const listModel = useCallback(
    async (params: {
      name: string;
      description: string;
      price: string;
      ipfsHash: string;
      version: string;
      license: string;
      category: string;
      royaltyPercent: number;
    }): Promise<Transaction> => {
      if (!address) return { hash: null, status: "failed", error: "Wallet not connected" };

      if (!isContractDeployed()) {
        try {
          await api.post("/api/models/simulate-list", {
            name: params.name,
            description: params.description,
            price_eth: parseFloat(params.price),
            ipfs_hash: params.ipfsHash,
            version: params.version,
            license: params.license,
            category: params.category,
            royalty_percent: params.royaltyPercent,
          }, token);
          return { hash: "0xdemo...deploy", status: "confirmed", error: null };
        } catch (err: any) {
           return { hash: null, status: "failed", error: err.message ?? "Simulation failed" };
        }
      }

      try {
        const contract = getSignedContract();
        const tx = await contract.listModel(
          params.name,
          params.description,
          ethers.parseEther(params.price),
          params.ipfsHash,
          params.version,
          params.license,
          params.category,
          params.royaltyPercent
        );
        const receipt = await tx.wait();
        // The backend event listener records the listed model asynchronously.
        return { hash: receipt.hash, status: "confirmed", error: null };
      } catch (err: any) {
        return {
          hash: null,
          status: "failed",
          error: err.reason ?? err.message ?? "Deploy failed",
        };
      }
    },
    [getSignedContract, address]
  );

  // ── Withdraw ────────────────────────────────────────────────────────────────
  const withdrawEarnings = useCallback(async (): Promise<Transaction> => {
    if (!isContractDeployed()) {
      await new Promise((r) => setTimeout(r, 1500));
      return { hash: "0xdemo...withdraw", status: "confirmed", error: null };
    }
    try {
      const contract = getSignedContract();
      const tx = await contract.withdrawEarnings();
      const receipt = await tx.wait();
      return { hash: receipt.hash, status: "confirmed", error: null };
    } catch (err: any) {
      return {
        hash: null,
        status: "failed",
        error: err.reason ?? err.message ?? "Withdrawal failed",
      };
    }
  }, [getSignedContract]);

  // ── Earnings ────────────────────────────────────────────────────────────────
  const getEarnings = useCallback(async (): Promise<string> => {
    if (!address) return "0";
    if (!isContractDeployed() || !provider) return "1.24";
    try {
      const contract = getContract(provider);
      const raw = await contract.getCreatorEarnings(address);
      return ethers.formatEther(raw);
    } catch {
      return "0";
    }
  }, [address, provider, getContract]);

  // ── Access check ────────────────────────────────────────────────────────────
  const checkAccess = useCallback(
    async (modelId: number): Promise<boolean> => {
      if (!address) return false;

      // Check Supabase purchases table first (works even off-chain)
      if (isSupabaseReady()) {
        const { data } = await supabase
          .from("purchases")
          .select("id")
          .eq("model_id", modelId)
          .eq("buyer_address", address.toLowerCase())
          .maybeSingle();
        if (data) return true;
      }

      if (!isContractDeployed() || !provider) return false;
      try {
        const contract = getContract(provider);
        return await contract.hasAccess(modelId, address);
      } catch {
        return false;
      }
    },
    [address, provider, getContract]
  );

  // ── FIX 6: Real gas estimation ──────────────────────────────────────────────
  const estimateListGas = useCallback(
    async (params: {
      name: string;
      price: string;
      ipfsHash: string;
      royaltyPercent: number;
    }): Promise<string | null> => {
      if (!signer || !isContractDeployed()) return null;
      try {
        const contract = getSignedContract();
        const gasUnits = await contract.listModel.estimateGas(
          params.name,
          "Description placeholder",
          ethers.parseEther(params.price || "0.01"),
          params.ipfsHash || "QmPlaceholder",
          "1.0.0",
          "MIT",
          "NLP",
          params.royaltyPercent
        );
        const feeData = await provider!.getFeeData();
        const gasPrice = feeData.gasPrice ?? ethers.parseUnits("20", "gwei");
        const gasCostWei = gasUnits * gasPrice;
        return ethers.formatEther(gasCostWei);
      } catch {
        return null;
      }
    },
    [signer, provider, getSignedContract]
  );

  return {
    purchaseModel,
    listModel,
    withdrawEarnings,
    getEarnings,
    checkAccess,
    estimateListGas,
    isDemo: !isContractDeployed() && !isSupabaseReady(),
  };
}
