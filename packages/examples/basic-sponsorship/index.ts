/**
 * Basic Gas Sponsorship Example
 *
 * This example demonstrates how to sponsor a simple ETH transfer
 * on Arbitrum One using USDC from XAI chain.
 */

import { GasPortClient, ChainId, CHAIN_CONFIGS, SUPPORTED_TOKENS } from '@gasport/sdk';
import { parseEther } from 'viem';

async function main() {
  // Initialize GasPort client
  const gasport = new GasPortClient({
    // Configure supported chains
    chains: [CHAIN_CONFIGS['arbitrum-one'], CHAIN_CONFIGS.xai],

    // Configure supported tokens
    supportedTokens: [SUPPORTED_TOKENS.USDC, SUPPORTED_TOKENS.ARB, SUPPORTED_TOKENS.ETH],

    // Optional: API key for hosted service
    // apiKey: process.env.GASPORT_API_KEY,

    // Optional: Routing configuration
    routing: {
      maxHops: 3,
      slippageTolerance: 1, // 1%
      preferredBridge: 'native',
    },

    // Optional: Gas configuration
    gas: {
      bufferPercent: 20, // 20% buffer
    },

    // Optional: Monitoring
    monitoring: {
      logLevel: 'info',
    },
  });

  console.log('✅ GasPort client initialized\n');

  // Define the transaction you want to execute
  const transaction = {
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    value: parseEther('0.1'), // Send 0.1 ETH
    chainId: ChainId.ARBITRUM_ONE, // Execute on Arbitrum One
  };

  console.log('📋 Transaction details:');
  console.log('  To:', transaction.to);
  console.log('  Value:', transaction.value.toString(), 'wei (0.1 ETH)');
  console.log('  Chain:', 'Arbitrum One\n');

  // Step 1: Get a quote (optional but recommended)
  console.log('💰 Getting quote...');
  try {
    const quote = await gasport.getQuote(transaction, {
      paymentToken: 'USDC',
      paymentChain: ChainId.XAI,
      routingPreference: 'cost', // Optimize for lowest cost
    });

    console.log('✅ Quote received:');
    console.log('  Quote ID:', quote.quoteId);
    console.log('  Estimated cost:', quote.estimatedCost.toString(), 'USDC');
    console.log('  Estimated time:', quote.estimatedTime, 'seconds');
    console.log('  Route:', quote.route.hops.length, 'hops');
    console.log('  Expires at:', new Date(quote.expiresAt).toISOString());
    console.log('\n  Cost breakdown:');
    console.log('    Execution gas:', quote.breakdown.executionGas.toString());
    console.log('    L1 data fee:', quote.breakdown.l1DataFee.toString());
    console.log('    Bridge fee:', quote.breakdown.bridgeFee.toString());
    console.log('    Swap fee:', quote.breakdown.swapFee.toString());
    console.log('    Protocol fee:', quote.breakdown.protocolFee.toString());
    console.log('    Total:', quote.breakdown.total.toString(), '\n');

    // Step 2: Execute the quote
    console.log('🚀 Executing transaction...');
    const receipt = await gasport.executeQuote(quote);

    console.log('✅ Transaction successful!');
    console.log('  Transaction hash:', receipt.hash);
    console.log('  Block number:', receipt.blockNumber?.toString());
    console.log('  Gas used:', receipt.gasUsed?.toString());
    console.log('  Status:', receipt.status);
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }

  // Alternative: Sponsor transaction directly (without quote)
  // This is simpler but doesn't give you a cost preview
  console.log('\n---\n');
  console.log('Alternative: Direct sponsorship (without quote)\n');

  try {
    const receipt = await gasport.sponsorTransaction(transaction, {
      paymentToken: 'USDC',
      paymentChain: ChainId.XAI,
      maxGasCost: parseEther('10'), // Maximum 10 USDC
    });

    console.log('✅ Transaction successful!');
    console.log('  Transaction hash:', receipt.hash);
  } catch (error) {
    console.error('❌ Error:', error);
  }

  // Cleanup
  await gasport.destroy();
  console.log('\n✅ GasPort client destroyed');
}

// Run the example
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
