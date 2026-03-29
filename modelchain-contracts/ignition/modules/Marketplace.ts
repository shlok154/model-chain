import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MarketplaceModule", (m) => {
  const marketplace = m.contract("ModelChainMarketplace");
  return { marketplace };
});
