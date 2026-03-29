// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Phase 2: OpenZeppelin security primitives
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ModelChainMarketplace v2
 * @notice Decentralized marketplace for AI model licensing on Ethereum.
 *
 * Changes from v1:
 *  - ReentrancyGuard on all ETH-moving functions
 *  - Ownable + Pausable (circuit breaker for emergencies)
 *  - Staking: node operators must stake ETH to participate
 *  - Slashing: owner can slash misbehaving node stakes
 *  - Escrow: purchase funds held until buyer confirms or timeout passes
 *  - Overpayment refund fix (carried from v1 fix)
 *  - safe call{} withdrawal (carried from v1 fix)
 *  - Paginated getModels()
 */
contract ModelChainMarketplace is ReentrancyGuard, Ownable, Pausable {

    // ── Structs ──────────────────────────────────────────────────────────────

    struct Model {
        uint256 id;
        string  name;
        string  description;
        uint256 price;
        address creator;
        string  ipfsHash;
        string  version;
        string  license;
        string  category;
        uint256 royaltyPercent;
        uint256 purchases;
        bool    active;         // owner/creator can deactivate
    }

    // Escrow: buyer pays → funds locked → confirmed or auto-released after timeout
    struct EscrowEntry {
        uint256 modelId;
        address buyer;
        uint256 amount;          // exact model.price paid
        uint256 createdAt;       // block.timestamp at purchase
        bool    released;        // true once funds moved to creator
        bool    refunded;        // true if buyer got a refund
    }

    struct NodeStake {
        uint256 amount;
        uint256 stakedAt;
        bool    slashed;
    }

    // ── State ────────────────────────────────────────────────────────────────

    uint256 public modelCount;
    mapping(uint256 => Model)   private _models;
    mapping(address => uint256) public  earnings;
    mapping(uint256 => mapping(address => bool)) public access;

    // Escrow
    uint256 public escrowTimeout = 7 days;
    uint256 private _escrowCount;
    mapping(uint256 => EscrowEntry) public escrows;         // escrowId → entry
    mapping(uint256 => mapping(address => uint256)) public buyerEscrow; // modelId → buyer → escrowId

    // Staking
    uint256 public minStake = 0.01 ether;
    mapping(address => NodeStake) public nodeStakes;

    // Platform fee (basis points — 100 = 1%)
    uint256 public platformFeeBps = 250;  // 2.5%
    uint256 public platformEarnings;

    // ── Events ───────────────────────────────────────────────────────────────

    event ModelListed(uint256 indexed modelId, address indexed creator, uint256 price, string ipfsHash);
    event ModelUpdated(uint256 indexed modelId, bool active);
    event ModelPurchased(uint256 indexed modelId, address indexed buyer, uint256 price, uint256 escrowId);
    event EscrowReleased(uint256 indexed escrowId, address indexed creator, uint256 amount);
    event EscrowRefunded(uint256 indexed escrowId, address indexed buyer, uint256 amount);
    event EarningsWithdrawn(address indexed creator, uint256 amount);
    event NodeStaked(address indexed node, uint256 amount);
    event NodeUnstaked(address indexed node, uint256 amount);
    event NodeSlashed(address indexed node, uint256 amount, string reason);
    event PlatformFeeUpdated(uint256 newBps);
    event EscrowTimeoutUpdated(uint256 newTimeout);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier modelExists(uint256 modelId) {
        require(_models[modelId].id != 0, "Model not found");
        _;
    }

    modifier modelActive(uint256 modelId) {
        require(_models[modelId].active, "Model not active");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ── Model Management ─────────────────────────────────────────────────────

    function listModel(
        string calldata name,
        string calldata description,
        uint256 price,
        string calldata ipfsHash,
        string calldata version,
        string calldata license,
        string calldata category,
        uint256 royaltyPercent
    ) external whenNotPaused returns (uint256) {
        require(price > 0, "Price must be > 0");
        require(royaltyPercent <= 50, "Royalty too high");
        require(bytes(name).length > 0, "Name required");
        require(bytes(ipfsHash).length > 0, "IPFS hash required");

        modelCount++;
        _models[modelCount] = Model({
            id:             modelCount,
            name:           name,
            description:    description,
            price:          price,
            creator:        msg.sender,
            ipfsHash:       ipfsHash,
            version:        version,
            license:        license,
            category:       category,
            royaltyPercent: royaltyPercent,
            purchases:      0,
            active:         true
        });
        access[modelCount][msg.sender] = true;
        emit ModelListed(modelCount, msg.sender, price, ipfsHash);
        return modelCount;
    }

    /// @notice Creator or owner can deactivate/reactivate a model.
    function setModelActive(uint256 modelId, bool active)
        external
        modelExists(modelId)
    {
        Model storage m = _models[modelId];
        require(msg.sender == m.creator || msg.sender == owner(), "Not authorized");
        m.active = active;
        emit ModelUpdated(modelId, active);
    }

    // ── Purchase (Escrow) ────────────────────────────────────────────────────

    /**
     * @notice Purchase a model. Funds are held in escrow until released.
     *         Buyer gains immediate access (optimistic), funds release after timeout
     *         or when buyer explicitly confirms. Creator can also pull after timeout.
     */
    function purchaseModel(uint256 modelId)
        external
        payable
        nonReentrant
        whenNotPaused
        modelExists(modelId)
        modelActive(modelId)
    {
        Model storage model = _models[modelId];
        require(msg.value >= model.price, "Insufficient payment");
        require(!access[modelId][msg.sender], "Already purchased");
        require(msg.sender != model.creator, "Creator already has access");

        // Grant optimistic access immediately
        access[modelId][msg.sender] = true;
        model.purchases++;

        // Platform fee
        uint256 fee     = (model.price * platformFeeBps) / 10_000;
        uint256 netPay  = model.price - fee;
        platformEarnings += fee;

        // Create escrow entry
        _escrowCount++;
        escrows[_escrowCount] = EscrowEntry({
            modelId:   modelId,
            buyer:     msg.sender,
            amount:    netPay,
            createdAt: block.timestamp,
            released:  false,
            refunded:  false
        });
        buyerEscrow[modelId][msg.sender] = _escrowCount;

        // Refund overpayment immediately
        uint256 excess = msg.value - model.price;
        if (excess > 0) {
            (bool ok,) = payable(msg.sender).call{value: excess}("");
            require(ok, "Refund failed");
        }

        emit ModelPurchased(modelId, msg.sender, model.price, _escrowCount);
    }

    /**
     * @notice Buyer explicitly confirms delivery → release funds to creator immediately.
     */
    function confirmDelivery(uint256 escrowId) external nonReentrant {
        EscrowEntry storage e = escrows[escrowId];
        require(e.buyer == msg.sender, "Not your escrow");
        require(!e.released && !e.refunded, "Already settled");

        e.released = true;
        earnings[_models[e.modelId].creator] += e.amount;
        emit EscrowReleased(escrowId, _models[e.modelId].creator, e.amount);
    }

    /**
     * @notice After timeout, creator (or anyone) can trigger fund release to creator.
     */
    function releaseEscrow(uint256 escrowId) external nonReentrant {
        EscrowEntry storage e = escrows[escrowId];
        require(!e.released && !e.refunded, "Already settled");
        require(block.timestamp >= e.createdAt + escrowTimeout, "Escrow timeout not reached");

        e.released = true;
        address creator = _models[e.modelId].creator;
        earnings[creator] += e.amount;
        emit EscrowReleased(escrowId, creator, e.amount);
    }

    /**
     * @notice Owner can refund buyer (e.g. malicious model reported).
     *         Revokes access too.
     */
    function refundEscrow(uint256 escrowId) external onlyOwner nonReentrant {
        EscrowEntry storage e = escrows[escrowId];
        require(!e.released && !e.refunded, "Already settled");

        e.refunded = true;
        access[e.modelId][e.buyer] = false;   // revoke access

        (bool ok,) = payable(e.buyer).call{value: e.amount}("");
        require(ok, "Refund transfer failed");
        emit EscrowRefunded(escrowId, e.buyer, e.amount);
    }

    // ── Earnings ─────────────────────────────────────────────────────────────

    function withdrawEarnings() external nonReentrant {
        uint256 amount = earnings[msg.sender];
        require(amount > 0, "No earnings");
        earnings[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Withdrawal failed");
        emit EarningsWithdrawn(msg.sender, amount);
    }

    function withdrawPlatformFees() external onlyOwner nonReentrant {
        uint256 amount = platformEarnings;
        require(amount > 0, "No platform fees");
        platformEarnings = 0;
        (bool ok,) = payable(owner()).call{value: amount}("");
        require(ok, "Platform withdrawal failed");
    }

    // ── Staking ───────────────────────────────────────────────────────────────

    /**
     * @notice Node operators stake ETH to participate in the compute network.
     *         Staked ETH can be slashed by the owner for misbehaviour.
     */
    function stake() external payable whenNotPaused {
        require(msg.value >= minStake, "Below minimum stake");
        require(!nodeStakes[msg.sender].slashed, "Slashed nodes cannot re-stake");
        nodeStakes[msg.sender].amount  += msg.value;
        nodeStakes[msg.sender].stakedAt = block.timestamp;
        emit NodeStaked(msg.sender, msg.value);
    }

    /**
     * @notice Unstake — returns full stake minus any prior slash.
     */
    function unstake() external nonReentrant {
        NodeStake storage s = nodeStakes[msg.sender];
        require(s.amount > 0, "Nothing staked");
        require(!s.slashed, "Stake was slashed");

        uint256 amount = s.amount;
        s.amount = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Unstake transfer failed");
        emit NodeUnstaked(msg.sender, amount);
    }

    /**
     * @notice Slash a misbehaving node's stake.
     *         Slashed funds go to platformEarnings (could be redistributed to reporters).
     */
    function slash(address node, string calldata reason) external onlyOwner nonReentrant {
        NodeStake storage s = nodeStakes[node];
        require(s.amount > 0, "No stake to slash");
        require(!s.slashed, "Already slashed");

        uint256 amount = s.amount;
        s.amount  = 0;
        s.slashed = true;
        platformEarnings += amount;
        emit NodeSlashed(node, amount, reason);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setPlatformFee(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Fee too high");  // max 10%
        platformFeeBps = bps;
        emit PlatformFeeUpdated(bps);
    }

    function setEscrowTimeout(uint256 timeout) external onlyOwner {
        require(timeout >= 1 hours && timeout <= 30 days, "Timeout out of range");
        escrowTimeout = timeout;
        emit EscrowTimeoutUpdated(timeout);
    }

    function setMinStake(uint256 amount) external onlyOwner {
        minStake = amount;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getModel(uint256 modelId)
        external view modelExists(modelId)
        returns (Model memory) {
        return _models[modelId];
    }

    function getModels(uint256 offset, uint256 limit)
        external view
        returns (Model[] memory page, uint256 total)
    {
        total = modelCount;
        if (offset >= total) return (new Model[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 length = end - offset;
        page = new Model[](length);
        for (uint256 i = 0; i < length; i++) {
            page[i] = _models[offset + i + 1];
        }
    }

    function getAllModels() external view returns (Model[] memory) {
        uint256 count = modelCount > 500 ? 500 : modelCount;
        Model[] memory all = new Model[](count);
        for (uint256 i = 0; i < count; i++) all[i] = _models[i + 1];
        return all;
    }

    function getCreatorEarnings(address creator) external view returns (uint256) {
        return earnings[creator];
    }

    function hasAccess(uint256 modelId, address user) external view returns (bool) {
        return access[modelId][user];
    }

    function getNodeStake(address node) external view returns (NodeStake memory) {
        return nodeStakes[node];
    }
}
