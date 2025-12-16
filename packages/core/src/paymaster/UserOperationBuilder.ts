import {
  type UserOperation,
  type Transaction,
  type ChainId,
  ConfigurationError,
} from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { encodeFunctionData, type Hex } from 'viem';

/**
 * User operation build options
 */
export interface UserOpBuildOptions {
  /** Sender address (smart wallet) */
  sender: `0x${string}`;
  /** Nonce */
  nonce?: bigint;
  /** Max fee per gas */
  maxFeePerGas?: bigint;
  /** Max priority fee per gas */
  maxPriorityFeePerGas?: bigint;
  /** Paymaster address */
  paymasterAddress?: `0x${string}`;
  /** Paymaster data */
  paymasterData?: Hex;
  /** Gas limits */
  gasLimits?: {
    callGasLimit?: bigint;
    verificationGasLimit?: bigint;
    preVerificationGas?: bigint;
  };
}

/**
 * Builds EIP-4337 user operations
 */
export class UserOperationBuilder {
  private chainManager: ChainManager;
  private logger: Logger;

  constructor(chainManager: ChainManager, logger: Logger) {
    this.chainManager = chainManager;
    this.logger = logger;
  }

  /**
   * Build user operation from transaction
   */
  async buildUserOperation(
    tx: Transaction,
    options: UserOpBuildOptions
  ): Promise<UserOperation> {
    this.logger.debug('Building user operation', { tx, options });

    const chain = this.chainManager.getChain(tx.chainId);

    if (!chain.entryPointAddress) {
      throw new ConfigurationError(`EntryPoint address not configured for chain ${tx.chainId}`);
    }

    // Get nonce if not provided
    const nonce = options.nonce ?? (await this.getNonce(tx.chainId, options.sender));

    // Estimate gas prices if not provided
    const client = this.chainManager.getClient(tx.chainId);
    const gasPrice = await client.getGasPrice();

    // Build init code (empty if wallet already deployed)
    const initCode = '0x' as Hex;

    // Build call data
    const callData = this.buildCallData(tx);

    // Estimate gas limits
    const gasLimits = await this.estimateGasLimits(tx, options);

    // Build paymaster and data
    const paymasterAndData = this.buildPaymasterAndData(
      chain.paymasterAddress || options.paymasterAddress,
      options.paymasterData
    );

    const userOp: UserOperation = {
      sender: options.sender,
      nonce,
      initCode,
      callData,
      callGasLimit: gasLimits.callGasLimit,
      verificationGasLimit: gasLimits.verificationGasLimit,
      preVerificationGas: gasLimits.preVerificationGas,
      maxFeePerGas: options.maxFeePerGas ?? gasPrice,
      maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? gasPrice / 10n, // 10% priority
      paymasterAndData,
      signature: '0x' as Hex, // Will be filled by wallet
    };

    this.logger.debug('User operation built', {
      sender: userOp.sender,
      nonce: userOp.nonce.toString(),
      callGasLimit: userOp.callGasLimit.toString(),
    });

    return userOp;
  }

  /**
   * Get nonce for sender from EntryPoint
   */
  private async getNonce(chainId: ChainId, sender: `0x${string}`): Promise<bigint> {
    try {
      const chain = this.chainManager.getChain(chainId);
      const client = this.chainManager.getClient(chainId);

      if (!chain.entryPointAddress) {
        throw new Error('EntryPoint address not configured');
      }

      // Read nonce from EntryPoint contract
      const nonce = await client.readContract({
        address: chain.entryPointAddress,
        abi: ENTRY_POINT_ABI,
        functionName: 'getNonce',
        args: [sender, 0n], // key = 0
      });

      return nonce as bigint;
    } catch (error) {
      this.logger.error('Failed to get nonce', { chainId, sender, error });
      // Return 0 as fallback
      return 0n;
    }
  }

  /**
   * Build call data for transaction
   */
  private buildCallData(tx: Transaction): Hex {
    if (tx.data) {
      // If data is provided, create execute call
      return encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: 'execute',
        args: [tx.to, tx.value || 0n, tx.data],
      });
    } else {
      // Simple transfer
      return encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: 'execute',
        args: [tx.to, tx.value || 0n, '0x' as Hex],
      });
    }
  }

  /**
   * Estimate gas limits for user operation
   */
  private async estimateGasLimits(
    tx: Transaction,
    options: UserOpBuildOptions
  ): Promise<{
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
  }> {
    // Use provided limits if available
    if (options.gasLimits) {
      return {
        callGasLimit: options.gasLimits.callGasLimit || 100000n,
        verificationGasLimit: options.gasLimits.verificationGasLimit || 100000n,
        preVerificationGas: options.gasLimits.preVerificationGas || 21000n,
      };
    }

    // Estimate call gas
    const client = this.chainManager.getClient(tx.chainId);
    let callGasLimit = 100000n;

    try {
      const estimated = await client.estimateGas({
        to: tx.to,
        value: tx.value,
        data: tx.data,
      });
      callGasLimit = (estimated * 130n) / 100n; // Add 30% buffer
    } catch (error) {
      this.logger.warn('Failed to estimate call gas, using default', { error });
    }

    // Standard verification and pre-verification gas
    const verificationGasLimit = 100000n;
    const preVerificationGas = 21000n;

    return {
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
    };
  }

  /**
   * Build paymaster and data field
   */
  private buildPaymasterAndData(
    paymasterAddress?: `0x${string}`,
    paymasterData?: Hex
  ): Hex {
    if (!paymasterAddress) {
      return '0x' as Hex;
    }

    // Format: <paymaster_address><paymaster_data>
    const address = paymasterAddress.slice(2); // Remove 0x
    const data = paymasterData ? paymasterData.slice(2) : '';

    return `0x${address}${data}` as Hex;
  }

  /**
   * Calculate user operation hash
   */
  calculateUserOpHash(userOp: UserOperation, chainId: ChainId): Hex {
    const chain = this.chainManager.getChain(chainId);

    if (!chain.entryPointAddress) {
      throw new ConfigurationError(`EntryPoint address not configured for chain ${chainId}`);
    }

    // TODO: Implement proper hash calculation per EIP-4337
    // This is a simplified version
    const packed = encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: 'sender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'callData', type: 'bytes' },
          ],
          name: 'hashUserOp',
          outputs: [{ name: '', type: 'bytes32' }],
          stateMutability: 'pure',
          type: 'function',
        },
      ],
      functionName: 'hashUserOp',
      args: [userOp.sender, userOp.nonce, userOp.callData],
    });

    return packed as Hex;
  }
}

/**
 * EntryPoint ABI (minimal)
 */
const ENTRY_POINT_ABI = [
  {
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    name: 'getNonce',
    outputs: [{ name: 'nonce', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Account ABI (minimal)
 */
const ACCOUNT_ABI = [
  {
    inputs: [
      { name: 'dest', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'func', type: 'bytes' },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
