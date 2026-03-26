export interface UserProfile {
  wallet_address: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  twitter: string | null;
  github: string | null;
  is_verified: boolean;
  created_at: string;
}

export interface Model {
  id: number;
  name: string;
  description: string;
  price: string;
  priceWei: bigint;
  creator: string;
  ipfsHash: string;
  version: string;
  license: string;
  category: string;
  royaltyPercent: number;
  purchases: number;
}

export interface WalletState {
  address: string | null;
  balance: string | null;
  chainId: number | null;
  isConnecting: boolean;
  error: string | null;
}

export type TxStatus = "idle" | "pending" | "confirmed" | "failed";

export interface Transaction {
  hash: string | null;
  status: TxStatus;
  error: string | null;
}
