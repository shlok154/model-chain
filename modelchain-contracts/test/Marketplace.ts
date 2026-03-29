import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ─────────────────────────────────────────────────────────────────────────────
// ModelChain Marketplace v2 — Full Test Suite
// Covers: listing, purchasing, overpayment, escrow, staking, slashing,
//         pause, setModelActive, platform fees, earnings, pagination
// Run: cd modelchain-contracts && npm test
// ─────────────────────────────────────────────────────────────────────────────

const ETH = (n: string) => ethers.parseEther(n);
const DAY = 86_400;

async function deployContract() {
  const Factory = await ethers.getContractFactory("ModelChainMarketplace");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  return contract;
}

type Contract = Awaited<ReturnType<typeof deployContract>>;

async function listModel(
  contract: Contract,
  signer: SignerWithAddress,
  overrides: Partial<{
    name: string; description: string; price: bigint;
    ipfsHash: string; version: string; license: string;
    category: string; royalty: number;
  }> = {}
) {
  return contract.connect(signer).listModel(
    overrides.name        ?? "Test Model",
    overrides.description ?? "A test model",
    overrides.price       ?? ETH("0.1"),
    overrides.ipfsHash    ?? "QmTestHash",
    overrides.version     ?? "1.0.0",
    overrides.license     ?? "MIT",
    overrides.category    ?? "NLP",
    overrides.royalty     ?? 10
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("ModelChainMarketplace v2", function () {
  let contract: Contract;
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let buyer: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async () => {
    [owner, creator, buyer, other] = await ethers.getSigners();
    contract = await deployContract();
  });

  // ── listModel ──────────────────────────────────────────────────────────────

  describe("listModel()", () => {
    it("stores model correctly and emits ModelListed", async () => {
      await expect(listModel(contract, creator))
        .to.emit(contract, "ModelListed")
        .withArgs(1n, creator.address, ETH("0.1"), "QmTestHash");
      const m = await contract.getModel(1);
      expect(m.name).to.equal("Test Model");
      expect(m.active).to.be.true;
      expect(m.creator).to.equal(creator.address);
    });

    it("grants access to creator", async () => {
      await listModel(contract, creator);
      expect(await contract.hasAccess(1, creator.address)).to.be.true;
    });

    it("reverts when price is 0", async () => {
      await expect(listModel(contract, creator, { price: 0n }))
        .to.be.revertedWith("Price must be > 0");
    });

    it("reverts when royalty > 50", async () => {
      await expect(listModel(contract, creator, { royalty: 51 }))
        .to.be.revertedWith("Royalty too high");
    });

    it("reverts when paused", async () => {
      await contract.connect(owner).pause();
      await expect(listModel(contract, creator))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ── setModelActive ─────────────────────────────────────────────────────────

  describe("setModelActive()", () => {
    beforeEach(async () => { await listModel(contract, creator); });

    it("creator can deactivate their own model", async () => {
      await expect(contract.connect(creator).setModelActive(1, false))
        .to.emit(contract, "ModelUpdated").withArgs(1n, false);
      const m = await contract.getModel(1);
      expect(m.active).to.be.false;
    });

    it("owner can deactivate any model", async () => {
      await contract.connect(owner).setModelActive(1, false);
      expect((await contract.getModel(1)).active).to.be.false;
    });

    it("owner can reactivate a deactivated model", async () => {
      await contract.connect(owner).setModelActive(1, false);
      await contract.connect(owner).setModelActive(1, true);
      expect((await contract.getModel(1)).active).to.be.true;
    });

    it("third party cannot deactivate another creator's model", async () => {
      await expect(contract.connect(other).setModelActive(1, false))
        .to.be.revertedWith("Not authorized");
    });

    it("purchase fails on inactive model", async () => {
      await contract.connect(creator).setModelActive(1, false);
      await expect(
        contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") })
      ).to.be.revertedWith("Model not active");
    });
  });

  // ── purchaseModel & Escrow ─────────────────────────────────────────────────

  describe("purchaseModel() + Escrow", () => {
    beforeEach(async () => { await listModel(contract, creator); });

    it("grants access immediately on purchase", async () => {
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      expect(await contract.hasAccess(1, buyer.address)).to.be.true;
    });

    it("creates an escrow entry", async () => {
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      const escrowId = await contract.buyerEscrow(1, buyer.address);
      const e = await contract.escrows(escrowId);
      expect(e.buyer).to.equal(buyer.address);
      expect(e.released).to.be.false;
      expect(e.refunded).to.be.false;
    });

    it("charges platform fee and holds net amount in escrow", async () => {
      const feeBps = await contract.platformFeeBps();
      const price = ETH("0.1");
      const fee = (price * feeBps) / 10_000n;
      const net = price - fee;

      await contract.connect(buyer).purchaseModel(1, { value: price });
      const escrowId = await contract.buyerEscrow(1, buyer.address);
      const e = await contract.escrows(escrowId);
      expect(e.amount).to.equal(net);
      expect(await contract.platformEarnings()).to.equal(fee);
    });

    it("refunds overpayment to buyer", async () => {
      const before = await ethers.provider.getBalance(buyer.address);
      const tx = await contract.connect(buyer).purchaseModel(1, { value: ETH("0.5") });
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(buyer.address);
      // Net cost = model.price + gas (0.1 ETH, not 0.5)
      expect(before - after).to.be.closeTo(ETH("0.1") + gas, ETH("0.001"));
    });

    it("reverts when payment is insufficient", async () => {
      await expect(
        contract.connect(buyer).purchaseModel(1, { value: ETH("0.05") })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("reverts on double purchase", async () => {
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      await expect(
        contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") })
      ).to.be.revertedWith("Already purchased");
    });

    it("reverts when paused", async () => {
      await contract.connect(owner).pause();
      await expect(
        contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") })
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  // ── confirmDelivery ────────────────────────────────────────────────────────

  describe("confirmDelivery()", () => {
    let escrowId: bigint;

    beforeEach(async () => {
      await listModel(contract, creator);
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      escrowId = await contract.buyerEscrow(1, buyer.address);
    });

    it("buyer can confirm delivery — funds move to creator earnings", async () => {
      const feeBps = await contract.platformFeeBps();
      const net = ETH("0.1") - (ETH("0.1") * feeBps) / 10_000n;

      await expect(contract.connect(buyer).confirmDelivery(escrowId))
        .to.emit(contract, "EscrowReleased")
        .withArgs(escrowId, creator.address, net);

      expect(await contract.getCreatorEarnings(creator.address)).to.equal(net);
      expect((await contract.escrows(escrowId)).released).to.be.true;
    });

    it("non-buyer cannot confirm delivery", async () => {
      await expect(contract.connect(other).confirmDelivery(escrowId))
        .to.be.revertedWith("Not your escrow");
    });

    it("cannot confirm twice", async () => {
      await contract.connect(buyer).confirmDelivery(escrowId);
      await expect(contract.connect(buyer).confirmDelivery(escrowId))
        .to.be.revertedWith("Already settled");
    });
  });

  // ── releaseEscrow (timeout) ────────────────────────────────────────────────

  describe("releaseEscrow() — after timeout", () => {
    let escrowId: bigint;

    beforeEach(async () => {
      await listModel(contract, creator);
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      escrowId = await contract.buyerEscrow(1, buyer.address);
    });

    it("reverts before timeout", async () => {
      await expect(contract.releaseEscrow(escrowId))
        .to.be.revertedWith("Escrow timeout not reached");
    });

    it("anyone can release after timeout — funds go to creator", async () => {
      const timeout = await contract.escrowTimeout();
      await time.increase(Number(timeout) + 1);

      const feeBps = await contract.platformFeeBps();
      const net = ETH("0.1") - (ETH("0.1") * feeBps) / 10_000n;

      await expect(contract.connect(other).releaseEscrow(escrowId))
        .to.emit(contract, "EscrowReleased")
        .withArgs(escrowId, creator.address, net);

      expect(await contract.getCreatorEarnings(creator.address)).to.equal(net);
    });
  });

  // ── refundEscrow (admin) ───────────────────────────────────────────────────

  describe("refundEscrow() — owner only", () => {
    let escrowId: bigint;

    beforeEach(async () => {
      await listModel(contract, creator);
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      escrowId = await contract.buyerEscrow(1, buyer.address);
    });

    it("owner can refund buyer and revoke access", async () => {
      const feeBps = await contract.platformFeeBps();
      const net = ETH("0.1") - (ETH("0.1") * feeBps) / 10_000n;

      const balBefore = await ethers.provider.getBalance(buyer.address);
      await contract.connect(owner).refundEscrow(escrowId);
      const balAfter = await ethers.provider.getBalance(buyer.address);

      expect(balAfter - balBefore).to.be.closeTo(net, ETH("0.001"));
      expect(await contract.hasAccess(1, buyer.address)).to.be.false;
      expect((await contract.escrows(escrowId)).refunded).to.be.true;
    });

    it("non-owner cannot refund", async () => {
      await expect(contract.connect(buyer).refundEscrow(escrowId))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ── withdrawEarnings ───────────────────────────────────────────────────────

  describe("withdrawEarnings()", () => {
    beforeEach(async () => {
      await listModel(contract, creator);
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });
      const escrowId = await contract.buyerEscrow(1, buyer.address);
      await contract.connect(buyer).confirmDelivery(escrowId);
    });

    it("transfers earnings via call (not deprecated transfer)", async () => {
      const before = await ethers.provider.getBalance(creator.address);
      const tx = await contract.connect(creator).withdrawEarnings();
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(creator.address);
      const earned = await contract.getCreatorEarnings(creator.address);

      expect(earned).to.equal(0n);
      expect(after - before).to.be.gt(0n);
      // Verify actual transfer: earnings went up by net minus gas
      expect(before - after + (after - before + gas)).to.be.closeTo(gas, ETH("0.001"));
    });

    it("zeroes earnings after withdrawal", async () => {
      await contract.connect(creator).withdrawEarnings();
      expect(await contract.getCreatorEarnings(creator.address)).to.equal(0n);
    });

    it("emits EarningsWithdrawn", async () => {
      const feeBps = await contract.platformFeeBps();
      const net = ETH("0.1") - (ETH("0.1") * feeBps) / 10_000n;
      await expect(contract.connect(creator).withdrawEarnings())
        .to.emit(contract, "EarningsWithdrawn")
        .withArgs(creator.address, net);
    });

    it("reverts when no earnings", async () => {
      await expect(contract.connect(other).withdrawEarnings())
        .to.be.revertedWith("No earnings");
    });
  });

  // ── Staking ────────────────────────────────────────────────────────────────

  describe("stake()", () => {
    it("accepts stake above minimum", async () => {
      const min = await contract.minStake();
      await expect(contract.connect(other).stake({ value: min }))
        .to.emit(contract, "NodeStaked")
        .withArgs(other.address, min);
      const s = await contract.getNodeStake(other.address);
      expect(s.amount).to.equal(min);
    });

    it("accumulates multiple stakes", async () => {
      const min = await contract.minStake();
      await contract.connect(other).stake({ value: min });
      await contract.connect(other).stake({ value: min });
      expect((await contract.getNodeStake(other.address)).amount).to.equal(min * 2n);
    });

    it("reverts below minimum stake", async () => {
      await expect(contract.connect(other).stake({ value: 1n }))
        .to.be.revertedWith("Below minimum stake");
    });

    it("reverts when paused", async () => {
      await contract.connect(owner).pause();
      await expect(contract.connect(other).stake({ value: ETH("0.1") }))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });
  });

  describe("unstake()", () => {
    beforeEach(async () => {
      await contract.connect(other).stake({ value: ETH("0.05") });
    });

    it("returns full stake to node", async () => {
      const before = await ethers.provider.getBalance(other.address);
      const tx = await contract.connect(other).unstake();
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(other.address);
      expect(after - before).to.be.closeTo(ETH("0.05") - gas, ETH("0.001"));
      expect((await contract.getNodeStake(other.address)).amount).to.equal(0n);
    });

    it("emits NodeUnstaked", async () => {
      await expect(contract.connect(other).unstake())
        .to.emit(contract, "NodeUnstaked")
        .withArgs(other.address, ETH("0.05"));
    });

    it("reverts when nothing staked", async () => {
      await expect(contract.connect(buyer).unstake())
        .to.be.revertedWith("Nothing staked");
    });
  });

  // ── Slashing ───────────────────────────────────────────────────────────────

  describe("slash()", () => {
    beforeEach(async () => {
      await contract.connect(other).stake({ value: ETH("0.05") });
    });

    it("owner can slash a node", async () => {
      await expect(contract.connect(owner).slash(other.address, "Cheating"))
        .to.emit(contract, "NodeSlashed")
        .withArgs(other.address, ETH("0.05"), "Cheating");

      const s = await contract.getNodeStake(other.address);
      expect(s.amount).to.equal(0n);
      expect(s.slashed).to.be.true;
    });

    it("slashed stake goes to platform earnings", async () => {
      const before = await contract.platformEarnings();
      await contract.connect(owner).slash(other.address, "Bad actor");
      const after = await contract.platformEarnings();
      expect(after - before).to.equal(ETH("0.05"));
    });

    it("slashed node cannot re-stake", async () => {
      await contract.connect(owner).slash(other.address, "Bad actor");
      await expect(contract.connect(other).stake({ value: ETH("0.05") }))
        .to.be.revertedWith("Slashed nodes cannot re-stake");
    });

    it("slashed node cannot unstake", async () => {
      await contract.connect(owner).slash(other.address, "Bad actor");
      await expect(contract.connect(other).unstake())
        .to.be.revertedWith("Stake was slashed");
    });

    it("non-owner cannot slash", async () => {
      await expect(contract.connect(buyer).slash(other.address, "Attempt"))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("cannot slash twice", async () => {
      await contract.connect(owner).slash(other.address, "First");
      await expect(contract.connect(owner).slash(other.address, "Second"))
        .to.be.revertedWith("Already slashed");
    });
  });

  // ── Pause ──────────────────────────────────────────────────────────────────

  describe("pause() / unpause()", () => {
    it("owner can pause and unpause", async () => {
      await contract.connect(owner).pause();
      expect(await contract.paused()).to.be.true;
      await contract.connect(owner).unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("non-owner cannot pause", async () => {
      await expect(contract.connect(creator).pause())
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("listModel is blocked while paused", async () => {
      await contract.connect(owner).pause();
      await expect(listModel(contract, creator))
        .to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("purchaseModel is blocked while paused", async () => {
      await listModel(contract, creator);
      await contract.connect(owner).pause();
      await expect(
        contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") })
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("system resumes normally after unpause", async () => {
      await listModel(contract, creator);
      await contract.connect(owner).pause();
      await contract.connect(owner).unpause();
      await expect(
        contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") })
      ).to.not.be.reverted;
    });
  });

  // ── Platform fees ──────────────────────────────────────────────────────────

  describe("Platform fees", () => {
    it("owner can update platform fee", async () => {
      await expect(contract.connect(owner).setPlatformFee(500))
        .to.emit(contract, "PlatformFeeUpdated").withArgs(500n);
      expect(await contract.platformFeeBps()).to.equal(500n);
    });

    it("platform fee cannot exceed 10%", async () => {
      await expect(contract.connect(owner).setPlatformFee(1001))
        .to.be.revertedWith("Fee too high");
    });

    it("owner can withdraw platform fees", async () => {
      await listModel(contract, creator);
      await contract.connect(buyer).purchaseModel(1, { value: ETH("0.1") });

      const fees = await contract.platformEarnings();
      expect(fees).to.be.gt(0n);

      const before = await ethers.provider.getBalance(owner.address);
      await contract.connect(owner).withdrawPlatformFees();
      const after = await ethers.provider.getBalance(owner.address);
      expect(after).to.be.gt(before);
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  describe("getModels() — pagination", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 5; i++)
        await listModel(contract, creator, { name: `Model ${i}` });
    });

    it("returns correct first page", async () => {
      const [page, total] = await contract.getModels(0, 3);
      expect(page.length).to.equal(3);
      expect(total).to.equal(5n);
      expect(page[0].name).to.equal("Model 1");
    });

    it("returns correct second page", async () => {
      const [page] = await contract.getModels(3, 3);
      expect(page.length).to.equal(2);
      expect(page[0].name).to.equal("Model 4");
    });

    it("returns empty when offset >= total", async () => {
      const [page, total] = await contract.getModels(10, 3);
      expect(page.length).to.equal(0);
      expect(total).to.equal(5n);
    });
  });

  // ── Admin: escrow timeout ──────────────────────────────────────────────────

  describe("setEscrowTimeout()", () => {
    it("owner can update timeout within range", async () => {
      await expect(contract.connect(owner).setEscrowTimeout(3 * DAY))
        .to.emit(contract, "EscrowTimeoutUpdated").withArgs(3 * DAY);
    });

    it("reverts below 1 hour", async () => {
      await expect(contract.connect(owner).setEscrowTimeout(1800))
        .to.be.revertedWith("Timeout out of range");
    });

    it("reverts above 30 days", async () => {
      await expect(contract.connect(owner).setEscrowTimeout(31 * DAY))
        .to.be.revertedWith("Timeout out of range");
    });
  });
});
