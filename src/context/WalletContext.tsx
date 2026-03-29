import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { ethers } from "ethers";
import { logEvent } from "../lib/analytics";
import type { WalletState } from "../types";

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  provider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    address: null,
    balance: null,
    chainId: null,
    isConnecting: false,
    error: null,
  });
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);

  const getEthereum = () => (window as any).ethereum ?? null;

  const loadWalletData = useCallback(async (eth: any) => {
    const p = new ethers.BrowserProvider(eth);
    const s = await p.getSigner();
    const addr = await s.getAddress();
    const bal = await p.getBalance(addr);
    const network = await p.getNetwork();
    setProvider(p);
    setSigner(s);
    setState({
      address: addr,
      balance: ethers.formatEther(bal),
      chainId: Number(network.chainId),
      isConnecting: false,
      error: null,
    });
  }, []);

  // Auto-reconnect if previously connected
  useEffect(() => {
    const eth = getEthereum();
    if (!eth) return;
    eth.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts.length > 0) loadWalletData(eth).catch(() => {});
    });
  }, [loadWalletData]);

  // Listen for account/chain changes
  useEffect(() => {
    const eth = getEthereum();
    if (!eth) return;
    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) disconnect();
      else loadWalletData(eth).catch(() => {});
    };
    const onChainChanged = () => loadWalletData(eth).catch(() => {});
    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);
    return () => {
      eth.removeListener("accountsChanged", onAccountsChanged);
      eth.removeListener("chainChanged", onChainChanged);
    };
  }, [loadWalletData]);

  const connect = useCallback(async () => {
    const eth = getEthereum();
    logEvent("wallet_connect_clicked");
    if (!eth) {
      setState((s) => ({
        ...s,
        error: "MetaMask not detected. Please install it from metamask.io",
      }));
      return;
    }
    setState((s) => ({ ...s, isConnecting: true, error: null }));
    try {
      await eth.request({ method: "eth_requestAccounts" });
      await loadWalletData(eth);
      logEvent("wallet_connect_success");
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isConnecting: false,
        error:
          err.code === 4001
            ? "Connection rejected by user."
            : err.message ?? "Failed to connect wallet.",
      }));
      logEvent("wallet_connect_failed", { errorCode: err.code, errorMessage: err.message });
    }
  }, [loadWalletData]);

  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setState({
      address: null,
      balance: null,
      chainId: null,
      isConnecting: false,
      error: null,
    });
  }, []);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, provider, signer }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
