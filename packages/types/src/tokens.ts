import type { ChainId } from './chains';

/**
 * Token configuration
 */
export interface TokenConfig {
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Token decimals */
  decimals: number;
  /** Token addresses per chain */
  addresses: Partial<Record<ChainId, `0x${string}`>>;
  /** Token logo URL */
  logoUrl?: string;
  /** Whether this is a stablecoin */
  isStablecoin?: boolean;
  /** Chainlink price feed addresses */
  priceFeeds?: Partial<Record<ChainId, `0x${string}`>>;
}

/**
 * Token information
 */
export interface TokenInfo {
  config: TokenConfig;
  /** Current price in USD */
  priceUSD?: number;
  /** User's balance */
  balance?: bigint;
  /** User's balance formatted */
  balanceFormatted?: string;
}

/**
 * Token balance
 */
export interface TokenBalance {
  token: string;
  address: `0x${string}`;
  chainId: ChainId;
  balance: bigint;
  balanceFormatted: string;
  priceUSD?: number;
  valueUSD?: number;
}

/**
 * Default supported tokens
 */
export const SUPPORTED_TOKENS: Record<string, TokenConfig> = {
  ETH: {
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    addresses: {
      [42161]: '0x0000000000000000000000000000000000000000',
      [42170]: '0x0000000000000000000000000000000000000000',
    },
    isStablecoin: false,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    addresses: {
      [42161]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      [42170]: '0x750ba8b76187092B0D1E87E28daaf484d1b5273b',
    },
    isStablecoin: true,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    addresses: {
      [42161]: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
    isStablecoin: true,
  },
  ARB: {
    symbol: 'ARB',
    name: 'Arbitrum',
    decimals: 18,
    addresses: {
      [42161]: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    },
    isStablecoin: false,
  },
  DAI: {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    addresses: {
      [42161]: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
    isStablecoin: true,
  },
};
