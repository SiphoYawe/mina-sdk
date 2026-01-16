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
} from './types';
import { DEFAULT_SLIPPAGE, HYPEREVM_CHAIN_ID } from './constants';
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
  createBalanceCache,
  BalanceCache,
  type BalanceWithMetadata,
  type BalancesResponse,
  type SingleBalanceResponse,
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
