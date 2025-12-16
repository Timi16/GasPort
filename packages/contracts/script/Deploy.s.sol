// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "forge-std/Script.sol";
import "../src/core/GasPortPaymaster.sol";
import "../src/treasury/GasPortTreasury.sol";
import "../src/routing/CrossChainRouter.sol";
import "../src/collateral/NFTVault.sol";
import "../src/collateral/FloorPriceOracle.sol";

/**
 * @title Deploy Script
 * @notice Deploys all GasPort contracts
 */
contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deploying contracts with address:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Treasury
        console.log("\n1. Deploying Treasury...");
        GasPortTreasury treasury = new GasPortTreasury(deployer);
        console.log("Treasury deployed at:", address(treasury));

        // 2. Deploy Router
        console.log("\n2. Deploying Router...");
        CrossChainRouter router = new CrossChainRouter(deployer);
        console.log("Router deployed at:", address(router));

        // 3. Deploy Paymaster
        console.log("\n3. Deploying Paymaster...");

        // Get EntryPoint address from environment or use default
        address entryPoint = vm.envOr(
            "ENTRY_POINT_ADDRESS",
            address(0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789) // v0.6 EntryPoint
        );

        GasPortPaymaster paymaster = new GasPortPaymaster(
            entryPoint,
            address(treasury),
            deployer
        );
        console.log("Paymaster deployed at:", address(paymaster));

        // 4. Configure Treasury
        console.log("\n4. Configuring Treasury...");
        treasury.setPaymaster(address(paymaster));
        treasury.setRouter(address(router));

        // Add supported tokens
        address[] memory tokens = new address[](5);
        tokens[0] = address(0); // ETH
        tokens[1] = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // USDC on Arbitrum One
        tokens[2] = 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9; // USDT on Arbitrum One
        tokens[3] = 0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1; // DAI on Arbitrum One
        tokens[4] = 0x912CE59144191C1204E64559FE8253a0e49E6548; // ARB on Arbitrum One

        for (uint256 i = 0; i < tokens.length; i++) {
            treasury.addToken(tokens[i]);
            paymaster.addToken(tokens[i]);
            console.log("Added token:", tokens[i]);
        }

        // 5. Configure Router
        console.log("\n5. Configuring Router...");
        router.addChain(block.chainid, address(treasury));

        // 6. Deploy NFT Collateral System
        console.log("\n6. Deploying NFT Collateral System...");

        FloorPriceOracle oracle = new FloorPriceOracle(deployer);
        console.log("Floor Price Oracle deployed at:", address(oracle));

        NFTVault vault = new NFTVault(deployer, address(oracle), address(paymaster));
        console.log("NFT Vault deployed at:", address(vault));

        // Add some popular NFT collections (optional)
        // Example: BAYC, Azuki, etc. - uncomment and update addresses as needed
        // oracle.addCollection(0x..., 10 ether); // Example: 10 ETH floor price

        vm.stopBroadcast();

        // Print deployment summary
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("EntryPoint:", entryPoint);
        console.log("\nContract Addresses:");
        console.log("Treasury:", address(treasury));
        console.log("Router:", address(router));
        console.log("Paymaster:", address(paymaster));
        console.log("NFT Vault:", address(vault));
        console.log("Floor Price Oracle:", address(oracle));
        console.log("\nAdd these to your .env file:");
        console.log("TREASURY_ADDRESS=%s", address(treasury));
        console.log("ROUTER_ADDRESS=%s", address(router));
        console.log("PAYMASTER_ADDRESS=%s", address(paymaster));
        console.log("NFT_VAULT_ADDRESS=%s", address(vault));
        console.log("FLOOR_PRICE_ORACLE_ADDRESS=%s", address(oracle));
    }
}
