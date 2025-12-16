import type { GasPortConfig } from '@gasport/types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Configuration validator
 */
export class ConfigValidator {
  /**
   * Validate GasPort configuration
   * @param config Configuration to validate
   * @returns Validation result
   */
  static validate(config: GasPortConfig): ValidationResult {
    const errors: string[] = [];

    // Validate chains
    if (!config.chains || config.chains.length === 0) {
      errors.push('At least one chain must be configured');
    } else {
      for (const chain of config.chains) {
        if (!chain.chainId) {
          errors.push(`Chain missing chainId: ${chain.name || 'unknown'}`);
        }
        if (!chain.rpcUrl) {
          errors.push(`Chain ${chain.chainId} missing rpcUrl`);
        }
        if (!chain.name) {
          errors.push(`Chain ${chain.chainId} missing name`);
        }
        if (!chain.slug) {
          errors.push(`Chain ${chain.chainId} missing slug`);
        }
      }

      // Check for duplicate chain IDs
      const chainIds = config.chains.map((c) => c.chainId);
      const duplicates = chainIds.filter((id, index) => chainIds.indexOf(id) !== index);
      if (duplicates.length > 0) {
        errors.push(`Duplicate chain IDs found: ${duplicates.join(', ')}`);
      }
    }

    // Validate default chain if specified
    if (config.defaultChain) {
      const hasDefaultChain = config.chains.some((c) => c.chainId === config.defaultChain);
      if (!hasDefaultChain) {
        errors.push(`Default chain ${config.defaultChain} not found in configured chains`);
      }
    }

    // Validate routing config if specified
    if (config.routing) {
      if (config.routing.maxHops !== undefined && config.routing.maxHops < 1) {
        errors.push('routing.maxHops must be at least 1');
      }
      if (
        config.routing.slippageTolerance !== undefined &&
        (config.routing.slippageTolerance < 0 || config.routing.slippageTolerance > 100)
      ) {
        errors.push('routing.slippageTolerance must be between 0 and 100');
      }
      if (config.routing.timeout !== undefined && config.routing.timeout < 1) {
        errors.push('routing.timeout must be at least 1 second');
      }
    }

    // Validate gas config if specified
    if (config.gas) {
      if (config.gas.maxGasPrice !== undefined && config.gas.maxGasPrice <= 0n) {
        errors.push('gas.maxGasPrice must be greater than 0');
      }
      if (config.gas.gasLimit !== undefined && config.gas.gasLimit <= 0n) {
        errors.push('gas.gasLimit must be greater than 0');
      }
      if (
        config.gas.bufferPercent !== undefined &&
        (config.gas.bufferPercent < 0 || config.gas.bufferPercent > 100)
      ) {
        errors.push('gas.bufferPercent must be between 0 and 100');
      }
    }

    // Validate monitoring config if specified
    if (config.monitoring?.webhookUrl) {
      try {
        new URL(config.monitoring.webhookUrl);
      } catch {
        errors.push('monitoring.webhookUrl must be a valid URL');
      }
    }

    // Validate security config if specified
    if (config.security?.rateLimits) {
      const { maxRequests, windowSeconds } = config.security.rateLimits;
      if (maxRequests < 1) {
        errors.push('security.rateLimits.maxRequests must be at least 1');
      }
      if (windowSeconds < 1) {
        errors.push('security.rateLimits.windowSeconds must be at least 1');
      }
    }

    // Validate RPC timeout if specified
    if (config.rpcTimeout !== undefined && config.rpcTimeout < 1000) {
      errors.push('rpcTimeout must be at least 1000ms');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate and throw if invalid
   * @param config Configuration to validate
   * @throws ConfigurationError if invalid
   */
  static validateOrThrow(config: GasPortConfig): void {
    const result = this.validate(config);
    if (!result.valid) {
      throw new Error(`Invalid configuration:\n${result.errors.join('\n')}`);
    }
  }
}
