/**
 * Supported chain IDs
 */
export enum ChainId {
  ARBITRUM_ONE = 42161,
  ARBITRUM_NOVA = 42170,
  ARBITRUM_GOERLI = 421613,
  ARBITRUM_SEPOLIA = 421614,
  XAI = 660279,
  XAI_TESTNET = 37714555429,
}

/**
 * Chain configuration
 */
export interface ChainConfig {
  /** Chain ID */
  chainId: ChainId;
  /** Chain name */
  name: string;
  /** Chain slug (for identifiers) */
  slug: string;
  /** RPC URL */
  rpcUrl: string;
  /** Block explorer URL */
  blockExplorer?: string;
  /** Native currency */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Whether this is a testnet */
  testnet: boolean;
  /** EntryPoint contract address (EIP-4337) */
  entryPointAddress?: `0x${string}`;
  /** Paymaster contract address */
  paymasterAddress?: `0x${string}`;
  /** Treasury contract address */
  treasuryAddress?: `0x${string}`;
  /** Router contract address */
  routerAddress?: `0x${string}`;
}

/**
 * Chain information
 */
export interface ChainInfo {
  config: ChainConfig;
  /** Current gas price (wei) */
  gasPrice?: bigint;
  /** Base fee (EIP-1559) */
  baseFee?: bigint;
  /** Priority fee (EIP-1559) */
  priorityFee?: bigint;
  /** Current block number */
  blockNumber?: bigint;
  /** Whether the chain is currently available */
  available: boolean;
}

/**
 * Default chain configurations
 */
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  'arbitrum-one': {
    chainId: ChainId.ARBITRUM_ONE,
    name: 'Arbitrum One',
    slug: 'arbitrum-one',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    blockExplorer: 'https://arbiscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    testnet: false,
  },
  'arbitrum-nova': {
    chainId: ChainId.ARBITRUM_NOVA,
    name: 'Arbitrum Nova',
    slug: 'arbitrum-nova',
    rpcUrl: 'https://nova.arbitrum.io/rpc',
    blockExplorer: 'https://nova.arbiscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    testnet: false,
  },
  xai: {
    chainId: ChainId.XAI,
    name: 'Xai',
    slug: 'xai',
    rpcUrl: 'https://xai-chain.net/rpc',
    nativeCurrency: {
      name: 'Xai',
      symbol: 'XAI',
      decimals: 18,
    },
    testnet: false,
  },
};
