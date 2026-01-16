import type {
  MinaConfig,
  Chain,
  Token,
  Quote,
  QuoteParams,
  ExecuteOptions,
  ExecutionResult,
  TransactionStatus,
  Balance,
} from './types';
import { DEFAULT_SLIPPAGE, HYPEREVM_CHAIN_ID } from './constants';

/**
 * Main client for the Mina Bridge SDK
 *
 * @example
 * ```typescript
 * const mina = new Mina({
 *   integrator: 'my-app',
 *   autoDeposit: true,
 * });
 *
 * const chains = await mina.getChains();
 * const quote = await mina.getQuote({
 *   fromChainId: 1,
 *   toChainId: 999,
 *   fromToken: '0x...',
 *   toToken: '0x...',
 *   fromAmount: '1000000',
 *   fromAddress: '0x...',
 * });
 * ```
 */
export class Mina {
  private config: MinaConfig;

  /**
   * Create a new Mina client instance
   * @param config - Client configuration
   */
  constructor(config: MinaConfig) {
    this.config = {
      autoDeposit: true,
      defaultSlippage: DEFAULT_SLIPPAGE,
      ...config,
    };
  }

  /**
   * Get the client configuration
   */
  getConfig(): MinaConfig {
    return { ...this.config };
  }

  /**
   * Get supported source chains for bridging
   * @returns Array of supported chains
   */
  async getChains(): Promise<Chain[]> {
    // TODO: Implement via LiFi API
    throw new Error('Not implemented');
  }

  /**
   * Get available tokens for a specific chain
   * @param chainId - Chain ID to get tokens for
   * @returns Array of available tokens
   */
  async getTokens(chainId: number): Promise<Token[]> {
    // TODO: Implement via LiFi API
    throw new Error('Not implemented');
  }

  /**
   * Get token balance for an address
   * @param chainId - Chain ID
   * @param tokenAddress - Token contract address
   * @param walletAddress - Wallet address to check balance for
   * @returns Balance information
   */
  async getBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): Promise<Balance> {
    // TODO: Implement via RPC/LiFi API
    throw new Error('Not implemented');
  }

  /**
   * Get a bridge quote
   * @param params - Quote parameters
   * @returns Quote with route and fee information
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    const quoteParams: QuoteParams = {
      ...params,
      toChainId: params.toChainId ?? HYPEREVM_CHAIN_ID,
      slippage: params.slippage ?? this.config.defaultSlippage,
    };

    // TODO: Implement via LiFi API
    throw new Error('Not implemented');
  }

  /**
   * Execute a bridge transaction
   * @param options - Execution options including quote and signer
   * @returns Execution result with status and transaction hash
   */
  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    // TODO: Implement transaction execution
    throw new Error('Not implemented');
  }

  /**
   * Get the status of a bridge transaction
   * @param txHash - Transaction hash to check
   * @returns Current transaction status
   */
  async getStatus(txHash: string): Promise<TransactionStatus> {
    // TODO: Implement status tracking
    throw new Error('Not implemented');
  }

  /**
   * Check if auto-deposit is enabled
   */
  isAutoDepositEnabled(): boolean {
    return this.config.autoDeposit ?? true;
  }

  /**
   * Set auto-deposit preference
   * @param enabled - Whether to enable auto-deposit
   */
  setAutoDeposit(enabled: boolean): void {
    this.config.autoDeposit = enabled;
  }
}
