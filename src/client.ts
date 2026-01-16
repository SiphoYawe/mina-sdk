import type {
  MinaConfig,
  Chain,
  Token,
  Quote,
  QuoteParams,
  GasEstimate,
  ExecuteOptions,
  ExecutionResult,
  TransactionStatus,
  Balance,
  ExecutionStatusType,
  StepStatusPayload,
  TransactionStatusPayload,
} from './types';
import { DEFAULT_SLIPPAGE, HYPEREVM_CHAIN_ID } from './constants';
import {
  SDKEventEmitter,
  SDK_EVENTS,
  type SDKEventName,
  type SDKEventPayloads,
} from './events';
import {
  executionStore,
  type ExecutionStatusResult,
} from './execution-store';
import {
  getChains as fetchChains,
  getDestinationChains as fetchDestinationChains,
  getChainsByRoutes as fetchChainsByRoutes,
  getChainById as fetchChainById,
  createChainCache,
  ChainCache,
  type ChainsResponse,
} from './services/chain';
import {
  getTokens as fetchTokens,
  getBridgeableTokens as fetchBridgeableTokens,
  getDestinationTokens as fetchDestinationTokens,
  getTokenByAddress as fetchTokenByAddress,
  createTokenCache,
  TokenCache,
  type TokensResponse,
} from './services/token';
import {
  getBalance as fetchBalance,
  getBalances as fetchBalances,
  getChainBalances as fetchChainBalances,
  getBalanceWithMetadata as fetchBalanceWithMetadata,
  validateBalance as doValidateBalance,
  checkBalance as doCheckBalance,
  createBalanceCache,
  BalanceCache,
  type BalanceWithMetadata,
  type BalancesResponse,
  type SingleBalanceResponse,
  type BalanceValidation,
  type BalanceCheckResult,
} from './services/balance';
import {
  getQuote as fetchQuote,
  getQuotes as fetchQuotes,
  estimatePriceImpact as computePriceImpact,
  createQuoteCache,
  QuoteCache,
  type QuotesResponse,
  type PriceImpactEstimate,
} from './services/quote';
import {
  execute as executeTransaction,
  validateQuote,
} from './services/execute';
import {
  detectUsdcArrival as detectArrival,
  detectUsdcArrivalFromSnapshot as detectArrivalFromSnapshot,
  snapshotUsdcBalance as snapshotBalance,
  checkUsdcBalance as checkUsdcBalanceOnHyperEVM,
  type UsdcArrivalResult,
  type DetectionOptions,
} from './services/deposit';

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
  private chainCache: ChainCache;
  private tokenCache: TokenCache;
  private balanceCache: BalanceCache;
  private quoteCache: QuoteCache;
  private emitter: SDKEventEmitter;

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
    // Each Mina client instance gets its own cache to avoid shared state issues
    this.chainCache = createChainCache();
    this.tokenCache = createTokenCache();
    this.balanceCache = createBalanceCache();
    this.quoteCache = createQuoteCache();
    this.emitter = new SDKEventEmitter();
  }

  // ==================== Event System ====================

  /**
   * Subscribe to an SDK event
   * @param event - Event name from SDK_EVENTS
   * @param callback - Callback function
   *
   * @example
   * ```typescript
   * mina.on('stepChanged', (step) => {
   *   console.log(`Step ${step.stepId}: ${step.status}`);
   * });
   *
   * mina.on('executionCompleted', (result) => {
   *   console.log('Bridge complete!', result.txHash);
   * });
   * ```
   */
  on<K extends SDKEventName>(
    event: K,
    callback: (data: SDKEventPayloads[K]) => void
  ): void {
    this.emitter.on(event, callback);
  }

  /**
   * Unsubscribe from an SDK event
   * @param event - Event name
   * @param callback - Callback function to remove
   *
   * @example
   * ```typescript
   * const handler = (step) => console.log(step);
   * mina.on('stepChanged', handler);
   * // Later...
   * mina.off('stepChanged', handler);
   * ```
   */
  off<K extends SDKEventName>(
    event: K,
    callback: (data: SDKEventPayloads[K]) => void
  ): void {
    this.emitter.off(event, callback);
  }

  /**
   * Subscribe to an SDK event once (auto-unsubscribes after first call)
   * @param event - Event name
   * @param callback - Callback function
   *
   * @example
   * ```typescript
   * mina.once('executionCompleted', (result) => {
   *   console.log('First execution completed!', result.txHash);
   * });
   * ```
   */
  once<K extends SDKEventName>(
    event: K,
    callback: (data: SDKEventPayloads[K]) => void
  ): void {
    this.emitter.once(event, callback);
  }

  /**
   * Get the internal event emitter (for advanced use)
   * @internal
   */
  getEmitter(): SDKEventEmitter {
    return this.emitter;
  }

  // ==================== Execution Status ====================

  /**
   * Get the status of an execution by ID
   * Allows polling for execution progress without callbacks
   *
   * @param executionId - The execution ID returned from execute()
   * @returns ExecutionStatusResult with current status, progress, and error details
   *
   * @example
   * ```typescript
   * const result = await mina.execute({ quote, signer });
   * const executionId = result.executionId;
   *
   * // Poll for status
   * const status = mina.getExecutionStatus(executionId);
   * console.log(`Progress: ${status.progress}%`);
   * console.log(`Current step: ${status.currentStep?.type}`);
   *
   * if (status.error) {
   *   console.error(`Failed: ${status.error.message}`);
   *   console.log(`Recoverable: ${status.error.recoverable}`);
   * }
   * ```
   */
  getExecutionStatus(executionId: string): ExecutionStatusResult {
    return executionStore.getStatus(executionId);
  }

  /**
   * Get the client configuration
   */
  getConfig(): MinaConfig {
    return { ...this.config };
  }

  /**
   * Get supported source chains for bridging
   * Fetches from LI.FI API with caching (30 min TTL)
   *
   * @returns Array of 40+ supported origin chains with metadata
   * @throws ChainFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * const chains = await mina.getChains();
   * console.log(`${chains.length} chains supported`);
   * // Displays: "50 chains supported"
   * ```
   */
  async getChains(): Promise<Chain[]> {
    const response = await fetchChains(this.chainCache);
    return response.chains;
  }

  /**
   * Get supported source chains with metadata about cache staleness
   * Fetches from LI.FI API with caching (30 min TTL)
   *
   * @returns Response object with chains array and metadata (isStale, cachedAt)
   * @throws ChainFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * const { chains, isStale, cachedAt } = await mina.getChainsWithMetadata();
   * if (isStale) {
   *   console.warn('Using cached data from', new Date(cachedAt));
   * }
   * ```
   */
  async getChainsWithMetadata(): Promise<ChainsResponse> {
    return fetchChains(this.chainCache);
  }

  /**
   * Get destination chains (HyperEVM)
   * Returns the supported destination chain(s) for bridging
   *
   * @returns Array containing HyperEVM chain
   *
   * @example
   * ```typescript
   * const destinations = mina.getDestinationChains();
   * console.log(destinations[0].name); // "HyperEVM"
   * ```
   */
  getDestinationChains(): Chain[] {
    return fetchDestinationChains();
  }

  /**
   * Get chains with valid bridge routes to a specific destination
   * Useful for filtering to only chains that can bridge to HyperEVM
   *
   * @param toChainId - Destination chain ID (defaults to HyperEVM 999)
   * @returns Array of chains with valid routes
   * @throws ChainFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * // Get only chains that can bridge to HyperEVM
   * const bridgeableChains = await mina.getChainsByRoutes();
   * ```
   */
  async getChainsByRoutes(toChainId: number = HYPEREVM_CHAIN_ID): Promise<Chain[]> {
    return fetchChainsByRoutes(toChainId, this.chainCache);
  }

  /**
   * Get a specific chain by its ID
   *
   * @param chainId - The chain ID to look up
   * @returns Chain if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const ethereum = await mina.getChainById(1);
   * console.log(ethereum?.name); // "Ethereum"
   * ```
   */
  async getChainById(chainId: number): Promise<Chain | undefined> {
    return fetchChainById(chainId, this.chainCache);
  }

  /**
   * Invalidate the chain cache
   * Forces a fresh fetch on next getChains() call
   *
   * @example
   * ```typescript
   * mina.invalidateChainCache();
   * const freshChains = await mina.getChains();
   * ```
   */
  invalidateChainCache(): void {
    this.chainCache.invalidate();
  }

  /**
   * Get all available tokens for a specific chain
   * Fetches from LI.FI API with caching (15 min TTL)
   *
   * @param chainId - Chain ID to get tokens for
   * @returns Array of available tokens with metadata
   * @throws TokenFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * const tokens = await mina.getTokens(1); // Ethereum tokens
   * console.log(`Found ${tokens.length} tokens`);
   * ```
   */
  async getTokens(chainId: number): Promise<Token[]> {
    const response = await fetchTokens(chainId, this.tokenCache);
    return response.tokens;
  }

  /**
   * Get tokens with metadata about cache staleness
   * Fetches from LI.FI API with caching (15 min TTL)
   *
   * @param chainId - Chain ID to get tokens for
   * @returns Response object with tokens array and metadata (isStale, cachedAt)
   * @throws TokenFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * const { tokens, isStale, cachedAt } = await mina.getTokensWithMetadata(1);
   * if (isStale) {
   *   console.warn('Using cached data from', new Date(cachedAt));
   * }
   * ```
   */
  async getTokensWithMetadata(chainId: number): Promise<TokensResponse> {
    return fetchTokens(chainId, this.tokenCache);
  }

  /**
   * Get tokens that can be bridged from a specific chain to HyperEVM
   * Only returns tokens with valid bridge routes
   *
   * @param chainId - Source chain ID
   * @returns Array of bridgeable tokens
   * @throws TokenFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * // Get only tokens that can bridge from Ethereum to HyperEVM
   * const bridgeableTokens = await mina.getBridgeableTokens(1);
   * ```
   */
  async getBridgeableTokens(chainId: number): Promise<Token[]> {
    const response = await fetchBridgeableTokens(chainId, this.tokenCache);
    return response.tokens;
  }

  /**
   * Get bridgeable tokens with metadata about cache staleness
   *
   * @param chainId - Source chain ID
   * @returns Response object with tokens and metadata
   * @throws TokenFetchError if API fails and no cache available
   */
  async getBridgeableTokensWithMetadata(chainId: number): Promise<TokensResponse> {
    return fetchBridgeableTokens(chainId, this.tokenCache);
  }

  /**
   * Get destination tokens available on HyperEVM
   * Returns verified token addresses for receiving on the destination chain
   *
   * @returns Array of tokens receivable on HyperEVM (USDC, HYPE)
   *
   * @example
   * ```typescript
   * const destTokens = mina.getDestinationTokens();
   * console.log(destTokens.map(t => t.symbol)); // ['USDC', 'HYPE']
   * ```
   */
  getDestinationTokens(): Token[] {
    return fetchDestinationTokens();
  }

  /**
   * Get a specific token by its address on a chain
   *
   * @param chainId - Chain ID
   * @param tokenAddress - Token contract address
   * @returns Token if found, undefined otherwise
   *
   * @example
   * ```typescript
   * const usdc = await mina.getTokenByAddress(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
   * console.log(usdc?.symbol); // 'USDC'
   * ```
   */
  async getTokenByAddress(chainId: number, tokenAddress: string): Promise<Token | undefined> {
    return fetchTokenByAddress(chainId, tokenAddress, this.tokenCache);
  }

  /**
   * Invalidate the token cache
   * Forces a fresh fetch on next getTokens() call
   *
   * @param chainId - Optional chain ID to invalidate (invalidates all if not provided)
   *
   * @example
   * ```typescript
   * mina.invalidateTokenCache(1); // Invalidate Ethereum tokens
   * mina.invalidateTokenCache();   // Invalidate all tokens
   * ```
   */
  invalidateTokenCache(chainId?: number): void {
    if (chainId !== undefined) {
      this.tokenCache.invalidateChain(chainId);
    } else {
      this.tokenCache.invalidate();
    }
  }

  /**
   * Get token balance for a wallet address
   * Fetches from LI.FI API with caching (10s TTL) and request deduplication
   *
   * @param chainId - Chain ID
   * @param tokenAddress - Token contract address (or NATIVE_TOKEN_ADDRESS for native token)
   * @param walletAddress - Wallet address to check balance for
   * @returns Balance information with token metadata
   * @throws BalanceFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * // Get USDC balance on Ethereum
   * const balance = await mina.getBalance(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x...');
   * console.log(`Balance: ${balance.formatted} ${balance.token.symbol}`);
   * console.log(`USD Value: $${balance.balanceUsd?.toFixed(2) ?? 'N/A'}`);
   *
   * // Get native ETH balance
   * const ethBalance = await mina.getBalance(1, NATIVE_TOKEN_ADDRESS, '0x...');
   * ```
   */
  async getBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): Promise<BalanceWithMetadata> {
    return fetchBalance(
      { address: walletAddress, chainId, tokenAddress },
      this.balanceCache
    );
  }

  /**
   * Get token balance with metadata about cache staleness (Issue 5)
   * Fetches from LI.FI API with caching (10s TTL) and request deduplication
   *
   * @param chainId - Chain ID
   * @param tokenAddress - Token contract address (or NATIVE_TOKEN_ADDRESS for native token)
   * @param walletAddress - Wallet address to check balance for
   * @returns Response object with balance and metadata (isStale, cachedAt)
   * @throws BalanceFetchError if API fails and no cache available
   *
   * @example
   * ```typescript
   * const { balance, isStale, cachedAt } = await mina.getBalanceWithMetadata(
   *   1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0x...'
   * );
   * if (isStale) {
   *   console.warn('Using cached data from', new Date(cachedAt));
   * }
   * ```
   */
  async getBalanceWithMetadata(
    chainId: number,
    tokenAddress: string,
    walletAddress: string
  ): Promise<SingleBalanceResponse> {
    return fetchBalanceWithMetadata(
      { address: walletAddress, chainId, tokenAddress },
      this.balanceCache
    );
  }

  /**
   * Get token balances across multiple chains in parallel
   * Includes both native tokens and ERC-20 tokens
   *
   * @param walletAddress - Wallet address to check balances for
   * @param chainIds - Array of chain IDs to fetch balances from
   * @param tokenAddresses - Optional map of chain ID to token addresses
   * @returns Balances response with all chain balances and total USD value
   * @throws BalanceFetchError if all API requests fail and no cache available
   *
   * @example
   * ```typescript
   * // Get native token balances on Ethereum and Arbitrum
   * const response = await mina.getBalances('0x...', [1, 42161]);
   * console.log(`Total USD: $${response.totalUsd.toFixed(2)}`);
   *
   * // Get specific token balances
   * const response = await mina.getBalances('0x...', [1], {
   *   1: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'] // USDC on Ethereum
   * });
   * ```
   */
  async getBalances(
    walletAddress: string,
    chainIds: number[],
    tokenAddresses?: Record<number, string[]>
  ): Promise<BalancesResponse> {
    return fetchBalances(
      { address: walletAddress, chainIds, tokenAddresses },
      this.balanceCache
    );
  }

  /**
   * Get all supported token balances for a specific chain
   * Returns balances sorted by value (non-zero first, then by USD value)
   *
   * @param walletAddress - Wallet address
   * @param chainId - Chain ID to fetch balances from
   * @returns Array of balances sorted by value
   *
   * @example
   * ```typescript
   * const balances = await mina.getChainBalances('0x...', 1);
   * for (const balance of balances) {
   *   if (balance.hasBalance) {
   *     console.log(`${balance.token.symbol}: ${balance.formatted}`);
   *   }
   * }
   * ```
   */
  async getChainBalances(
    walletAddress: string,
    chainId: number
  ): Promise<BalanceWithMetadata[]> {
    return fetchChainBalances(walletAddress, chainId, this.balanceCache);
  }

  /**
   * Invalidate the balance cache
   * Forces a fresh fetch on next getBalance() call
   *
   * @param walletAddress - Optional wallet address to invalidate (invalidates all if not provided)
   *
   * @example
   * ```typescript
   * mina.invalidateBalanceCache('0x...'); // Invalidate specific wallet
   * mina.invalidateBalanceCache();         // Invalidate all balances
   * ```
   */
  invalidateBalanceCache(walletAddress?: string): void {
    if (walletAddress) {
      this.balanceCache.invalidateAddress(walletAddress);
    } else {
      this.balanceCache.invalidate();
    }
  }

  /**
   * Validate user balance against a quote
   * Checks both token balance and native gas token balance
   *
   * @param quote - Quote to validate against
   * @param walletAddress - User's wallet address
   * @returns Balance validation result with warnings
   *
   * @example
   * ```typescript
   * const quote = await mina.getQuote({...});
   * const validation = await mina.validateBalance(quote, '0x...');
   *
   * if (!validation.valid) {
   *   for (const warning of validation.warnings) {
   *     if (warning.type === 'INSUFFICIENT_BALANCE') {
   *       console.error(`Need ${warning.shortfall} more ${warning.token.symbol}`);
   *     } else if (warning.type === 'INSUFFICIENT_GAS') {
   *       console.error(`Need more gas: ${warning.message}`);
   *     }
   *   }
   * }
   * ```
   */
  async validateBalance(quote: Quote, walletAddress: string): Promise<BalanceValidation> {
    return doValidateBalance(quote, walletAddress, this.balanceCache);
  }

  /**
   * Lightweight balance check without requiring a full quote
   * Checks if a user has sufficient balance for a given amount
   * Uses cached balances (10s TTL) to reduce RPC calls
   *
   * @param chainId - Chain ID
   * @param tokenAddress - Token address
   * @param walletAddress - User's wallet address
   * @param amount - Required amount in smallest unit (wei)
   * @returns Balance check result
   *
   * @example
   * ```typescript
   * // Check if user has 1000 USDC before showing quote
   * const check = await mina.checkBalance(
   *   1,                                          // Ethereum
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   '0x...',                                     // Wallet
   *   '1000000000'                                 // 1000 USDC (6 decimals)
   * );
   *
   * if (!check.sufficient) {
   *   console.log(`Balance: ${check.formatted}, need ${check.shortfall} more`);
   * }
   * ```
   */
  async checkBalance(
    chainId: number,
    tokenAddress: string,
    walletAddress: string,
    amount: string
  ): Promise<BalanceCheckResult> {
    return doCheckBalance(chainId, tokenAddress, walletAddress, amount, this.balanceCache);
  }

  /**
   * Get a bridge quote
   * Fetches optimal route from LI.FI API with fee breakdown
   *
   * @param params - Quote parameters
   * @param timeoutMs - Optional timeout override (default: 30s)
   * @returns Quote with route and fee information
   * @throws InvalidQuoteParamsError if parameters are invalid
   * @throws NoRouteFoundError if no route is available
   * @throws NetworkError if API request fails
   *
   * @example
   * ```typescript
   * const quote = await mina.getQuote({
   *   fromChainId: 1,
   *   toChainId: 999,
   *   fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f', // HyperEVM USDC
   *   fromAmount: '1000000000', // 1000 USDC (6 decimals)
   *   fromAddress: '0x...',
   * });
   * console.log(`Will receive: ${quote.toAmount}`);
   * console.log(`Estimated time: ${quote.estimatedTime}s`);
   * console.log(`Total fees: $${quote.fees.totalUsd}`);
   * ```
   */
  async getQuote(params: QuoteParams, timeoutMs?: number): Promise<Quote> {
    const quoteParams: QuoteParams = {
      ...params,
      toChainId: params.toChainId ?? HYPEREVM_CHAIN_ID,
      slippage: params.slippage ?? this.config.defaultSlippage,
    };

    return fetchQuote(
      quoteParams,
      this.config.autoDeposit ?? true,
      this.quoteCache,
      timeoutMs
    );
  }

  /**
   * Get multiple bridge quotes for comparison
   * Fetches all available routes from LI.FI API
   *
   * @param params - Quote parameters
   * @param timeoutMs - Optional timeout override (default: 30s)
   * @returns Array of quotes sorted by recommendation
   * @throws InvalidQuoteParamsError if parameters are invalid
   * @throws NoRouteFoundError if no routes are available
   * @throws NetworkError if API request fails
   *
   * @example
   * ```typescript
   * const { quotes, recommendedIndex } = await mina.getQuotes({
   *   fromChainId: 1,
   *   toChainId: 999,
   *   fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
   *   toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f',
   *   fromAmount: '1000000000',
   *   fromAddress: '0x...',
   * });
   *
   * console.log(`Found ${quotes.length} routes`);
   * console.log(`Recommended: ${quotes[recommendedIndex].steps[0].tool}`);
   * ```
   */
  async getQuotes(params: QuoteParams, timeoutMs?: number): Promise<QuotesResponse> {
    const quoteParams: QuoteParams = {
      ...params,
      toChainId: params.toChainId ?? HYPEREVM_CHAIN_ID,
      slippage: params.slippage ?? this.config.defaultSlippage,
    };

    return fetchQuotes(
      quoteParams,
      this.config.autoDeposit ?? true,
      this.quoteCache,
      timeoutMs
    );
  }

  /**
   * Invalidate the quote cache
   * Forces fresh quotes on next getQuote() call
   *
   * @example
   * ```typescript
   * mina.invalidateQuoteCache();
   * const freshQuote = await mina.getQuote({...});
   * ```
   */
  invalidateQuoteCache(): void {
    this.quoteCache.invalidate();
  }

  /**
   * Get gas estimate from a quote
   * Extracts detailed gas estimation with per-step breakdown
   *
   * @param quote - Quote to extract gas estimate from
   * @returns GasEstimate with detailed breakdown
   *
   * @example
   * ```typescript
   * const quote = await mina.getQuote({...});
   * const gasEstimate = mina.getGasEstimate(quote);
   *
   * console.log(`Total gas: $${gasEstimate.gasCostUsd}`);
   * console.log(`Gas price: ${gasEstimate.gasPrice} wei`);
   *
   * // Per-step breakdown
   * if (gasEstimate.steps) {
   *   for (const step of gasEstimate.steps) {
   *     console.log(`${step.stepType}: ${step.gasUnits} units ($${step.gasUsd})`);
   *   }
   * }
   * ```
   */
  getGasEstimate(quote: Quote): GasEstimate {
    return quote.fees.gasEstimate;
  }

  /**
   * Estimate price impact without fetching a full quote
   * This is a lightweight method for UI preview purposes
   *
   * Note: For accurate price impact, use getQuote() which fetches real route data.
   * This method uses simplified heuristics based on trade size.
   *
   * @param fromToken - Source token (must have priceUsd)
   * @param toToken - Destination token (must have priceUsd)
   * @param fromAmount - Amount in smallest unit (wei)
   * @returns Price impact estimate with severity
   *
   * @example
   * ```typescript
   * const fromToken = await mina.getTokenByAddress(1, '0xA0b86...');
   * const toToken = await mina.getTokenByAddress(999, '0xb883...');
   *
   * if (fromToken && toToken) {
   *   const estimate = mina.estimatePriceImpact(fromToken, toToken, '1000000000');
   *   console.log(`Estimated impact: ${estimate.impact * 100}%`);
   *   console.log(`Severity: ${estimate.severity}`);
   *   if (estimate.highImpact) {
   *     console.warn('High price impact detected!');
   *   }
   * }
   * ```
   */
  estimatePriceImpact(fromToken: Token, toToken: Token, fromAmount: string): PriceImpactEstimate {
    return computePriceImpact(fromToken, toToken, fromAmount);
  }

  /**
   * Execute a bridge transaction
   * Initiates the transaction through LI.FI's execution API
   *
   * @param options - Execution options including quote and signer
   * @returns Execution result with status and transaction hash
   * @throws QuoteExpiredError if the quote has expired
   * @throws InvalidQuoteError if the quote is malformed
   * @throws TransactionFailedError if the transaction fails
   * @throws UserRejectedError if the user rejects the transaction
   *
   * @example
   * ```typescript
   * const quote = await mina.getQuote({...});
   * const result = await mina.execute({
   *   quote,
   *   signer: walletClient, // viem WalletClient or compatible signer
   *   onStepChange: (step) => console.log('Step update:', step),
   *   onStatusChange: (status) => console.log('Status:', status),
   *   infiniteApproval: true,
   * });
   *
   * if (result.status === 'completed') {
   *   console.log('Bridge complete! TxHash:', result.txHash);
   *   console.log('Received:', result.receivedAmount);
   * }
   * ```
   */
  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    return executeTransaction({
      quote: options.quote,
      signer: options.signer,
      onStepChange: options.onStepChange,
      onStatusChange: options.onStatusChange,
      onApprovalRequest: options.onApprovalRequest,
      onTransactionRequest: options.onTransactionRequest,
      infiniteApproval: options.infiniteApproval,
      emitter: this.emitter,
    });
  }

  /**
   * Validate a quote before execution
   * Checks if the quote has expired or is malformed
   *
   * @param quote - Quote to validate
   * @throws QuoteExpiredError if the quote has expired
   * @throws InvalidQuoteError if the quote is malformed
   *
   * @example
   * ```typescript
   * try {
   *   mina.validateQuote(quote);
   *   // Quote is valid, proceed with execution
   * } catch (error) {
   *   if (isQuoteExpiredError(error)) {
   *     // Fetch a new quote
   *   }
   * }
   * ```
   */
  validateQuote(quote: Quote): void {
    validateQuote(quote);
  }

  /**
   * Get the status of a bridge transaction by transaction hash
   * Searches all stored executions for the given transaction hash
   *
   * @param txHash - Transaction hash to check
   * @returns Current transaction status or null if not found
   *
   * @example
   * ```typescript
   * const status = await mina.getStatus('0x123...');
   * if (status) {
   *   console.log(`Status: ${status.status}`);
   *   console.log(`Steps: ${status.steps.length}`);
   * }
   * ```
   */
  async getStatus(txHash: string): Promise<TransactionStatus | null> {
    // Search all executions for the given txHash
    const allExecutions = executionStore.getAll();
    const execution = allExecutions.find((e) => e.txHash === txHash);

    if (!execution) {
      return null;
    }

    // Map ExecutionState status to TransactionStatus status
    const mapStatus = (status: string): TransactionStatus['status'] => {
      switch (status) {
        case 'in_progress':
          return 'bridging';
        case 'completed':
          return 'completed';
        case 'failed':
          return 'failed';
        default:
          return 'pending';
      }
    };

    return {
      id: execution.executionId,
      status: mapStatus(execution.status),
      steps: execution.steps.map((s) => ({
        stepId: s.stepId,
        stepType: s.step,
        status: s.status === 'active' ? 'executing' : s.status as 'pending' | 'executing' | 'completed' | 'failed',
        txHash: s.txHash ?? undefined,
        error: s.error?.message,
        updatedAt: s.timestamp,
      })),
      fromChainId: execution.fromChainId,
      toChainId: execution.toChainId,
      bridgeTxHash: execution.txHash ?? undefined,
      depositTxHash: undefined, // Set by deposit service
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    };
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

  /**
   * Detect USDC arrival on HyperEVM after a bridge transaction
   *
   * Polls the USDC balance on HyperEVM and detects when it increases,
   * indicating the bridged funds have arrived.
   *
   * @param walletAddress - The wallet address to monitor
   * @param options - Detection options (timeout, pollInterval, callbacks)
   * @returns UsdcArrivalResult with detected amount and details
   * @throws UsdcArrivalTimeoutError if detection times out
   *
   * @example
   * ```typescript
   * // After bridge execution completes
   * const arrival = await mina.detectUsdcArrival('0x...', {
   *   timeout: 300000, // 5 minutes
   *   onPoll: (attempt, balance) => console.log(`Poll ${attempt}: ${balance}`),
   * });
   *
   * if (arrival.detected) {
   *   console.log(`USDC arrived: ${arrival.amountFormatted} USDC`);
   *   if (mina.isAutoDepositEnabled()) {
   *     // Proceed with deposit to Hyperliquid L1
   *   }
   * }
   * ```
   */
  async detectUsdcArrival(
    walletAddress: string,
    options?: DetectionOptions
  ): Promise<UsdcArrivalResult> {
    return detectArrival(walletAddress, options);
  }

  /**
   * Detect USDC arrival starting from a known balance snapshot
   *
   * Use this when you've already captured the pre-bridge balance via
   * snapshotUsdcBalance(). More efficient than detectUsdcArrival() as
   * it doesn't need to fetch the initial balance.
   *
   * @param walletAddress - The wallet address to monitor
   * @param previousBalance - The pre-bridge balance snapshot
   * @param options - Detection options
   * @returns UsdcArrivalResult with detected amount
   * @throws UsdcArrivalTimeoutError if detection times out
   *
   * @example
   * ```typescript
   * // Before bridge
   * const preBalance = await mina.snapshotUsdcBalance('0x...');
   *
   * // Execute bridge...
   * await mina.execute({ quote, signer });
   *
   * // Detect arrival from snapshot
   * const arrival = await mina.detectUsdcArrivalFromSnapshot(
   *   '0x...',
   *   preBalance,
   *   { expectedAmount: quote.toAmount }
   * );
   * ```
   */
  async detectUsdcArrivalFromSnapshot(
    walletAddress: string,
    previousBalance: string,
    options?: DetectionOptions
  ): Promise<UsdcArrivalResult> {
    return detectArrivalFromSnapshot(walletAddress, previousBalance, options);
  }

  /**
   * Take a snapshot of USDC balance on HyperEVM
   *
   * Call this before initiating a bridge to capture the starting balance.
   * Use with detectUsdcArrivalFromSnapshot() for efficient arrival detection.
   *
   * @param walletAddress - The wallet address to snapshot
   * @returns The current USDC balance on HyperEVM
   *
   * @example
   * ```typescript
   * const preBalance = await mina.snapshotUsdcBalance('0x...');
   * // Store preBalance for later comparison
   * ```
   */
  async snapshotUsdcBalance(walletAddress: string): Promise<string> {
    return snapshotBalance(walletAddress);
  }

  /**
   * Check current USDC balance on HyperEVM (one-time check)
   *
   * @param walletAddress - The wallet address to check
   * @returns Current USDC balance details
   *
   * @example
   * ```typescript
   * const { balance, balanceFormatted } = await mina.checkUsdcBalance('0x...');
   * console.log(`HyperEVM USDC: ${balanceFormatted}`);
   * ```
   */
  async checkUsdcBalance(walletAddress: string): Promise<{
    balance: string;
    balanceFormatted: string;
    chainId: number;
    tokenAddress: string;
  }> {
    return checkUsdcBalanceOnHyperEVM(walletAddress);
  }
}
