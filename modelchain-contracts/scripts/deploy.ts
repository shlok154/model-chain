import "dotenv/config";
import hre from "hardhat";
import { ethers } from "ethers";

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_SEPOLIA_URL);
  const wallet = new ethers.Wallet(`0x${process.env.PRIVATE_KEY}`, provider);

  const artifact = await hre.artifacts.readArtifact("ModelChainMarketplace");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  const contract = await factory.deploy();
  await contract.waitForDeployment();
  console.log("✅ Deployed to:", await contract.getAddress());
}

main().catch((e) => { console.error(e); process.exit(1); });