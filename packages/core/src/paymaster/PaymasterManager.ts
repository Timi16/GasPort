import {
  type UserOperation,
  type Transaction,
  type TxReceipt,
  type ChainId,
  PaymasterError,
  ConfigurationError,
} from '@gasport/types';
import type { ChainManager } from '../client/ChainManager';
import type { Logger } from 'pino';
import { UserOperationBuilder, type UserOpBuildOptions } from './UserOperationBuilder';
import type { Hex } from 'viem';

/**
 * User operation receipt
 */
export interface UserOpReceipt {
  userOpHash: Hex;
  transactionHash: Hex;
  blockNumber: bigint;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
}

/**
 * Manages EIP-4337 paymaster operations
 */
export class PaymasterManager {
  private chainManager: ChainManager;
  private logger: Logger;
  private userOpBuilder: UserOperationBuilder;
  private pendingOps: Map<string, UserOperation>;

  constructor(chainManager: ChainManager, logger: Logger) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.userOpBuilder = new UserOperationBuilder(chainManager, logger);
    this.pendingOps = new Map();
  }

  /**
   * Build and submit a sponsored user operation
   */
  async sponsorUserOperation(
    tx: Transaction,
    options: {
      sender: `0x${string}`;
      paymentToken: `0x${string}`;
      signature?: Hex;
    }
  ): Promise<UserOpReceipt> {
    this.logger.info('Sponsoring user operation', { tx, options });

    try {
      // Build user operation
      const userOp = await this.buildUserOp(tx, options);

      // Sign user operation (if signature provided)
      if (options.signature) {
        userOp.signature = options.signature;
      }

      // Submit to bundler
      const receipt = await this.submitUserOperation(userOp, tx.chainId);

      this.logger.info('User operation sponsored successfully', {
        userOpHash: receipt.userOpHash,
        txHash: receipt.transactionHash,
      });

      return receipt;
    } catch (error) {
      this.logger.error('Failed to sponsor user operation', { error });
      throw new PaymasterError((error as Error).message);
    }
  }

  /**
   * Build user operation with paymaster data
   */
  private async buildUserOp(
    tx: Transaction,
    options: {
      sender: `0x${string}`;
      paymentToken: `0x${string}`;
    }
  ): Promise<UserOperation> {
    const chain = this.chainManager.getChain(tx.chainId);

    if (!chain.paymasterAddress) {
      throw new ConfigurationError(`Paymaster address not configured for chain ${tx.chainId}`);
    }

    // Get paymaster data
    const paymasterData = await this.getPaymasterData(tx, options.paymentToken);

    // Build user operation
    const buildOptions: UserOpBuildOptions = {
      sender: options.sender,
      paymasterAddress: chain.paymasterAddress,
      paymasterData,
    };

    const userOp = await this.userOpBuilder.buildUserOperation(tx, buildOptions);

    return userOp;
  }

  /**
   * Get paymaster data for token payment
   */
  private async getPaymasterData(
    tx: Transaction,
    paymentToken: `0x${string}`
  ): Promise<Hex> {
    // Encode payment token in paymaster data
    // Format: <token_address>
    const tokenAddress = paymentToken.slice(2); // Remove 0x

    return `0x${tokenAddress}` as Hex;
  }

  /**
   * Submit user operation to bundler
   */
  private async submitUserOperation(
    userOp: UserOperation,
    chainId: ChainId
  ): Promise<UserOpReceipt> {
    const chain = this.chainManager.getChain(chainId);
    const client = this.chainManager.getClient(chainId);

    if (!chain.entryPointAddress) {
      throw new ConfigurationError(`EntryPoint address not configured for chain ${chainId}`);
    }

    try {
      // Calculate user op hash
      const userOpHash = this.userOpBuilder.calculateUserOpHash(userOp, chainId);

      // Store pending op
      this.pendingOps.set(userOpHash, userOp);

      this.logger.debug('Submitting user operation', {
        userOpHash,
        sender: userOp.sender,
        nonce: userOp.nonce.toString(),
      });

      // In a real implementation, this would:
      // 1. Submit to bundler service
      // 2. Wait for bundler to include in a bundle
      // 3. Wait for bundle transaction to be mined
      // 4. Return receipt

      // For now, simulate submission
      // TODO: Implement actual bundler integration

      // Simulate transaction hash
      const transactionHash = userOpHash; // In reality, this would be the bundle tx hash

      // Simulate receipt
      const receipt: UserOpReceipt = {
        userOpHash,
        transactionHash,
        blockNumber: 0n, // Would be actual block number
        success: true,
        actualGasCost: userOp.callGasLimit * userOp.maxFeePerGas,
        actualGasUsed: userOp.callGasLimit,
      };

      // Remove from pending
      this.pendingOps.delete(userOpHash);

      return receipt;
    } catch (error) {
      this.logger.error('Failed to submit user operation', { chainId, error });
      throw new PaymasterError(`Submission failed: ${(error as Error).message}`);
    }
  }

  /**
   * Wait for user operation receipt
   */
  async waitForUserOpReceipt(
    userOpHash: Hex,
    chainId: ChainId,
    timeout = 60000
  ): Promise<UserOpReceipt> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // In reality, this would query the bundler or EntryPoint contract
        // for the user operation status

        // Check if still pending
        if (this.pendingOps.has(userOpHash)) {
          // Wait a bit and retry
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        // TODO: Implement actual receipt fetching
        throw new Error('Receipt not found');
      } catch (error) {
        this.logger.debug('User operation not yet mined', { userOpHash });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    throw new PaymasterError(`Timeout waiting for user operation ${userOpHash}`);
  }

  /**
   * Estimate gas cost for sponsored operation
   */
  async estimateGasCost(tx: Transaction, paymentToken: `0x${string}`): Promise<bigint> {
    try {
      const client = this.chainManager.getClient(tx.chainId);

      // Estimate gas for the transaction
      const gasEstimate = await client.estimateGas({
        to: tx.to,
        value: tx.value,
        data: tx.data,
      });

      // Add verification and pre-verification gas
      const verificationGas = 100000n;
      const preVerificationGas = 21000n;

      const totalGas = gasEstimate + verificationGas + preVerificationGas;

      // Get gas price
      const gasPrice = await client.getGasPrice();

      // Calculate total cost
      const totalCost = totalGas * gasPrice;

      // Add 20% buffer
      const withBuffer = (totalCost * 120n) / 100n;

      this.logger.debug('Gas cost estimated', {
        gasEstimate: gasEstimate.toString(),
        totalGas: totalGas.toString(),
        gasPrice: gasPrice.toString(),
        totalCost: withBuffer.toString(),
      });

      return withBuffer;
    } catch (error) {
      this.logger.error('Failed to estimate gas cost', { error });
      throw new PaymasterError(`Gas estimation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Check if paymaster can sponsor an operation
   */
  async canSponsor(
    tx: Transaction,
    paymentToken: `0x${string}`,
    amount: bigint
  ): Promise<boolean> {
    try {
      const chain = this.chainManager.getChain(tx.chainId);

      if (!chain.paymasterAddress) {
        return false;
      }

      // TODO: Check paymaster balance and limits
      // For now, return true
      return true;
    } catch (error) {
      this.logger.error('Failed to check sponsorship eligibility', { error });
      return false;
    }
  }

  /**
   * Get pending user operations
   */
  getPendingOperations(): Map<string, UserOperation> {
    return new Map(this.pendingOps);
  }

  /**
   * Clear pending operations
   */
  clearPendingOperations(): void {
    this.pendingOps.clear();
    this.logger.debug('Cleared pending user operations');
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    this.pendingOps.clear();
    this.logger.debug('PaymasterManager destroyed');
  }
}
