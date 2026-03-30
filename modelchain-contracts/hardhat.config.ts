import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";

import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    sepolia: {
      url: process.env.ALCHEMY_SEPOLIA_URL || "http://127.0.0.1:8545",
      accounts: process.env.PRIVATE_KEY
        ? [`0x${process.env.PRIVATE_KEY}`]
        : [],
    },
  },
};

export default config;