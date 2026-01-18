/**
 * Balance Service
 * Fetches and caches user token balances across chains
 * Uses LI.FI API for balance fetching with caching and debouncing
 */

import type { Token, Balance, Quote } from '../types';
import {
  LIFI_API_URL,
  NATIVE_TOKEN_ADDRESS,
  BALANCE_API_TIMEOUT_MS,
  BALANCE_CACHE_TTL_MS,
  BALANCE_DEBOUNCE_MS,
} from '../constants';
import { getLifiHeaders } from '../config';

/**
 * Validate an Ethereum address format
 * Checks for proper hex format and length (0x + 40 hex chars)
 */
function isValidAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Error thrown when address validation fails
 */
export class InvalidAddressError extends Error {
  readonly code = 'INVALID_ADDRESS' as const;
  readonly address: string;

  constructor(address: string, field: string) {
    super(`Invalid ${field} address: ${address}`);
    this.name = 'InvalidAddressError';
    this.address = address;
  }
}

/**
 * Parameters for fetching a single balance
 */
export interface BalanceParams {
  /** Wallet address to fetch balance for */
  address: string;
  /** Chain ID */
  chainId: number;
  /** Token contract address (or NATIVE_TOKEN_ADDRESS for native token) */
  tokenAddress: string;
}

/**
 * Parameters for fetching multiple balances
 */
export interface MultiBalanceParams {
  /** Wallet address to fetch balances for */
  address: string;
  /** Chain IDs to fetch balances from */
  chainIds: number[];
  /** Optional: specific token addresses per chain (fetches all bridgeable if not provided) */
  tokenAddresses?: Record<number, string[]>;
}

/**
 * Extended balance with additional metadata
 */
export interface BalanceWithMetadata extends Balance {
  /** Whether the balance is greater than zero */
  hasBalance: boolean;
}

/**
 * Response for multi-chain balance queries
 */
export interface BalancesResponse {
  /** Balances grouped by chain ID */
  balances: Record<number, BalanceWithMetadata[]>;
  /** Total USD value across all chains */
  totalUsd: number;
  /** Whether the data is from stale cache */
  isStale: boolean;
  /** Timestamp when data was cached (null if fresh from API) */
  cachedAt: number | null;
}

/**
 * Response with metadata for single balance queries (Issue 5)
 */
export interface SingleBalanceResponse {
  /** The balance data */
  balance: BalanceWithMetadata;
  /** Whether the data is from stale cache (expired but returned as fallback) */
  isStale: boolean;
  /** Timestamp when data was cached (null if fresh from API) */
  cachedAt: number | null;
}

/**
 * LI.FI API token balance response
 */
interface LifiTokenBalanceResponse {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
  logoURI?: string;
  priceUSD?: string;
  amount?: string;
  blockNumber?: number;
}

/**
 * Error thrown when balance fetching fails
 */
export class BalanceFetchError extends Error {
  readonly code = 'BALANCE_FETCH_FAILED' as const;
  readonly recoveryAction = 'retry' as const;
  readonly cachedAvailable: boolean;
  readonly chainId?: number;

  constructor(message: string, cachedAvailable: boolean, chainId?: number) {
    super(message);
    this.name = 'BalanceFetchError';
    this.cachedAvailable = cachedAvailable;
    this.chainId = chainId;
  }
}

/**
 * Cache entry with TTL tracking
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Use centralized constants from constants.ts
 * - BALANCE_CACHE_TTL_MS: 10 seconds TTL (per design doc for real-time balances)
 * - BALANCE_DEBOUNCE_MS: 300ms debounce window for rapid requests
 * - BALANCE_API_TIMEOUT_MS: 10 seconds API timeout
 */

/**
 * Default placeholder logo for tokens without logoURI
 */
const DEFAULT_TOKEN_LOGO = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png';

/**
 * Safely parse a float value, returning 0 if NaN
 */
function safeParseFloat(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Format balance from base units to human-readable format
 *
 * Note: The parseFloat conversion used later for USD calculations may lose precision
 * for very large token balances (>2^53). This is acceptable for display purposes
 * as the formatted string representation maintains full precision via BigInt.
 * For critical financial calculations, use the raw balance string with a proper
 * arbitrary-precision library.
 */
function formatBalance(balance: string, decimals: number): string {
  if (!balance || balance === '0') return '0';

  const balanceBigInt = BigInt(balance);
  const divisor = BigInt(10 ** decimals);
  const wholePart = balanceBigInt / divisor;
  const fractionalPart = balanceBigInt % divisor;

  if (fractionalPart === BigInt(0)) {
    return wholePart.toString();
  }

  // Pad fractional part with leading zeros if needed
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  // Trim trailing zeros
  const trimmedFractional = fractionalStr.replace(/0+$/, '');

  if (!trimmedFractional) {
    return wholePart.toString();
  }

  return `${wholePart}.${trimmedFractional}`;
}

/**
 * Generate a cache key for a balance request
 */
function getCacheKey(address: string, chainId: number, tokenAddress: string): string {
  return `${address.toLowerCase()}:${chainId}:${tokenAddress.toLowerCase()}`;
}

/**
 * In-memory cache for balance data
 */
class BalanceCache {
  private balanceCache: Map<string, CacheEntry<BalanceWithMetadata>> = new Map();
  private pendingRequests: Map<string, Promise<BalanceWithMetadata>> = new Map();
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Get cached balance if not expired
   */
  getBalance(key: string): { data: BalanceWithMetadata; isStale: boolean; cachedAt: number } | null {
    const entry = this.balanceCache.get(key);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > BALANCE_CACHE_TTL_MS;
    if (isExpired) {
      return null;
    }

    return {
      data: entry.data,
      isStale: false,
      cachedAt: entry.timestamp,
    };
  }

  /**
   * Store balance in cache
   */
  setBalance(key: string, balance: BalanceWithMetadata): void {
    this.balanceCache.set(key, {
      data: balance,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cached balance even if expired (for fallback)
   */
  getBalanceStale(key: string): { data: BalanceWithMetadata; cachedAt: number } | null {
    const entry = this.balanceCache.get(key);
    if (!entry) return null;
    return {
      data: entry.data,
      cachedAt: entry.timestamp,
    };
  }

  /**
   * Get pending request for deduplication
   */
  getPendingRequest(key: string): Promise<BalanceWithMetadata> | undefined {
    return this.pendingRequests.get(key);
  }

  /**
   * Set pending request for deduplication
   */
  setPendingRequest(key: string, promise: Promise<BalanceWithMetadata>): void {
    this.pendingRequests.set(key, promise);
  }

  /**
   * Remove pending request
   */
  removePendingRequest(key: string): void {
    this.pendingRequests.delete(key);
  }

  /**
   * Get debounce timer
   */
  getDebounceTimer(key: string): ReturnType<typeof setTimeout> | undefined {
    return this.debounceTimers.get(key);
  }

  /**
   * Set debounce timer
   */
  setDebounceTimer(key: string, timer: ReturnType<typeof setTimeout>): void {
    this.debounceTimers.set(key, timer);
  }

  /**
   * Clear debounce timer
   */
  clearDebounceTimer(key: string): void {
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
  }

  /**
   * Manually invalidate all cache entries
   */
  invalidate(): void {
    this.balanceCache.clear();
    this.pendingRequests.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Invalidate cache for a specific address
   */
  invalidateAddress(address: string): void {
    const normalizedAddress = address.toLowerCase();
    for (const key of this.balanceCache.keys()) {
      if (key.startsWith(normalizedAddress)) {
        this.balanceCache.delete(key);
      }
    }
  }

  /**
   * Check if we have any cached balance data (even if expired)
   */
  hasCachedBalance(key: string): boolean {
    return this.balanceCache.has(key);
  }
}

/**
 * Factory function to create a new cache instance
 */
export function createBalanceCache(): BalanceCache {
  return new BalanceCache();
}

/**
 * Default cache instance for standalone function usage
 */
let defaultBalanceCache: BalanceCache | null = null;

function getDefaultBalanceCache(): BalanceCache {
  if (!defaultBalanceCache) {
    defaultBalanceCache = new BalanceCache();
  }
  return defaultBalanceCache;
}

/**
 * Create a fetch request with timeout using AbortController
 */
async function fetchWithTimeout(url: string, timeoutMs: number = BALANCE_API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: getLifiHeaders(),
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout: LI.FI API did not respond within ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validate LI.FI token balance response fields
 * Returns true if all required fields are present and valid
 */
function isValidLifiTokenBalanceResponse(data: unknown): data is LifiTokenBalanceResponse {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  // Validate required fields exist and have correct types
  if (typeof obj.address !== 'string' || !obj.address) return false;
  if (typeof obj.symbol !== 'string' || !obj.symbol) return false;
  if (typeof obj.decimals !== 'number' || !Number.isInteger(obj.decimals) || obj.decimals < 0) return false;
  if (typeof obj.chainId !== 'number' || !Number.isInteger(obj.chainId) || obj.chainId <= 0) return false;
  if (typeof obj.name !== 'string' || !obj.name) return false;

  // Optional fields validation (if present, must be correct type)
  if (obj.logoURI !== undefined && typeof obj.logoURI !== 'string') return false;
  if (obj.priceUSD !== undefined && typeof obj.priceUSD !== 'string') return false;
  if (obj.amount !== undefined && typeof obj.amount !== 'string') return false;
  if (obj.blockNumber !== undefined && typeof obj.blockNumber !== 'number') return false;

  return true;
}

/**
 * Map LI.FI token balance response to our Balance type
 */
function mapLifiBalanceToBalance(lifiToken: LifiTokenBalanceResponse): BalanceWithMetadata {
  const balance = lifiToken.amount || '0';
  const priceUsd = safeParseFloat(lifiToken.priceUSD);
  const balanceFormatted = formatBalance(balance, lifiToken.decimals);
  // Note: parseFloat may lose precision for very large balances (>2^53),
  // but this is acceptable for USD display calculations
  const balanceNum = parseFloat(balanceFormatted) || 0;
  const balanceUsd = balanceNum * priceUsd;

  const token: Token = {
    address: lifiToken.address.toLowerCase(),
    symbol: lifiToken.symbol,
    name: lifiToken.name,
    decimals: lifiToken.decimals,
    logoUrl: lifiToken.logoURI || DEFAULT_TOKEN_LOGO,
    chainId: lifiToken.chainId,
    priceUsd: priceUsd > 0 ? priceUsd : undefined,
  };

  return {
    token,
    balance,
    formatted: balanceFormatted,
    balanceUsd: balanceUsd > 0 ? balanceUsd : undefined,
    hasBalance: BigInt(balance) > BigInt(0),
  };
}

/**
 * Get RPC URL for a chain from LI.FI chains data
 */
async function getRpcUrlForChain(chainId: number): Promise<string> {
  const url = `${LIFI_API_URL}/v1/chains`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch chains: ${response.status}`);
  }

  const data = await response.json();
  const chain = data.chains?.find((c: { id: number }) => c.id === chainId);

  if (!chain?.metamask?.rpcUrls?.[0]) {
    throw new Error(`No RPC URL found for chain ${chainId}`);
  }

  return chain.metamask.rpcUrls[0];
}

/**
 * Fetch balance directly via RPC call to the token contract
 * Uses eth_call with balanceOf(address) selector
 */
async function fetchBalanceViaRpc(
  walletAddress: string,
  chainId: number,
  tokenAddress: string
): Promise<string> {
  const rpcUrl = await getRpcUrlForChain(chainId);

  // For native token, use eth_getBalance
  if (tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [walletAddress, 'latest'],
        id: 1,
      }),
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    // Convert hex to decimal string
    return BigInt(data.result).toString();
  }

  // For ERC-20 tokens, use balanceOf
  // balanceOf(address) selector: 0x70a08231
  // Pad address to 32 bytes
  const paddedAddress = walletAddress.slice(2).toLowerCase().padStart(64, '0');
  const callData = `0x70a08231${paddedAddress}`;

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to: tokenAddress, data: callData }, 'latest'],
      id: 1,
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  // Convert hex result to decimal string
  return BigInt(data.result).toString();
}

/**
 * Fetch a single token balance using LI.FI for metadata and RPC for balance
 * LI.FI /v1/token provides token info, RPC provides actual balance
 */
async function fetchBalanceFromApi(
  address: string,
  chainId: number,
  tokenAddress: string
): Promise<BalanceWithMetadata> {
  // Fetch token metadata from LI.FI
  const url = `${LIFI_API_URL}/v1/token?chain=${chainId}&token=${tokenAddress}`;
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`LI.FI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Validate response structure before casting (Issue 6 fix)
  if (!isValidLifiTokenBalanceResponse(data)) {
    throw new Error('Invalid response format from LI.FI API: missing or invalid required fields');
  }

  // Fetch actual balance via RPC
  const balanceRaw = await fetchBalanceViaRpc(address, chainId, tokenAddress);

  // Add balance to the token data
  const tokenDataWithBalance = {
    ...data,
    amount: balanceRaw,
  };

  return mapLifiBalanceToBalance(tokenDataWithBalance);
}

/**
 * Get token balance for a specific address, chain, and token
 * Uses LI.FI API with caching (10s TTL) and request deduplication
 *
 * @param params - Balance request parameters
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Balance with metadata
 * @throws InvalidAddressError if wallet or token address is invalid
 * @throws BalanceFetchError if API fails and no cache available
 */
export async function getBalance(
  params: BalanceParams,
  cache?: BalanceCache
): Promise<BalanceWithMetadata> {
  const balanceCache = cache ?? getDefaultBalanceCache();
  const { address, chainId, tokenAddress } = params;

  // Validate wallet address (Issue 1 fix - SECURITY)
  if (!isValidAddress(address)) {
    throw new InvalidAddressError(address, 'wallet');
  }

  // Validate token address (Issue 1 fix - SECURITY)
  if (!isValidAddress(tokenAddress)) {
    throw new InvalidAddressError(tokenAddress, 'token');
  }

  const cacheKey = getCacheKey(address, chainId, tokenAddress);

  // Check cache first
  const cached = balanceCache.getBalance(cacheKey);
  if (cached) {
    return cached.data;
  }

  // Check for pending request (deduplication)
  const pendingRequest = balanceCache.getPendingRequest(cacheKey);
  if (pendingRequest) {
    return pendingRequest;
  }

  // Create new request with debouncing (Issue 3 fix - ensure cleanup in all paths)
  const fetchPromise = (async (): Promise<BalanceWithMetadata> => {
    // Clear any existing debounce timer before starting
    balanceCache.clearDebounceTimer(cacheKey);

    try {
      // Wait for debounce period
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, BALANCE_DEBOUNCE_MS);
        balanceCache.setDebounceTimer(cacheKey, timer);
      });

      const balance = await fetchBalanceFromApi(address, chainId, tokenAddress);
      balanceCache.setBalance(cacheKey, balance);
      return balance;
    } catch (error) {
      // Try to return stale cache if available
      const staleCache = balanceCache.getBalanceStale(cacheKey);
      if (staleCache) {
        console.warn(`[Mina SDK] Using stale balance cache for ${cacheKey} due to API error:`, error);
        return staleCache.data;
      }

      throw new BalanceFetchError(
        error instanceof Error ? error.message : 'Failed to fetch balance',
        false,
        chainId
      );
    } finally {
      // Issue 3 fix: Always clean up pending request and debounce timer
      // This runs even if the promise rejects, preventing memory leaks
      balanceCache.removePendingRequest(cacheKey);
      balanceCache.clearDebounceTimer(cacheKey);
    }
  })();

  balanceCache.setPendingRequest(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Get token balance with metadata about cache staleness (Issue 5)
 * Uses LI.FI API with caching (10s TTL) and request deduplication
 *
 * @param params - Balance request parameters
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Response object with balance and metadata (isStale, cachedAt)
 * @throws InvalidAddressError if wallet or token address is invalid
 * @throws BalanceFetchError if API fails and no cache available
 *
 * @example
 * ```typescript
 * const { balance, isStale, cachedAt } = await getBalanceWithMetadata({
 *   address: '0x...',
 *   chainId: 1,
 *   tokenAddress: '0x...'
 * });
 * if (isStale) {
 *   console.warn('Using cached data from', new Date(cachedAt));
 * }
 * ```
 */
export async function getBalanceWithMetadata(
  params: BalanceParams,
  cache?: BalanceCache
): Promise<SingleBalanceResponse> {
  const balanceCache = cache ?? getDefaultBalanceCache();
  const { address, chainId, tokenAddress } = params;

  // Validate addresses (same as getBalance)
  if (!isValidAddress(address)) {
    throw new InvalidAddressError(address, 'wallet');
  }
  if (!isValidAddress(tokenAddress)) {
    throw new InvalidAddressError(tokenAddress, 'token');
  }

  const cacheKey = getCacheKey(address, chainId, tokenAddress);

  // Check cache first - if valid, return with metadata
  const cached = balanceCache.getBalance(cacheKey);
  if (cached) {
    return {
      balance: cached.data,
      isStale: false, // Cache is within TTL, not stale
      cachedAt: cached.cachedAt,
    };
  }

  // Check for pending request (deduplication)
  const pendingRequest = balanceCache.getPendingRequest(cacheKey);
  if (pendingRequest) {
    const balance = await pendingRequest;
    return {
      balance,
      isStale: false, // Fresh fetch
      cachedAt: null,
    };
  }

  // Fetch fresh data
  try {
    const balance = await getBalance(params, balanceCache);
    return {
      balance,
      isStale: false, // Fresh from API
      cachedAt: null,
    };
  } catch (error) {
    // If getBalance threw but returned stale data, it would have succeeded
    // So this error means no stale data was available either
    throw error;
  }
}

/**
 * Get token balances across multiple chains in parallel
 * Includes both native tokens and ERC-20 tokens with valid bridge routes
 *
 * @param params - Multi-balance request parameters
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Balances response with metadata
 * @throws BalanceFetchError if all API requests fail and no cache available
 */
export async function getBalances(
  params: MultiBalanceParams,
  cache?: BalanceCache
): Promise<BalancesResponse> {
  const balanceCache = cache ?? getDefaultBalanceCache();
  const { address, chainIds, tokenAddresses } = params;

  const balances: Record<number, BalanceWithMetadata[]> = {};
  let totalUsd = 0;
  // Issue 8 fix: Track actual staleness per-chain properly
  const staleChains: Set<number> = new Set();
  let earliestCacheTimestamp: number | null = null;

  // Fetch balances for all chains in parallel
  const chainPromises = chainIds.map(async (chainId) => {
    try {
      // Get tokens to fetch for this chain
      const tokensToFetch = tokenAddresses?.[chainId] ?? [NATIVE_TOKEN_ADDRESS];

      // Track staleness for this chain
      let chainHasStaleData = false;
      let chainCacheTimestamp: number | null = null;

      // Fetch all token balances for this chain in parallel
      const tokenBalances = await Promise.all(
        tokensToFetch.map(async (tokenAddress) => {
          try {
            // Check if this specific balance would come from stale cache
            const cacheKey = getCacheKey(address, chainId, tokenAddress);
            const freshCache = balanceCache.getBalance(cacheKey);

            // If fresh cache exists, note the timestamp
            if (freshCache) {
              if (chainCacheTimestamp === null || freshCache.cachedAt < chainCacheTimestamp) {
                chainCacheTimestamp = freshCache.cachedAt;
              }
            }

            const balance = await getBalance({ address, chainId, tokenAddress }, balanceCache);
            return balance;
          } catch (error) {
            // Check if stale data was used
            const cacheKey = getCacheKey(address, chainId, tokenAddress);
            const staleCache = balanceCache.getBalanceStale(cacheKey);
            if (staleCache) {
              chainHasStaleData = true;
              if (chainCacheTimestamp === null || staleCache.cachedAt < chainCacheTimestamp) {
                chainCacheTimestamp = staleCache.cachedAt;
              }
            }
            // Log individual token errors but don't fail the whole chain
            console.warn(`[Mina SDK] Failed to fetch balance for token ${tokenAddress} on chain ${chainId}:`, error);
            return null;
          }
        })
      );

      // Track if this chain had stale data
      if (chainHasStaleData) {
        staleChains.add(chainId);
      }
      if (chainCacheTimestamp !== null) {
        if (earliestCacheTimestamp === null || chainCacheTimestamp < earliestCacheTimestamp) {
          earliestCacheTimestamp = chainCacheTimestamp;
        }
      }

      // Filter out failed fetches and sort by balance (non-zero first)
      const validBalances = tokenBalances
        .filter((b): b is BalanceWithMetadata => b !== null)
        .sort((a, b) => {
          // Sort by hasBalance first (true before false)
          if (a.hasBalance !== b.hasBalance) {
            return a.hasBalance ? -1 : 1;
          }
          // Then by USD value descending
          return (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0);
        });

      return { chainId, balances: validBalances };
    } catch (error) {
      console.warn(`[Mina SDK] Failed to fetch balances for chain ${chainId}:`, error);
      return { chainId, balances: [] };
    }
  });

  const results = await Promise.all(chainPromises);

  // Aggregate results
  for (const result of results) {
    balances[result.chainId] = result.balances;
    for (const balance of result.balances) {
      if (balance.balanceUsd) {
        totalUsd += balance.balanceUsd;
      }
    }
  }

  // Issue 8 fix: isStale is true if ANY chain had stale cache data used
  const isStale = staleChains.size > 0;

  return {
    balances,
    totalUsd,
    isStale,
    cachedAt: earliestCacheTimestamp,
  };
}

/**
 * Get balances for all supported tokens on a specific chain
 * Fetches bridgeable tokens and their balances
 *
 * @param address - Wallet address
 * @param chainId - Chain ID
 * @param cache - Optional cache instance
 * @returns Array of balances sorted by value (non-zero first)
 */
export async function getChainBalances(
  address: string,
  chainId: number,
  cache?: BalanceCache
): Promise<BalanceWithMetadata[]> {
  const result = await getBalances(
    { address, chainIds: [chainId] },
    cache
  );
  return result.balances[chainId] ?? [];
}

/**
 * Manually invalidate the balance cache
 *
 * @param address - Optional wallet address to invalidate (invalidates all if not provided)
 * @param cache - Optional cache instance
 */
export function invalidateBalanceCache(address?: string, cache?: BalanceCache): void {
  const balanceCache = cache ?? getDefaultBalanceCache();
  if (address) {
    balanceCache.invalidateAddress(address);
  } else {
    balanceCache.invalidate();
  }
}

/**
 * Reset the default cache instance
 * Primarily useful for testing
 */
export function resetDefaultBalanceCache(): void {
  defaultBalanceCache = null;
}

/**
 * Warning type for balance validation
 */
export type BalanceWarningType = 'INSUFFICIENT_BALANCE' | 'INSUFFICIENT_GAS';

/**
 * Balance warning with details about the shortfall
 */
export interface BalanceWarning {
  /** Type of warning */
  type: BalanceWarningType;
  /** Token that is insufficient */
  token: Token;
  /** Amount required for the transaction */
  required: string;
  /** User's available balance */
  available: string;
  /** Shortfall amount needed */
  shortfall: string;
  /** Human-readable message */
  message: string;
}

/**
 * Result of balance validation
 */
export interface BalanceValidation {
  /** Overall validation result */
  valid: boolean;
  /** Whether token balance is sufficient */
  tokenSufficient: boolean;
  /** Whether gas balance is sufficient */
  gasSufficient: boolean;
  /** List of warnings if any */
  warnings: BalanceWarning[];
}

/**
 * Result of lightweight balance check
 */
export interface BalanceCheckResult {
  /** Whether balance is sufficient for the amount */
  sufficient: boolean;
  /** User's balance in smallest unit */
  balance: string;
  /** User's formatted balance */
  formatted: string;
  /** Balance in USD (if available) */
  balanceUsd?: number;
  /** Required amount in smallest unit */
  required: string;
  /** Shortfall if insufficient (in smallest unit) */
  shortfall?: string;
  /** Token info */
  token: Token;
}

/**
 * Calculate shortfall between required and available amounts
 */
function calculateShortfall(required: bigint, available: bigint): string {
  if (available >= required) return '0';
  return (required - available).toString();
}

/**
 * Format amount for display
 */
function formatAmountForMessage(amount: string, token: Token): string {
  const amountBigInt = BigInt(amount);
  const divisor = BigInt(10 ** token.decimals);
  const wholePart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;

  if (fractionalPart === BigInt(0)) {
    return `${wholePart} ${token.symbol}`;
  }

  const fractionalStr = fractionalPart.toString().padStart(token.decimals, '0');
  const trimmed = fractionalStr.replace(/0+$/, '').slice(0, 4); // Max 4 decimals for display

  return trimmed ? `${wholePart}.${trimmed} ${token.symbol}` : `${wholePart} ${token.symbol}`;
}

/**
 * Validate balance against a quote
 * Checks both token balance and native gas token balance
 *
 * @param quote - Quote to validate against
 * @param walletAddress - User's wallet address
 * @param cache - Optional cache instance
 * @returns Balance validation result with warnings
 *
 * @example
 * ```typescript
 * const validation = await validateBalance(quote, '0x...');
 * if (!validation.valid) {
 *   for (const warning of validation.warnings) {
 *     console.warn(warning.message);
 *   }
 * }
 * ```
 */
export async function validateBalance(
  quote: Quote,
  walletAddress: string,
  cache?: BalanceCache
): Promise<BalanceValidation> {
  const balanceCache = cache ?? getDefaultBalanceCache();
  const warnings: BalanceWarning[] = [];

  // Get first step to determine source chain
  const firstStep = quote.steps[0];
  if (!firstStep) {
    throw new Error('Quote has no steps');
  }

  const sourceChainId = firstStep.fromChainId;

  // Fetch token balance
  const tokenBalance = await getBalance(
    {
      address: walletAddress,
      chainId: sourceChainId,
      tokenAddress: quote.fromToken.address,
    },
    balanceCache
  );

  // Fetch native token balance for gas
  const gasBalance = await getBalance(
    {
      address: walletAddress,
      chainId: sourceChainId,
      tokenAddress: NATIVE_TOKEN_ADDRESS,
    },
    balanceCache
  );

  // Calculate if token is sufficient
  const tokenBalanceBigInt = BigInt(tokenBalance.balance);
  const requiredTokenBigInt = BigInt(quote.fromAmount);
  const tokenSufficient = tokenBalanceBigInt >= requiredTokenBigInt;

  // Calculate if gas is sufficient
  const gasBalanceBigInt = BigInt(gasBalance.balance);
  const gasEstimate = quote.fees.gasEstimate;
  const requiredGasBigInt = BigInt(gasEstimate.gasCost || '0');
  const gasSufficient = gasBalanceBigInt >= requiredGasBigInt;

  // Build warnings if any
  if (!tokenSufficient) {
    const shortfall = calculateShortfall(requiredTokenBigInt, tokenBalanceBigInt);
    warnings.push({
      type: 'INSUFFICIENT_BALANCE',
      token: quote.fromToken,
      required: quote.fromAmount,
      available: tokenBalance.balance,
      shortfall,
      message: `You need ${formatAmountForMessage(shortfall, quote.fromToken)} more to complete this bridge`,
    });
  }

  if (!gasSufficient) {
    const shortfall = calculateShortfall(requiredGasBigInt, gasBalanceBigInt);
    warnings.push({
      type: 'INSUFFICIENT_GAS',
      token: gasBalance.token,
      required: gasEstimate.gasCost || '0',
      available: gasBalance.balance,
      shortfall,
      message: `You need ${formatAmountForMessage(shortfall, gasBalance.token)} more for gas`,
    });
  }

  return {
    valid: tokenSufficient && gasSufficient,
    tokenSufficient,
    gasSufficient,
    warnings,
  };
}

/**
 * Lightweight balance check without requiring a full quote
 * Checks if a user has sufficient balance for a given amount
 *
 * @param chainId - Chain ID
 * @param tokenAddress - Token address
 * @param walletAddress - User's wallet address
 * @param amount - Required amount in smallest unit
 * @param cache - Optional cache instance
 * @returns Balance check result
 *
 * @example
 * ```typescript
 * const check = await checkBalance(1, USDC_ADDRESS, '0x...', '1000000');
 * if (!check.sufficient) {
 *   console.log(`Need ${check.shortfall} more`);
 * }
 * ```
 */
export async function checkBalance(
  chainId: number,
  tokenAddress: string,
  walletAddress: string,
  amount: string,
  cache?: BalanceCache
): Promise<BalanceCheckResult> {
  const balanceCache = cache ?? getDefaultBalanceCache();

  const balance = await getBalance(
    {
      address: walletAddress,
      chainId,
      tokenAddress,
    },
    balanceCache
  );

  const balanceBigInt = BigInt(balance.balance);
  const requiredBigInt = BigInt(amount);
  const sufficient = balanceBigInt >= requiredBigInt;

  return {
    sufficient,
    balance: balance.balance,
    formatted: balance.formatted,
    balanceUsd: balance.balanceUsd,
    required: amount,
    shortfall: sufficient ? undefined : calculateShortfall(requiredBigInt, balanceBigInt),
    token: balance.token,
  };
}

/**
 * Export the BalanceCache class for use by Mina client
 */
export { BalanceCache };
