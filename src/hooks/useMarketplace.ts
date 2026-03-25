import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { MARKETPLACE_ABI, MARKETPLACE_ADDRESS } from "../contracts/marketplace";
import { supabase, isSupabaseReady } from "../lib/supabase";
import type { Model, Transaction } from "../types";

const DEMO_MODELS: Model[] = [
  { id: 1, name: "Sentiment Analyzer Pro", description: "Fine-tuned BERT for real-time sentiment classification across 12 languages with 94.3% accuracy.", price: "0.08", priceWei: ethers.parseEther("0.08"), creator: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", ipfsHash: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco", version: "2.1.0", license: "MIT", category: "NLP", royaltyPercent: 10, purchases: 142 },
  { id: 2, name: "VisionNet Edge", description: "Lightweight object detection model optimized for edge deployment. Runs at 60fps on mobile GPUs.", price: "0.14", priceWei: ethers.parseEther("0.14"), creator: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B", ipfsHash: "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o", version: "1.3.2", license: "Apache 2.0", category: "Computer Vision", royaltyPercent: 8, purchases: 89 },
  { id: 3, name: "LLM Mini 7B", description: "Quantized 7B parameter language model, fine-tuned for code generation and debugging tasks.", price: "0.22", priceWei: ethers.parseEther("0.22"), creator: "0x1db3439a222c519ab44bb1144fC28167b4Fa6EE6", ipfsHash: "QmSiTko9JZyabH56y2fussEt1A5oDqsFXB3CkvAqraFryz", version: "1.0.0", license: "CC BY-NC 4.0", category: "LLM", royaltyPercent: 15, purchases: 311 },
  { id: 4, name: "AudioClip Transcriber", description: "Whisper-based transcription model with speaker diarization. 98.1% accuracy on clean audio.", price: "0.06", priceWei: ethers.parseEther("0.06"), creator: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", ipfsHash: "QmfM2r8seH2GiRaC4esTjeraXEachRt8ZsSeGaWTPLyMoG", version: "3.0.1", license: "MIT", category: "Audio", royaltyPercent: 12, purchases: 204 },
  { id: 5, name: "TabularNet Regressor", description: "XGBoost-neural hybrid for tabular regression. Outperforms vanilla XGBoost by 18% on benchmark datasets.", price: "0.05", priceWei: ethers.parseEther("0.05"), creator: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B", ipfsHash: "QmNLei78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8z", version: "1.1.0", license: "MIT", category: "Tabular", royaltyPercent: 5, purchases: 57 },
  { id: 6, name: "DiffusionXL Fine-Tuner", description: "SDXL LoRA trained on 50k curated art images. Produces stunning photorealistic renders.", price: "0.35", priceWei: ethers.parseEther("0.35"), creator: "0x1db3439a222c519ab44bb1144fC28167b4Fa6EE6", ipfsHash: "QmYwAPJzv5CZsnAzt8auV39s1XRd9a6PqXqjS8Zs6jPBp4", version: "2.0.0", license: "CC BY 4.0", category: "Generative", royaltyPercent: 20, purchases: 478 },
];

function isContractDeployed() {
  return MARKETPLACE_ADDRESS !== "0x0000000000000000000000000000000000000000";
}

function rowToModel(row: any): Model {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price_eth,
    priceWei: ethers.parseEther(row.price_eth),
    creator: row.creator_address,
    ipfsHash: row.ipfs_hash,
    version: row.version,
    license: row.license,
    category: row.category,
    royaltyPercent: row.royalty_percent,
    purchases: row.purchases ?? 0,
  };
}

export function useMarketplace() {
  const { signer, provider, address } = useWallet();
  const [models, setModels] = useState<Model[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getContract = useCallback(() => {
    if (!signer) throw new Error("Wallet not connected");
    return new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
  }, [signer]);

  const fetchModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (isSupabaseReady()) {
        const { data, error: dbErr } = await supabase
          .from("models")
          .select("*")
          .order("created_at", { ascending: false });
        if (dbErr) throw dbErr;
        setModels((data ?? []).map(rowToModel));
        return;
      }
      if (isContractDeployed() && provider) {
        const contract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);
        const raw = await contract.getAllModels();
        setModels(raw.map((m: any) => ({
          id: Number(m.id), name: m.name, description: m.description,
          price: ethers.formatEther(m.price), priceWei: m.price,
          creator: m.creator, ipfsHash: m.ipfsHash, version: m.version,
          license: m.license, category: m.category,
          royaltyPercent: Number(m.royaltyPercent), purchases: Number(m.purchases),
        })));
        return;
      }
      await new Promise((r) => setTimeout(r, 600));
      setModels(DEMO_MODELS);
    } catch (err: any) {
      setError(err.message ?? "Failed to fetch models");
      setModels(DEMO_MODELS);
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

  const purchaseModel = useCallback(
    async (modelId: number, priceWei: bigint): Promise<Transaction> => {
      if (!isContractDeployed()) {
        await new Promise((r) => setTimeout(r, 1500));
        if (isSupabaseReady()) {
          await supabase.rpc("increment_purchases", { model_id: modelId });
        }
        return { hash: "0xdemo...tx", status: "confirmed", error: null };
      }
      try {
        const contract = getContract();
        const tx = await contract.purchaseModel(modelId, { value: priceWei });
        const receipt = await tx.wait();
        if (isSupabaseReady()) {
          await supabase.rpc("increment_purchases", { model_id: modelId });
        }
        return { hash: receipt.hash, status: "confirmed", error: null };
      } catch (err: any) {
        return { hash: null, status: "failed", error: err.code === 4001 ? "Transaction rejected by user." : err.reason ?? err.message ?? "Transaction failed" };
      }
    },
    [getContract]
  );

  const listModel = useCallback(
    async (params: { name: string; description: string; price: string; ipfsHash: string; version: string; license: string; category: string; royaltyPercent: number; }): Promise<Transaction> => {
      if (!address) return { hash: null, status: "failed", error: "Wallet not connected" };

      if (!isContractDeployed()) {
        await new Promise((r) => setTimeout(r, 1200));
        if (isSupabaseReady()) {
          const { error: dbErr } = await supabase.from("models").insert({
            name: params.name, description: params.description, price_eth: params.price,
            ipfs_hash: params.ipfsHash, version: params.version, license: params.license,
            category: params.category, royalty_percent: params.royaltyPercent,
            creator_address: address.toLowerCase(),
          });
          if (dbErr) return { hash: null, status: "failed", error: dbErr.message };
        }
        return { hash: "0xdemo...deploy", status: "confirmed", error: null };
      }

      try {
        const contract = getContract();
        const tx = await contract.listModel(params.name, params.description, ethers.parseEther(params.price), params.ipfsHash, params.version, params.license, params.category, params.royaltyPercent);
        const receipt = await tx.wait();
        if (isSupabaseReady()) {
          await supabase.from("models").insert({
            name: params.name, description: params.description, price_eth: params.price,
            ipfs_hash: params.ipfsHash, version: params.version, license: params.license,
            category: params.category, royalty_percent: params.royaltyPercent,
            creator_address: address.toLowerCase(), tx_hash: receipt.hash,
          });
        }
        return { hash: receipt.hash, status: "confirmed", error: null };
      } catch (err: any) {
        return { hash: null, status: "failed", error: err.reason ?? err.message ?? "Deploy failed" };
      }
    },
    [getContract, address]
  );

  const withdrawEarnings = useCallback(async (): Promise<Transaction> => {
    if (!isContractDeployed()) {
      await new Promise((r) => setTimeout(r, 1500));
      return { hash: "0xdemo...withdraw", status: "confirmed", error: null };
    }
    try {
      const contract = getContract();
      const tx = await contract.withdrawEarnings();
      const receipt = await tx.wait();
      return { hash: receipt.hash, status: "confirmed", error: null };
    } catch (err: any) {
      return { hash: null, status: "failed", error: err.reason ?? err.message ?? "Withdrawal failed" };
    }
  }, [getContract]);

  const getEarnings = useCallback(async (): Promise<string> => {
    if (!address) return "0";
    if (!isContractDeployed() || !provider) return "1.24";
    try {
      const contract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);
      const raw = await contract.getCreatorEarnings(address);
      return ethers.formatEther(raw);
    } catch { return "0"; }
  }, [address, provider]);

  const checkAccess = useCallback(async (modelId: number): Promise<boolean> => {
    if (!address || !isContractDeployed() || !provider) return false;
    try {
      const contract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, provider);
      return await contract.hasAccess(modelId, address);
    } catch { return false; }
  }, [address, provider]);

  return {
    models, isLoading, error,
    fetchModels, purchaseModel, listModel, withdrawEarnings, getEarnings, checkAccess,
    isDemo: !isContractDeployed() && !isSupabaseReady(),
  };
}
