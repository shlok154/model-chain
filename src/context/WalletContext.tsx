import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount, useBalance, useChainId, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ethers } from "ethers";
import type { WalletState } from "../types";

const _targetChainEnv = import.meta.env.VITE_TARGET_CHAIN;
const TARGET_CHAIN_ID: number = _targetChainEnv ? Number(_targetChainEnv) : 11155111;

interface WalletContextValue extends WalletState {
  connect: () => void;
  disconnect: () => void;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  wrongNetwork: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, isConnecting, isReconnecting } = useAccount();
  const rawChainId = useChainId();
  const [activeChainId, setActiveChainId] = useState<number>(rawChainId);
  const { data: balanceData } = useBalance({ address });
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    setActiveChainId(rawChainId);
  }, [rawChainId]);

  useEffect(() => {
    if (!(window as any).ethereum) return;

    const handleChainChanged = (chainIdHex: string) => {
      const newChainId = parseInt(chainIdHex, 16);
      setActiveChainId(newChainId);
    };

    (window as any).ethereum.on("chainChanged", handleChainChanged);

    return () => {
      (window as any).ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  const balanceString = balanceData ? parseFloat(balanceData.formatted).toFixed(4) : null;
  const wrongNetwork = !!address && activeChainId !== TARGET_CHAIN_ID;

  const value: WalletContextValue = {
    address: (address as `0x${string}`) ?? null,
    balance: balanceString,
    chainId: activeChainId ?? null,
    isConnecting: isConnecting || isReconnecting,
    error: null,
    connect: () => openConnectModal?.(),
    disconnect: () => disconnect(),
    provider: null,
    signer: null,
    wrongNetwork,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
