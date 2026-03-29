import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";

import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: "0.8.20",

  networks: {
    sepolia: {
      type: "http",
      url: process.env.ALCHEMY_SEPOLIA_URL || "",
      accounts: process.env.PRIVATE_KEY
        ? [`0x${process.env.PRIVATE_KEY}`]
        : [],
    },
  },
};

export default config;