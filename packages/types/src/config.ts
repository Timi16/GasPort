import type { ChainConfig } from './chains';
import type { TokenConfig } from './tokens';
import type { ChainId } from './chains';

/**
 * GasPort SDK configuration
 */
export interface GasPortConfig {
  /** API key (optional for self-hosted) */
  apiKey?: string;

  /** Custom API endpoint */
  apiUrl?: string;

  /** Supported chains configuration */
  chains: ChainConfig[];

  /** Default chain for operations */
  defaultChain?: ChainId;

  /** Custom RPC URLs per chain */
  rpcUrls?: Partial<Record<ChainId, string>>;

  /** RPC timeout in milliseconds */
  rpcTimeout?: number;

  /** Supported tokens configuration */
  supportedTokens?: TokenConfig[];

  /** Auto-approve tokens */
  autoApprove?: boolean;

  /** Paymaster addresses per chain */
  paymasterAddress?: Partial<Record<ChainId, `0x${string}`>>;

  /** EntryPoint addresses per chain (EIP-4337) */
  entryPointAddress?: Partial<Record<ChainId, `0x${string}`>>;

  /** Routing configuration */
  routing?: RoutingConfig;

  /** Gas configuration */
  gas?: GasConfig;

  /** Monitoring configuration */
  monitoring?: MonitoringConfig;

  /** Security configuration */
  security?: SecurityConfig;
}

/**
 * Routing configuration
 */
export interface RoutingConfig {
  /** Maximum routing hops (default: 3) */
  maxHops?: number;

  /** Preferred bridge protocol */
  preferredBridge?: 'native' | 'hyperlane' | 'layerzero';

  /** Slippage tolerance percentage (default: 1%) */
  slippageTolerance?: number;

  /** Route timeout in seconds */
  timeout?: number;

  /** Enable route caching */
  enableCache?: boolean;

  /** Cache TTL in seconds */
  cacheTTL?: number;
}

/**
 * Gas configuration
 */
export interface GasConfig {
  /** Maximum gas price willing to pay */
  maxGasPrice?: bigint;

  /** Priority fee */
  priorityFee?: bigint;

  /** Gas limit per transaction */
  gasLimit?: bigint;

  /** Gas price buffer percentage */
  bufferPercent?: number;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  /** Webhook URL for events */
  webhookUrl?: string;

  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /** Enable transaction monitoring */
  enableMonitoring?: boolean;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** Require user signatures */
  requireSignature?: boolean;

  /** Allowed origins (CORS) */
  allowedOrigins?: string[];

  /** Rate limiting configuration */
  rateLimits?: RateLimitConfig;

  /** Enable replay protection */
  replayProtection?: boolean;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;

  /** Time window in seconds */
  windowSeconds: number;

  /** Max concurrent requests */
  maxConcurrent?: number;
}

/**
 * Quote options
 */
export interface QuoteOptions {
  /** Payment token */
  paymentToken?: string;

  /** Payment chain */
  paymentChain?: ChainId | string;

  /** Routing preference */
  routingPreference?: 'cost' | 'speed' | 'reliability';

  /** Include fallback routes */
  includeFallbacks?: boolean;
}
