/**
 * Thin adapters that convert wagmi's viem-based clients into ethers v6
 * compatible Signer and Provider objects.
 * Source: https://wagmi.sh/react/guides/ethers
 */
import { useMemo } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import type { WalletClient, PublicClient } from "viem";

function walletClientToSigner(walletClient: WalletClient): JsonRpcSigner {
  const { account, chain, transport } = walletClient;
  const network = {
    chainId: chain!.id,
    name: chain!.name,
  };
  const provider = new BrowserProvider(transport as any, network);
  return new JsonRpcSigner(provider, account!.address);
}

function publicClientToProvider(publicClient: PublicClient): BrowserProvider {
  const { chain, transport } = publicClient;
  const network = {
    chainId: chain!.id,
    name: chain!.name,
  };
  return new BrowserProvider(transport as any, network);
}

export function useEthersSigner() {
  const { data: walletClient } = useWalletClient();
  return useMemo(
    () => (walletClient ? walletClientToSigner(walletClient) : undefined),
    [walletClient]
  );
}

export function useEthersProvider() {
  const publicClient = usePublicClient();
  return useMemo(
    () => (publicClient ? publicClientToProvider(publicClient) : undefined),
    [publicClient]
  );
}
