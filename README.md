# GasPort SDK

> Cross-chain gas abstraction for Arbitrum/Orbit chains - Pay gas fees on any chain using any token

[![CI](https://github.com/yourusername/gasport-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/gasport-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/%40gasport%2Fsdk.svg)](https://www.npmjs.com/package/@gasport/sdk)

## 🎯 Overview

GasPort allows users to pay gas fees on any Arbitrum/Orbit chain using any supported token from any supported chain. Built on EIP-4337 (Account Abstraction) with native cross-chain routing.

### Key Features

- ✅ **Cross-Chain Gas Payments** - Pay gas on Arbitrum One with USDC from XAI
- ✅ **Multi-Token Support** - Use ETH, USDC, USDT, ARB, DAI, or any whitelisted token
- ✅ **EIP-4337 Compliant** - Built on Account Abstraction standard
- ✅ **Optimal Routing** - Automatic pathfinding for lowest cost & fastest execution
- ✅ **NFT Collateral** - Stake NFTs to get gas credit
- ✅ **Batch Transactions** - Bundle multiple operations for gas savings
- ✅ **TypeScript First** - Fully typed SDK with excellent DX

## 📦 Installation

```bash
# Using pnpm
pnpm add @gasport/sdk

# Using npm
npm install @gasport/sdk

# Using yarn
yarn add @gasport/sdk
```

## 🚀 Quick Start

```typescript
import { GasPortClient, ChainId, CHAIN_CONFIGS } from '@gasport/sdk';

// Initialize client
const gasport = new GasPortClient({
  chains: [CHAIN_CONFIGS['arbitrum-one'], CHAIN_CONFIGS['xai']],
  supportedTokens: ['USDC', 'ARB', 'ETH'],
});

// Sponsor a transaction
const receipt = await gasport.sponsorTransaction(
  {
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    value: parseEther('0.1'),
    chainId: ChainId.ARBITRUM_ONE,
  },
  {
    paymentToken: 'USDC',
    paymentChain: ChainId.XAI, // Pay using USDC on XAI
  }
);

console.log('Transaction hash:', receipt.hash);
```

## 📖 Documentation

- [Getting Started](./docs/getting-started.md)
- [API Reference](./docs/api-reference.md)
- [Architecture](./docs/architecture.md)
- [Deployment Guide](./docs/deployment-guide.md)
- [Troubleshooting](./docs/troubleshooting.md)

## 🏗️ Project Structure

```
gasport-sdk/
├── packages/
│   ├── core/              # Core SDK (@gasport/sdk)
│   ├── types/             # Shared types
│   ├── cli/               # CLI tool
│   ├── contracts/         # Smart contracts (Solidity)
│   ├── state/             # State management
│   ├── testing-utils/     # Testing utilities
│   └── examples/          # Usage examples
├── docs/                  # Documentation
└── scripts/               # Build & deployment scripts
```

## 💡 Examples

### Cross-Chain Transfer

```typescript
import { GasPortClient, ChainId } from '@gasport/sdk';

const gasport = new GasPortClient({ /* ... */ });

// Get a quote first
const quote = await gasport.getQuote({
  to: '0x123...',
  value: parseEther('0.01'),
  chainId: ChainId.ARBITRUM_ONE,
}, {
  paymentToken: 'USDC',
  paymentChain: ChainId.XAI,
});

console.log('Estimated cost:', quote.estimatedCost);
console.log('Route:', quote.route);

// Execute the quote
const receipt = await gasport.executeQuote(quote);
```

### Batch Transactions

```typescript
const txs = [
  { to: '0xaaa...', value: parseEther('0.1'), chainId: ChainId.ARBITRUM_ONE },
  { to: '0xbbb...', value: parseEther('0.2'), chainId: ChainId.ARBITRUM_ONE },
];

const batch = await gasport.batchTransactions(txs, {
  paymentToken: 'USDC',
});

console.log('Savings:', batch.savings, '%');
```

### NFT Collateral

```typescript
// Stake NFT for gas credit
const collateral = await gasport.stakeNFTCollateral({
  nftContract: '0xNFT_ADDRESS',
  tokenId: 123,
  chain: ChainId.ARBITRUM_ONE,
  creditLimit: parseEther('1'),
});

// Use collateral for transactions
const receipt = await gasport.sponsorTransaction(tx, {
  useCollateral: true,
  collateralId: collateral.id,
});
```

## 🧪 Development

### Prerequisites

- Node.js 18+
- pnpm 8+
- Foundry (for smart contracts)

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/gasport-sdk.git
cd gasport-sdk

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting
pnpm lint
```

### Smart Contracts

```bash
cd packages/contracts

# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Build contracts
forge build

# Run tests
forge test

# Deploy to testnet
forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
```

## 🎯 Roadmap

### Phase 1: Foundation ✅
- [x] Monorepo setup
- [x] Core types & interfaces
- [x] GasPortClient implementation
- [x] Smart contracts (Paymaster, Treasury)

### Phase 2: Cross-Chain & Routing (In Progress)
- [ ] Bridge adapters (Arbitrum native, Hyperlane, LayerZero)
- [ ] Routing algorithm
- [ ] Gas price oracle
- [ ] State management

### Phase 3: Token & Liquidity
- [ ] Token management
- [ ] DEX integration
- [ ] Liquidity pools
- [ ] Price oracles

### Phase 4: Advanced Features
- [ ] NFT collateral system
- [ ] Batch transactions
- [ ] MEV protection
- [ ] CLI tool

### Phase 5: Launch
- [ ] Security audit
- [ ] Comprehensive testing
- [ ] Documentation
- [ ] Mainnet deployment

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

## 🔗 Links

- [Documentation](./docs)
- [Examples](./packages/examples)
- [Discord](https://discord.gg/gasport) (Coming soon)
- [Twitter](https://twitter.com/gasport) (Coming soon)

## 💬 Support

- GitHub Issues: [Report a bug](https://github.com/yourusername/gasport-sdk/issues)
- Discord: Join our community (Coming soon)
- Email: support@gasport.io

---

Built with ❤️ for the Arbitrum ecosystem
