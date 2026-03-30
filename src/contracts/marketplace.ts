/**
 * ModelChain Marketplace — Contract ABI & Config
 * v2: includes escrow, staking, pause, setModelActive, platform fees
 *
 * After redeploying the v2 contract, paste the new address into MARKETPLACE_ADDRESS.
 */

// ── Full v2 ABI ───────────────────────────────────────────────────────────────
export const MARKETPLACE_ABI = [
  // ── Events ──────────────────────────────────────────────────────────────────
  "event ModelListed(uint256 indexed modelId, address indexed creator, uint256 price, string ipfsHash)",
  "event ModelUpdated(uint256 indexed modelId, bool active)",
  "event ModelPurchased(uint256 indexed modelId, address indexed buyer, uint256 price, uint256 escrowId)",
  "event EscrowReleased(uint256 indexed escrowId, address indexed creator, uint256 amount)",
  "event EscrowRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount)",
  "event EarningsWithdrawn(address indexed creator, uint256 amount)",
  "event NodeStaked(address indexed node, uint256 amount)",
  "event NodeUnstaked(address indexed node, uint256 amount)",
  "event NodeSlashed(address indexed node, uint256 amount, string reason)",
  "event PlatformFeeUpdated(uint256 newBps)",
  "event EscrowTimeoutUpdated(uint256 newTimeout)",

  // ── Read functions ───────────────────────────────────────────────────────────
  // Model struct now includes `active` field
  "function getModel(uint256 modelId) view returns (tuple(uint256 id, string name, string description, uint256 price, address creator, string ipfsHash, string version, string license, string category, uint256 royaltyPercent, uint256 purchases, bool active))",
  "function getAllModels() view returns (tuple(uint256 id, string name, string description, uint256 price, address creator, string ipfsHash, string version, string license, string category, uint256 royaltyPercent, uint256 purchases, bool active)[])",
  "function getModels(uint256 offset, uint256 limit) view returns (tuple(uint256 id, string name, string description, uint256 price, address creator, string ipfsHash, string version, string license, string category, uint256 royaltyPercent, uint256 purchases, bool active)[], uint256)",
  "function getCreatorEarnings(address creator) view returns (uint256)",
  "function hasAccess(uint256 modelId, address user) view returns (bool)",
  "function modelCount() view returns (uint256)",
  "function escrowTimeout() view returns (uint256)",
  "function platformFeeBps() view returns (uint256)",
  "function platformEarnings() view returns (uint256)",
  "function minStake() view returns (uint256)",
  "function paused() view returns (bool)",
  // Escrow entry: modelId, buyer, amount, createdAt, released, refunded
  "function escrows(uint256 escrowId) view returns (uint256 modelId, address buyer, uint256 amount, uint256 createdAt, bool released, bool refunded)",
  "function buyerEscrow(uint256 modelId, address buyer) view returns (uint256 escrowId)",
  // Node stake: amount, stakedAt, slashed
  "function getNodeStake(address node) view returns (tuple(uint256 amount, uint256 stakedAt, bool slashed))",

  // ── Write functions — Model management ──────────────────────────────────────
  "function listModel(string name, string description, uint256 price, string ipfsHash, string version, string license, string category, uint256 royaltyPercent) returns (uint256)",
  "function setModelActive(uint256 modelId, bool active)",

  // ── Write functions — Purchase & Escrow ─────────────────────────────────────
  "function purchaseModel(uint256 modelId) payable",
  "function confirmDelivery(uint256 escrowId)",
  "function releaseEscrow(uint256 escrowId)",

  // ── Write functions — Earnings ───────────────────────────────────────────────
  "function withdrawEarnings()",

  // ── Write functions — Staking ────────────────────────────────────────────────
  "function stake() payable",
  "function unstake()",

  // ── Write functions — Admin (owner only) ────────────────────────────────────
  "function pause()",
  "function unpause()",
  "function setPlatformFee(uint256 bps)",
  "function setEscrowTimeout(uint256 timeout)",
  "function setMinStake(uint256 amount)",
  "function slash(address node, string reason)",
  "function refundEscrow(uint256 escrowId)",
  "function withdrawPlatformFees()",
];

// ── Deployed address — set via VITE_CONTRACT_ADDRESS env var ─────────────────
const _addr = import.meta.env.VITE_CONTRACT_ADDRESS;
console.log("ENV CHECK:", import.meta.env.VITE_CONTRACT_ADDRESS);
if (!_addr || _addr === "0xPLACEHOLDER") {
  throw new Error(
    "VITE_CONTRACT_ADDRESS is not set. Deploy the contract and set this env var."
  );
}
export const MARKETPLACE_ADDRESS: string = _addr;

export const SUPPORTED_CHAINS: Record<number, string> = {
  1:        "Ethereum Mainnet",
  11155111: "Sepolia Testnet",
  31337:    "Hardhat Local",
};
