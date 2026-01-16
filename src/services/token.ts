/**
 * Token Discovery Service
 * Fetches and caches supported tokens from LI.FI API
 * Filters tokens to only those with valid bridge routes to HyperEVM
 */

import type { Token } from '../types';
import {
  HYPEREVM_CHAIN_ID,
  LIFI_API_URL,
  NATIVE_TOKEN_ADDRESS,
  HYPEREVM_USDC_ADDRESS,
  TOKEN_API_TIMEOUT_MS,
} from '../constants';

/**
 * LI.FI API Token response types
 */
interface LifiToken {
  address: string;
  symbol: string;
  decimals: number;
  chainId: number;
  name: string;
  coinKey?: string;
  logoURI?: string;
  priceUSD?: string;
}

interface LifiTokensResponse {
  tokens: Record<string, LifiToken[]>;
}

/**
 * LI.FI API Connection entry - represents a bridge route
 */
interface LifiConnection {
  fromChainId: number;
  toChainId: number;
  fromTokens: LifiToken[];
  toTokens: LifiToken[];
}

interface LifiConnectionsResponse {
  connections: LifiConnection[];
}

/**
 * Error thrown when token fetching fails
 */
export class TokenFetchError extends Error {
  readonly code = 'TOKEN_FETCH_FAILED' as const;
  readonly recoveryAction = 'retry' as const;
  readonly cachedAvailable: boolean;
  readonly chainId?: number;

  constructor(message: string, cachedAvailable: boolean, chainId?: number) {
    super(message);
    this.name = 'TokenFetchError';
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
 * Token cache configuration - 15 minutes TTL (tokens change more than chains)
 */
const TOKEN_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * API request timeout in milliseconds - using centralized constant
 */
const API_TIMEOUT_MS = TOKEN_API_TIMEOUT_MS;

/**
 * High-resolution Hyperliquid logo URL
 */
const HYPERLIQUID_LOGO_URL = 'https://app.hyperliquid.xyz/icons/hyperliquid-logo.svg';

/**
 * Default placeholder logo for tokens without logoURI
 */
const DEFAULT_TOKEN_LOGO = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png';

/**
 * Response with metadata for token queries
 */
export interface TokensResponse {
  /** Array of token data */
  tokens: Token[];
  /** Whether the data is from stale cache */
  isStale: boolean;
  /** Timestamp when data was cached (null if fresh from API) */
  cachedAt: number | null;
}

/**
 * HyperEVM destination tokens (hardcoded as these are verified addresses)
 * Note: Addresses are normalized to lowercase for consistent comparison
 */
const HYPEREVM_DESTINATION_TOKENS: Token[] = [
  {
    address: HYPEREVM_USDC_ADDRESS.toLowerCase(),
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUrl: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
    chainId: HYPEREVM_CHAIN_ID,
    priceUsd: 1.0, // Stablecoin
  },
  {
    address: NATIVE_TOKEN_ADDRESS.toLowerCase(),
    symbol: 'HYPE',
    name: 'HYPE',
    decimals: 18,
    logoUrl: HYPERLIQUID_LOGO_URL,
    chainId: HYPEREVM_CHAIN_ID,
    // priceUsd fetched dynamically if needed
  },
];

/**
 * In-memory cache for token data
 */
class TokenCache {
  private tokensCache: Map<number, CacheEntry<Token[]>> = new Map();
  private bridgeableTokensCache: Map<number, CacheEntry<Token[]>> = new Map();

  /**
   * Get cached tokens for a chain if not expired
   */
  getTokens(chainId: number): { data: Token[]; isStale: boolean; cachedAt: number } | null {
    const entry = this.tokensCache.get(chainId);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > TOKEN_CACHE_TTL_MS;
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
   * Store tokens in cache for a chain
   */
  setTokens(chainId: number, tokens: Token[]): void {
    this.tokensCache.set(chainId, {
      data: tokens,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cached bridgeable tokens (filtered by routes to HyperEVM)
   */
  getBridgeableTokens(chainId: number): { data: Token[]; isStale: boolean; cachedAt: number } | null {
    const entry = this.bridgeableTokensCache.get(chainId);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > TOKEN_CACHE_TTL_MS;
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
   * Store bridgeable tokens in cache
   */
  setBridgeableTokens(chainId: number, tokens: Token[]): void {
    this.bridgeableTokensCache.set(chainId, {
      data: tokens,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cached tokens even if expired (for fallback)
   */
  getTokensStale(chainId: number): { data: Token[]; cachedAt: number } | null {
    const entry = this.tokensCache.get(chainId);
    if (!entry) return null;
    return {
      data: entry.data,
      cachedAt: entry.timestamp,
    };
  }

  /**
   * Get cached bridgeable tokens even if expired (for fallback)
   */
  getBridgeableTokensStale(chainId: number): { data: Token[]; cachedAt: number } | null {
    const entry = this.bridgeableTokensCache.get(chainId);
    if (!entry) return null;
    return {
      data: entry.data,
      cachedAt: entry.timestamp,
    };
  }

  /**
   * Manually invalidate all cache entries
   */
  invalidate(): void {
    this.tokensCache.clear();
    this.bridgeableTokensCache.clear();
  }

  /**
   * Invalidate cache for a specific chain
   */
  invalidateChain(chainId: number): void {
    this.tokensCache.delete(chainId);
    this.bridgeableTokensCache.delete(chainId);
  }

  /**
   * Check if we have any cached token data for a chain (even if expired)
   */
  hasCachedTokens(chainId: number): boolean {
    return this.tokensCache.has(chainId);
  }
}

/**
 * Factory function to create a new cache instance
 */
export function createTokenCache(): TokenCache {
  return new TokenCache();
}

/**
 * Default cache instance for standalone function usage
 */
let defaultTokenCache: TokenCache | null = null;

function getDefaultTokenCache(): TokenCache {
  if (!defaultTokenCache) {
    defaultTokenCache = new TokenCache();
  }
  return defaultTokenCache;
}

/**
 * Safely parse a float value, returning undefined if NaN
 */
function safeParseFloat(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Map LI.FI token response to our Token type
 */
function mapLifiTokenToToken(lifiToken: LifiToken): Token {
  return {
    address: lifiToken.address.toLowerCase(),
    symbol: lifiToken.symbol,
    name: lifiToken.name,
    decimals: lifiToken.decimals,
    logoUrl: lifiToken.logoURI || DEFAULT_TOKEN_LOGO,
    chainId: lifiToken.chainId,
    priceUsd: lifiToken.priceUSD ? safeParseFloat(lifiToken.priceUSD) : undefined,
  };
}

/**
 * Create a fetch request with timeout using AbortController
 */
async function fetchWithTimeout(url: string, timeoutMs: number = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    // Handle abort errors with a descriptive timeout message
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout: LI.FI API did not respond within ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch all tokens for a specific chain from LI.FI API
 */
async function fetchTokensFromApi(chainId: number): Promise<Token[]> {
  const response = await fetchWithTimeout(`${LIFI_API_URL}/tokens?chains=${chainId}`);

  if (!response.ok) {
    throw new Error(`LI.FI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Validate response structure before using
  if (!data || typeof data.tokens !== 'object' || data.tokens === null) {
    // Empty tokens response is valid
    return [];
  }

  const typedData = data as LifiTokensResponse;

  // Tokens response is keyed by chain ID
  const chainTokens = typedData.tokens[chainId.toString()];
  if (!chainTokens || !Array.isArray(chainTokens)) {
    // Empty tokens for this chain is valid
    return [];
  }

  return chainTokens.map(mapLifiTokenToToken);
}

/**
 * Fetch tokens that have valid bridge routes to HyperEVM
 * Uses the connections endpoint for accurate route information
 */
async function fetchBridgeableTokensFromApi(fromChainId: number): Promise<Token[]> {
  const response = await fetchWithTimeout(
    `${LIFI_API_URL}/connections?fromChain=${fromChainId}&toChain=${HYPEREVM_CHAIN_ID}`
  );

  if (!response.ok) {
    throw new Error(`LI.FI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Validate response structure
  if (!data || !Array.isArray(data.connections)) {
    // Empty connections is valid - return empty array
    return [];
  }

  const typedData = data as LifiConnectionsResponse;

  // The connections response has fromTokens for each connection
  // Extract unique tokens that can bridge to HyperEVM
  const tokenMap = new Map<string, Token>();

  for (const connection of typedData.connections) {
    // Validate connection structure
    if (!connection || !Array.isArray(connection.fromTokens)) {
      continue;
    }

    for (const token of connection.fromTokens) {
      if (token && token.address && token.chainId === fromChainId) {
        const key = token.address.toLowerCase();
        if (!tokenMap.has(key)) {
          tokenMap.set(key, mapLifiTokenToToken(token));
        }
      }
    }
  }

  return Array.from(tokenMap.values());
}

/**
 * Get all tokens for a specific chain
 * Fetches from LI.FI API with caching (15 min TTL)
 *
 * @param chainId - Chain ID to get tokens for
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Response with tokens array and metadata about staleness
 * @throws TokenFetchError if API fails and no cache available
 */
export async function getTokens(
  chainId: number,
  cache?: TokenCache
): Promise<TokensResponse> {
  const tokenCache = cache ?? getDefaultTokenCache();

  // Check cache first
  const cached = tokenCache.getTokens(chainId);
  if (cached) {
    return {
      tokens: cached.data,
      isStale: false,
      cachedAt: cached.cachedAt,
    };
  }

  try {
    const tokens = await fetchTokensFromApi(chainId);
    tokenCache.setTokens(chainId, tokens);
    return {
      tokens,
      isStale: false,
      cachedAt: null, // Fresh from API
    };
  } catch (error) {
    // Try to return stale cache if available
    const staleCache = tokenCache.getTokensStale(chainId);
    if (staleCache) {
      console.warn(`[Mina SDK] Using stale token cache for chain ${chainId} due to API error:`, error);
      return {
        tokens: staleCache.data,
        isStale: true,
        cachedAt: staleCache.cachedAt,
      };
    }

    // No cache available, throw error
    throw new TokenFetchError(
      error instanceof Error ? error.message : 'Failed to fetch tokens',
      false,
      chainId
    );
  }
}

/**
 * Get tokens that can be bridged from a specific chain to HyperEVM
 * Only returns tokens with valid bridge routes
 *
 * @param chainId - Source chain ID
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Response with bridgeable tokens and metadata
 * @throws TokenFetchError if API fails and no cache available
 */
export async function getBridgeableTokens(
  chainId: number,
  cache?: TokenCache
): Promise<TokensResponse> {
  const tokenCache = cache ?? getDefaultTokenCache();

  // Check cache first
  const cached = tokenCache.getBridgeableTokens(chainId);
  if (cached) {
    return {
      tokens: cached.data,
      isStale: false,
      cachedAt: cached.cachedAt,
    };
  }

  try {
    const tokens = await fetchBridgeableTokensFromApi(chainId);
    tokenCache.setBridgeableTokens(chainId, tokens);
    return {
      tokens,
      isStale: false,
      cachedAt: null,
    };
  } catch (error) {
    // Try stale cache
    const staleCache = tokenCache.getBridgeableTokensStale(chainId);
    if (staleCache) {
      console.warn(`[Mina SDK] Using stale bridgeable token cache for chain ${chainId} due to API error:`, error);
      return {
        tokens: staleCache.data,
        isStale: true,
        cachedAt: staleCache.cachedAt,
      };
    }

    // Fallback: try to get all tokens and return them (less accurate but better than nothing)
    try {
      console.warn(`[Mina SDK] Connections endpoint failed, falling back to all tokens for chain ${chainId}`);
      const fallbackResponse = await getTokens(chainId, tokenCache);
      // Cache the fallback tokens as bridgeable tokens so subsequent calls benefit
      tokenCache.setBridgeableTokens(chainId, fallbackResponse.tokens);
      return fallbackResponse;
    } catch {
      throw new TokenFetchError(
        error instanceof Error ? error.message : 'Failed to fetch bridgeable tokens',
        false,
        chainId
      );
    }
  }
}

/**
 * Get destination tokens available on HyperEVM
 * Returns verified token addresses for the destination chain
 *
 * @returns Array of tokens receivable on HyperEVM
 */
export function getDestinationTokens(): Token[] {
  // Return deep copies to prevent mutation of internal token objects
  return HYPEREVM_DESTINATION_TOKENS.map(token => ({ ...token }));
}

/**
 * Get a specific token by address on a chain
 *
 * @param chainId - Chain ID
 * @param tokenAddress - Token contract address
 * @param cache - Optional cache instance
 * @returns Token if found, undefined otherwise
 */
export async function getTokenByAddress(
  chainId: number,
  tokenAddress: string,
  cache?: TokenCache
): Promise<Token | undefined> {
  // Check if it's a HyperEVM destination token
  if (chainId === HYPEREVM_CHAIN_ID) {
    const normalizedAddress = tokenAddress.toLowerCase();
    return HYPEREVM_DESTINATION_TOKENS.find(
      t => t.address.toLowerCase() === normalizedAddress
    );
  }

  const { tokens } = await getTokens(chainId, cache);
  const normalizedAddress = tokenAddress.toLowerCase();
  return tokens.find(t => t.address.toLowerCase() === normalizedAddress);
}

/**
 * Manually invalidate the token cache
 *
 * @param chainId - Optional chain ID to invalidate (invalidates all if not provided)
 * @param cache - Optional cache instance
 */
export function invalidateTokenCache(chainId?: number, cache?: TokenCache): void {
  const tokenCache = cache ?? getDefaultTokenCache();
  if (chainId !== undefined) {
    tokenCache.invalidateChain(chainId);
  } else {
    tokenCache.invalidate();
  }
}

/**
 * Reset the default cache instance
 * Primarily useful for testing
 */
export function resetDefaultTokenCache(): void {
  defaultTokenCache = null;
}

/**
 * Export the TokenCache class for use by Mina client
 */
export { TokenCache };

/**
 * Export HyperEVM destination tokens constant for direct access
 */
export { HYPEREVM_DESTINATION_TOKENS };
