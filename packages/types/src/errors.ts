import type { ChainId } from './chains';

/**
 * Base GasPort error
 */
export class GasPortError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GasPortError';
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends GasPortError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', false, details);
    this.name = 'ConfigurationError';
  }
}

/**
 * Insufficient balance error
 */
export class InsufficientBalanceError extends GasPortError {
  constructor(required: bigint, available: bigint, token: string) {
    super(
      `Insufficient balance: need ${required} ${token}, have ${available} ${token}`,
      'INSUFFICIENT_BALANCE',
      false,
      { required, available, token }
    );
    this.name = 'InsufficientBalanceError';
  }
}

/**
 * Routing error
 */
export class RoutingError extends GasPortError {
  constructor(from: ChainId, to: ChainId, reason?: string) {
    super(
      `No route found from chain ${from} to chain ${to}${reason ? `: ${reason}` : ''}`,
      'NO_ROUTE_FOUND',
      true,
      { from, to, reason }
    );
    this.name = 'RoutingError';
  }
}

/**
 * Bridge timeout error
 */
export class BridgeTimeoutError extends GasPortError {
  constructor(bridgeTxHash: string, timeoutSeconds: number) {
    super(
      `Bridge transaction ${bridgeTxHash} timed out after ${timeoutSeconds}s`,
      'BRIDGE_TIMEOUT',
      true,
      { bridgeTxHash, timeoutSeconds }
    );
    this.name = 'BridgeTimeoutError';
  }
}

/**
 * Transaction failed error
 */
export class TransactionFailedError extends GasPortError {
  constructor(txHash: string, reason?: string) {
    super(
      `Transaction ${txHash} failed${reason ? `: ${reason}` : ''}`,
      'TRANSACTION_FAILED',
      false,
      { txHash, reason }
    );
    this.name = 'TransactionFailedError';
  }
}

/**
 * Token not supported error
 */
export class TokenNotSupportedError extends GasPortError {
  constructor(token: string, chainId?: ChainId) {
    super(
      `Token ${token} is not supported${chainId ? ` on chain ${chainId}` : ''}`,
      'TOKEN_NOT_SUPPORTED',
      false,
      { token, chainId }
    );
    this.name = 'TokenNotSupportedError';
  }
}

/**
 * Chain not supported error
 */
export class ChainNotSupportedError extends GasPortError {
  constructor(chainId: ChainId) {
    super(`Chain ${chainId} is not supported`, 'CHAIN_NOT_SUPPORTED', false, { chainId });
    this.name = 'ChainNotSupportedError';
  }
}

/**
 * Insufficient liquidity error
 */
export class InsufficientLiquidityError extends GasPortError {
  constructor(token: string, chainId: ChainId, required: bigint, available: bigint) {
    super(
      `Insufficient liquidity for ${token} on chain ${chainId}: need ${required}, available ${available}`,
      'INSUFFICIENT_LIQUIDITY',
      true,
      { token, chainId, required, available }
    );
    this.name = 'InsufficientLiquidityError';
  }
}

/**
 * Gas price too high error
 */
export class GasPriceTooHighError extends GasPortError {
  constructor(currentPrice: bigint, maxPrice: bigint) {
    super(
      `Gas price ${currentPrice} exceeds maximum ${maxPrice}`,
      'GAS_PRICE_TOO_HIGH',
      true,
      { currentPrice, maxPrice }
    );
    this.name = 'GasPriceTooHighError';
  }
}

/**
 * Quote expired error
 */
export class QuoteExpiredError extends GasPortError {
  constructor(quoteId: string, expiresAt: number) {
    super(`Quote ${quoteId} expired at ${new Date(expiresAt).toISOString()}`, 'QUOTE_EXPIRED', false, {
      quoteId,
      expiresAt,
    });
    this.name = 'QuoteExpiredError';
  }
}

/**
 * RPC error
 */
export class RPCError extends GasPortError {
  constructor(message: string, chainId: ChainId) {
    super(`RPC error on chain ${chainId}: ${message}`, 'RPC_ERROR', true, { chainId });
    this.name = 'RPCError';
  }
}

/**
 * Signature validation error
 */
export class SignatureValidationError extends GasPortError {
  constructor(message: string) {
    super(`Signature validation failed: ${message}`, 'INVALID_SIGNATURE', false);
    this.name = 'SignatureValidationError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends GasPortError {
  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`, 'RATE_LIMIT_EXCEEDED', true, { retryAfter });
    this.name = 'RateLimitError';
  }
}

/**
 * Paymaster error
 */
export class PaymasterError extends GasPortError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(`Paymaster error: ${message}`, 'PAYMASTER_ERROR', false, details);
    this.name = 'PaymasterError';
  }
}
