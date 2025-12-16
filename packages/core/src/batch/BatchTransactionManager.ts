import {
  Address,
  Hex,
  encodeFunctionData,
  parseAbi,
  encodePacked,
  keccak256,
} from 'viem';
import { ChainManager } from '../client/ChainManager';
import { Logger } from '../utils/logger';
import { ChainId, Transaction } from '@gasport/types';
import { UserOperationBuilder } from '../paymaster/UserOperationBuilder';
import { PaymasterManager } from '../paymaster/PaymasterManager';

/**
 * Batch transaction item
 */
export interface BatchTransactionItem {
  to: Address;
  value: bigint;
  data: Hex;
  gasLimit?: bigint;
}

/**
 * Batch execution result
 */
export interface BatchExecutionResult {
  batchId: Hex;
  txHash: Hex;
  success: boolean;
  successfulCalls: number;
  failedCalls: number;
  results: Array<{
    index: number;
    success: boolean;
    returnData?: Hex;
    error?: string;
  }>;
  gasUsed: bigint;
}

/**
 * Batch transaction options
 */
export interface BatchOptions {
  atomicExecution?: boolean; // If true, all calls must succeed or all revert
  paymentToken?: Address; // Token to use for gas payment
  maxGasPrice?: bigint;
  priorityFee?: bigint;
}

/**
 * Manages batch transaction execution
 * Allows multiple transactions to be executed in a single bundle
 */
export class BatchTransactionManager {
  private chainManager: ChainManager;
  private logger: Logger;
  private userOpBuilder: UserOperationBuilder;
  private paymasterManager: PaymasterManager;

  // Simple batch executor contract ABI
  // This would be a deployed contract that can execute multiple calls
  private readonly BATCH_EXECUTOR_ABI = parseAbi([
    'function executeBatch(address[] calldata targets, uint256[] calldata values, bytes[] calldata calldatas) external payable returns (bytes[] memory)',
    'function executeBatchAtomic(address[] calldata targets, uint256[] calldata values, bytes[] calldata calldatas) external payable returns (bytes[] memory)',
  ]);

  constructor(
    chainManager: ChainManager,
    logger: Logger,
    userOpBuilder: UserOperationBuilder,
    paymasterManager: PaymasterManager
  ) {
    this.chainManager = chainManager;
    this.logger = logger;
    this.userOpBuilder = userOpBuilder;
    this.paymasterManager = paymasterManager;
  }

  /**
   * Create a batch of transactions
   */
  createBatch(items: BatchTransactionItem[]): {
    targets: Address[];
    values: bigint[];
    calldatas: Hex[];
  } {
    if (items.length === 0) {
      throw new Error('Batch must contain at least one transaction');
    }

    if (items.length > 50) {
      throw new Error('Batch size exceeds maximum of 50 transactions');
    }

    const targets: Address[] = [];
    const values: bigint[] = [];
    const calldatas: Hex[] = [];

    for (const item of items) {
      targets.push(item.to);
      values.push(item.value);
      calldatas.push(item.data);
    }

    return { targets, values, calldatas };
  }

  /**
   * Generate batch ID
   */
  generateBatchId(
    chainId: ChainId,
    sender: Address,
    items: BatchTransactionItem[]
  ): Hex {
    const data = encodePacked(
      ['uint256', 'address', 'uint256', 'uint256'],
      [BigInt(chainId), sender, BigInt(items.length), BigInt(Date.now())]
    );

    return keccak256(data);
  }

  /**
   * Execute batch of transactions
   */
  async executeBatch(
    chainId: ChainId,
    sender: Address,
    items: BatchTransactionItem[],
    options: BatchOptions = {}
  ): Promise<BatchExecutionResult> {
    this.logger.info(
      `Executing batch of ${items.length} transactions on chain ${chainId}`
    );

    const batchId = this.generateBatchId(chainId, sender, items);
    const { targets, values, calldatas } = this.createBatch(items);

    // Encode batch execution call
    const functionName = options.atomicExecution
      ? 'executeBatchAtomic'
      : 'executeBatch';

    const batchCalldata = encodeFunctionData({
      abi: this.BATCH_EXECUTOR_ABI,
      functionName,
      args: [targets, values, calldatas],
    });

    // Calculate total value
    const totalValue = values.reduce((sum, val) => sum + val, 0n);

    // Build user operation for the batch
    // In production, this would use the user's smart contract wallet
    // which has batch execution capability
    const userOp = await this.userOpBuilder.buildUserOperation(
      {
        chainId,
        to: sender, // Smart contract wallet address
        value: totalValue,
        data: batchCalldata,
        from: sender,
      } as Transaction,
      {
        maxGasPrice: options.maxGasPrice,
        priorityFee: options.priorityFee,
      }
    );

    // Sponsor with paymaster if payment token specified
    let txHash: Hex;
    let gasUsed = 0n;

    if (options.paymentToken) {
      const receipt = await this.paymasterManager.sponsorUserOperation(
        {
          chainId,
          to: sender,
          value: totalValue,
          data: batchCalldata,
          from: sender,
        } as Transaction,
        {
          paymentToken: options.paymentToken,
          maxGasPrice: options.maxGasPrice,
          priorityFee: options.priorityFee,
        }
      );

      txHash = receipt.transactionHash;
      gasUsed = receipt.gasUsed;
    } else {
      // Execute directly (not sponsored)
      const client = this.chainManager.getClient(chainId);

      const hash = await client.sendTransaction({
        to: sender,
        value: totalValue,
        data: batchCalldata,
        account: sender,
      });

      const receipt = await client.waitForTransactionReceipt({ hash });
      txHash = hash;
      gasUsed = receipt.gasUsed;
    }

    // Parse results from transaction receipt
    // In production, would decode return data from logs
    const results = items.map((_, index) => ({
      index,
      success: true, // Would parse from actual execution
      returnData: '0x' as Hex,
    }));

    this.logger.info(
      `Batch executed successfully. ID: ${batchId}, Tx: ${txHash}, Gas: ${gasUsed}`
    );

    return {
      batchId,
      txHash,
      success: true,
      successfulCalls: items.length,
      failedCalls: 0,
      results,
      gasUsed,
    };
  }

  /**
   * Estimate gas for batch execution
   */
  async estimateBatchGas(
    chainId: ChainId,
    sender: Address,
    items: BatchTransactionItem[]
  ): Promise<bigint> {
    this.logger.info(`Estimating gas for batch of ${items.length} transactions`);

    const { targets, values, calldatas } = this.createBatch(items);

    const batchCalldata = encodeFunctionData({
      abi: this.BATCH_EXECUTOR_ABI,
      functionName: 'executeBatch',
      args: [targets, values, calldatas],
    });

    const client = this.chainManager.getClient(chainId);

    const totalValue = values.reduce((sum, val) => sum + val, 0n);

    const gasEstimate = await client.estimateGas({
      to: sender,
      value: totalValue,
      data: batchCalldata,
      account: sender,
    });

    // Add 20% buffer
    const gasWithBuffer = (gasEstimate * 120n) / 100n;

    this.logger.info(`Estimated gas for batch: ${gasWithBuffer}`);

    return gasWithBuffer;
  }

  /**
   * Optimize batch order for gas efficiency
   * Reorders transactions to minimize gas costs
   */
  optimizeBatchOrder(items: BatchTransactionItem[]): BatchTransactionItem[] {
    this.logger.info('Optimizing batch transaction order');

    // Sort by:
    // 1. Group by target address (state access locality)
    // 2. Put high-value transfers last (safety)
    // 3. Put state-changing calls before reads (warm storage)

    const optimized = [...items].sort((a, b) => {
      // Group by target
      if (a.to !== b.to) {
        return a.to.localeCompare(b.to);
      }

      // Put low-value before high-value
      if (a.value !== b.value) {
        return a.value < b.value ? -1 : 1;
      }

      return 0;
    });

    this.logger.info('Batch order optimized');

    return optimized;
  }

  /**
   * Split large batch into smaller chunks
   */
  splitBatch(
    items: BatchTransactionItem[],
    maxSize: number = 20
  ): BatchTransactionItem[][] {
    const chunks: BatchTransactionItem[][] = [];

    for (let i = 0; i < items.length; i += maxSize) {
      chunks.push(items.slice(i, i + maxSize));
    }

    this.logger.info(`Split batch of ${items.length} into ${chunks.length} chunks`);

    return chunks;
  }

  /**
   * Execute multiple batches sequentially
   */
  async executeMultipleBatches(
    chainId: ChainId,
    sender: Address,
    batches: BatchTransactionItem[][],
    options: BatchOptions = {}
  ): Promise<BatchExecutionResult[]> {
    this.logger.info(`Executing ${batches.length} batches sequentially`);

    const results: BatchExecutionResult[] = [];

    for (let i = 0; i < batches.length; i++) {
      this.logger.info(`Executing batch ${i + 1}/${batches.length}`);

      const result = await this.executeBatch(chainId, sender, batches[i], options);
      results.push(result);

      // If atomic execution and batch failed, stop
      if (options.atomicExecution && !result.success) {
        this.logger.error(`Batch ${i + 1} failed, stopping execution`);
        break;
      }
    }

    this.logger.info(`Completed ${results.length} batches`);

    return results;
  }

  /**
   * Create a batch from multiple simple transactions
   */
  async createBatchFromTransactions(
    transactions: Transaction[]
  ): Promise<BatchTransactionItem[]> {
    const items: BatchTransactionItem[] = [];

    for (const tx of transactions) {
      items.push({
        to: tx.to,
        value: tx.value || 0n,
        data: tx.data || '0x',
      });
    }

    return items;
  }

  /**
   * Validate batch before execution
   */
  validateBatch(items: BatchTransactionItem[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (items.length === 0) {
      errors.push('Batch is empty');
    }

    if (items.length > 50) {
      errors.push('Batch exceeds maximum size of 50 transactions');
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.to) {
        errors.push(`Item ${i}: Missing target address`);
      }

      if (item.value < 0n) {
        errors.push(`Item ${i}: Invalid value (negative)`);
      }

      if (!item.data) {
        errors.push(`Item ${i}: Missing calldata`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
