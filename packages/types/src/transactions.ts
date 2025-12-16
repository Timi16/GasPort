import type { ChainId } from './chains';
import type { Hex } from 'viem';

/**
 * Transaction request
 */
export interface Transaction {
  /** Target address */
  to: `0x${string}`;
  /** Value in wei */
  value?: bigint;
  /** Call data */
  data?: Hex;
  /** Gas limit */
  gasLimit?: bigint;
  /** Chain ID where transaction will execute */
  chainId: ChainId;
  /** Nonce */
  nonce?: bigint;
  /** Max fee per gas (EIP-1559) */
  maxFeePerGas?: bigint;
  /** Max priority fee per gas (EIP-1559) */
  maxPriorityFeePerGas?: bigint;
}

/**
 * Sponsor options for gas sponsorship
 */
export interface SponsorOptions {
  /** Token to use for payment */
  paymentToken: string;
  /** Chain where payment token is held */
  paymentChain?: ChainId | string;
  /** Maximum gas cost willing to pay */
  maxGasCost?: bigint;
  /** Use NFT collateral */
  useCollateral?: boolean;
  /** Collateral ID if using NFT collateral */
  collateralId?: string;
  /** Deadline timestamp */
  deadline?: number;
  /** Signature for authorization */
  signature?: Hex;
}

/**
 * Transaction receipt
 */
export interface TxReceipt {
  /** Transaction hash */
  hash: Hex;
  /** Block number */
  blockNumber?: bigint;
  /** Block hash */
  blockHash?: Hex;
  /** Gas used */
  gasUsed?: bigint;
  /** Effective gas price */
  effectiveGasPrice?: bigint;
  /** Status (1 = success, 0 = failed) */
  status?: 'success' | 'reverted';
  /** Gas cost breakdown */
  gasCost?: GasCostBreakdown;
  /** Route taken for cross-chain */
  route?: RoutingPath;
}

/**
 * Gas estimate
 */
export interface GasEstimate {
  /** Execution gas on target chain */
  executionGas: bigint;
  /** L1 data fee (for Arbitrum chains) */
  l1DataFee?: bigint;
  /** Bridge fee */
  bridgeFee?: bigint;
  /** Swap slippage */
  swapSlippage?: bigint;
  /** Total estimated cost */
  total: bigint;
  /** Total cost in USD */
  totalUSD?: number;
  /** Buffer percentage applied */
  bufferPercent: number;
}

/**
 * Gas cost breakdown
 */
export interface GasCostBreakdown {
  executionGas: bigint;
  l1DataFee: bigint;
  bridgeFee: bigint;
  swapFee: bigint;
  protocolFee: bigint;
  total: bigint;
}

/**
 * Routing path for cross-chain transactions
 */
export interface RoutingPath {
  /** Source chain */
  from: ChainId;
  /** Target chain */
  to: ChainId;
  /** Hops in the path */
  hops: RoutingHop[];
  /** Estimated total cost */
  estimatedCost: bigint;
  /** Estimated time in seconds */
  estimatedTime: number;
  /** Reliability score (0-1) */
  reliability: number;
  /** Fallback paths */
  fallbacks?: RoutingPath[];
}

/**
 * Single hop in routing path
 */
export interface RoutingHop {
  /** From chain */
  from: ChainId;
  /** To chain */
  to: ChainId;
  /** Bridge protocol used */
  bridge: 'native' | 'hyperlane' | 'layerzero';
  /** Estimated cost for this hop */
  cost: bigint;
  /** Estimated time for this hop */
  time: number;
}

/**
 * Quote for transaction
 */
export interface Quote {
  /** Routing path */
  route: RoutingPath;
  /** Estimated cost */
  estimatedCost: bigint;
  /** Estimated time */
  estimatedTime: number;
  /** Cost breakdown */
  breakdown: GasCostBreakdown;
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Quote ID */
  quoteId: string;
}

/**
 * User operation (EIP-4337)
 */
export interface UserOperation {
  sender: `0x${string}`;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * Pending transaction state
 */
export interface PendingTransaction {
  /** Transaction ID */
  id: string;
  /** Current status */
  status: 'routing' | 'bridging' | 'executing' | 'completed' | 'failed';
  /** Routing path */
  route: RoutingPath;
  /** Transaction steps */
  steps: TransactionStep[];
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
  /** Retry count */
  retryCount: number;
  /** Error if failed */
  error?: string;
}

/**
 * Transaction step
 */
export interface TransactionStep {
  /** Step type */
  type: 'swap' | 'bridge' | 'execute';
  /** Status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Transaction hash if available */
  txHash?: Hex;
  /** Chain ID */
  chainId: ChainId;
  /** Timestamp */
  timestamp: number;
}
