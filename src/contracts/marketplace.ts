// ModelChain Marketplace Contract ABI
// Deploy this contract on Sepolia testnet for real integration
export const MARKETPLACE_ABI = [
  // Events
  "event ModelListed(uint256 indexed modelId, address indexed creator, uint256 price, string ipfsHash)",
  "event ModelPurchased(uint256 indexed modelId, address indexed buyer, uint256 price)",
  "event EarningsWithdrawn(address indexed creator, uint256 amount)",

  // Read functions
  "function getModel(uint256 modelId) view returns (tuple(uint256 id, string name, string description, uint256 price, address creator, string ipfsHash, string version, string license, string category, uint256 royaltyPercent, uint256 purchases))",
  "function getAllModels() view returns (tuple(uint256 id, string name, string description, uint256 price, address creator, string ipfsHash, string version, string license, string category, uint256 royaltyPercent, uint256 purchases)[])",
  "function getCreatorEarnings(address creator) view returns (uint256)",
  "function hasAccess(uint256 modelId, address user) view returns (bool)",
  "function modelCount() view returns (uint256)",

  // Write functions
  "function listModel(string name, string description, uint256 price, string ipfsHash, string version, string license, string category, uint256 royaltyPercent) returns (uint256)",
  "function purchaseModel(uint256 modelId) payable",
  "function withdrawEarnings()",
];

// Sepolia testnet contract address — replace with your deployed address
export const MARKETPLACE_ADDRESS =
  "0x0000000000000000000000000000000000000000";

export const SUPPORTED_CHAINS: Record<number, string> = {
  1: "Ethereum Mainnet",
  11155111: "Sepolia Testnet",
  31337: "Hardhat Local",
};

// Solidity source for reference — deploy with Hardhat/Foundry
export const CONTRACT_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ModelChainMarketplace {
    struct Model {
        uint256 id;
        string name;
        string description;
        uint256 price;
        address creator;
        string ipfsHash;
        string version;
        string license;
        string category;
        uint256 royaltyPercent;
        uint256 purchases;
    }

    uint256 public modelCount;
    mapping(uint256 => Model) private models;
    mapping(address => uint256) public earnings;
    mapping(uint256 => mapping(address => bool)) public access;

    event ModelListed(uint256 indexed modelId, address indexed creator, uint256 price, string ipfsHash);
    event ModelPurchased(uint256 indexed modelId, address indexed buyer, uint256 price);
    event EarningsWithdrawn(address indexed creator, uint256 amount);

    function listModel(
        string memory name,
        string memory description,
        uint256 price,
        string memory ipfsHash,
        string memory version,
        string memory license,
        string memory category,
        uint256 royaltyPercent
    ) external returns (uint256) {
        require(royaltyPercent <= 50, "Royalty too high");
        modelCount++;
        models[modelCount] = Model(
            modelCount, name, description, price,
            msg.sender, ipfsHash, version, license,
            category, royaltyPercent, 0
        );
        access[modelCount][msg.sender] = true;
        emit ModelListed(modelCount, msg.sender, price, ipfsHash);
        return modelCount;
    }

    function purchaseModel(uint256 modelId) external payable {
        Model storage model = models[modelId];
        require(model.id != 0, "Model not found");
        require(msg.value >= model.price, "Insufficient payment");
        require(!access[modelId][msg.sender], "Already purchased");
        access[modelId][msg.sender] = true;
        model.purchases++;
        earnings[model.creator] += msg.value;
        emit ModelPurchased(modelId, msg.sender, msg.value);
    }

    function withdrawEarnings() external {
        uint256 amount = earnings[msg.sender];
        require(amount > 0, "No earnings");
        earnings[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
        emit EarningsWithdrawn(msg.sender, amount);
    }

    function getModel(uint256 modelId) external view returns (Model memory) {
        return models[modelId];
    }

    function getAllModels() external view returns (Model[] memory) {
        Model[] memory all = new Model[](modelCount);
        for (uint256 i = 1; i <= modelCount; i++) {
            all[i - 1] = models[i];
        }
        return all;
    }

    function getCreatorEarnings(address creator) external view returns (uint256) {
        return earnings[creator];
    }

    function hasAccess(uint256 modelId, address user) external view returns (bool) {
        return access[modelId][user];
    }
}
`;
