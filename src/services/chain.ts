/**
 * Chain Discovery Service
 * Fetches and caches supported chains from LI.FI API
 */

import type { Chain, Token } from '../types';
import { HYPEREVM_CHAIN_ID, LIFI_API_URL, NATIVE_TOKEN_ADDRESS, CHAIN_API_TIMEOUT_MS } from '../constants';

/**
 * LI.FI API Chain response types
 */
interface LifiNativeToken {
  address: string;
  decimals: number;
  symbol: string;
  chainId: number;
  coinKey: string;
  name: string;
  logoURI: string;
  priceUSD?: string;
}

interface LifiChain {
  key: string;
  name: string;
  chainType: string;
  coin: string;
  id: number;
  mainnet: boolean;
  logoURI: string;
  nativeToken: LifiNativeToken;
}

interface LifiChainsResponse {
  chains: LifiChain[];
}

/**
 * Error thrown when chain fetching fails
 */
export class ChainFetchError extends Error {
  readonly code = 'CHAIN_FETCH_FAILED' as const;
  readonly recoveryAction = 'retry' as const;
  readonly cachedAvailable: boolean;

  constructor(message: string, cachedAvailable: boolean) {
    super(message);
    this.name = 'ChainFetchError';
    this.cachedAvailable = cachedAvailable;
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
 * Chain cache configuration
 */
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * API request timeout in milliseconds - using centralized constant
 */
const API_TIMEOUT_MS = CHAIN_API_TIMEOUT_MS;

/**
 * High-resolution Hyperliquid logo URL
 * Using the official brand asset from assets subdomain
 */
const HYPERLIQUID_LOGO_URL = 'https://app.hyperliquid.xyz/icons/hyperliquid-logo.svg';

/**
 * Response with metadata for chain queries
 */
export interface ChainsResponse {
  /** Array of chain data */
  chains: Chain[];
  /** Whether the data is from stale cache */
  isStale: boolean;
  /** Timestamp when data was cached (null if fresh from API) */
  cachedAt: number | null;
}

/**
 * In-memory cache for chain data
 */
class ChainCache {
  private chainsCache: CacheEntry<Chain[]> | null = null;
  private connectionCache: Map<string, CacheEntry<number[]>> = new Map();

  /**
   * Get cached chains if not expired
   */
  getChains(): { data: Chain[]; isStale: boolean; cachedAt: number } | null {
    if (!this.chainsCache) return null;

    const isExpired = Date.now() - this.chainsCache.timestamp > CACHE_TTL_MS;
    if (isExpired) {
      return null;
    }

    return {
      data: this.chainsCache.data,
      isStale: false,
      cachedAt: this.chainsCache.timestamp,
    };
  }

  /**
   * Store chains in cache
   */
  setChains(chains: Chain[]): void {
    this.chainsCache = {
      data: chains,
      timestamp: Date.now(),
    };
  }

  /**
   * Get cached chains with routes to a specific destination
   */
  getConnectionsForDestination(toChainId: number): number[] | null {
    const key = `routes_to_${toChainId}`;
    const entry = this.connectionCache.get(key);

    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > CACHE_TTL_MS;
    if (isExpired) {
      this.connectionCache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Store chain connections for a destination
   */
  setConnectionsForDestination(toChainId: number, chainIds: number[]): void {
    const key = `routes_to_${toChainId}`;
    this.connectionCache.set(key, {
      data: chainIds,
      timestamp: Date.now(),
    });
  }

  /**
   * Manually invalidate all cache entries
   */
  invalidate(): void {
    this.chainsCache = null;
    this.connectionCache.clear();
  }

  /**
   * Check if we have any cached chain data (even if expired)
   */
  hasCachedChains(): boolean {
    return this.chainsCache !== null;
  }

  /**
   * Get cached chains even if expired (for fallback)
   */
  getChainsStale(): { data: Chain[]; cachedAt: number } | null {
    if (!this.chainsCache) return null;
    return {
      data: this.chainsCache.data,
      cachedAt: this.chainsCache.timestamp,
    };
  }
}

/**
 * Factory function to create a new cache instance
 * This allows each Mina client to have its own cache if needed
 */
export function createChainCache(): ChainCache {
  return new ChainCache();
}

/**
 * Default cache instance for standalone function usage
 * NOTE: This is shared across all users of the standalone functions.
 * For isolated caching, use the Mina client which manages its own cache.
 */
let defaultCache: ChainCache | null = null;

function getDefaultCache(): ChainCache {
  if (!defaultCache) {
    defaultCache = new ChainCache();
  }
  return defaultCache;
}

/**
 * HyperEVM chain data (hardcoded as it's our primary destination)
 */
const HYPEREVM_CHAIN: Chain = {
  id: HYPEREVM_CHAIN_ID,
  key: 'hyperevm',
  name: 'HyperEVM',
  logoUrl: HYPERLIQUID_LOGO_URL,
  nativeToken: {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: 'HYPE',
    name: 'HYPE',
    decimals: 18,
    logoUrl: HYPERLIQUID_LOGO_URL,
    chainId: HYPEREVM_CHAIN_ID,
  },
  isEvm: true,
};

/**
 * Map LI.FI chain response to our Chain type
 */
function mapLifiChainToChain(lifiChain: LifiChain): Chain {
  const nativeToken: Token = {
    address: lifiChain.nativeToken.address,
    symbol: lifiChain.nativeToken.symbol,
    name: lifiChain.nativeToken.name,
    decimals: lifiChain.nativeToken.decimals,
    logoUrl: lifiChain.nativeToken.logoURI,
    chainId: lifiChain.id,
    priceUsd: lifiChain.nativeToken.priceUSD
      ? parseFloat(lifiChain.nativeToken.priceUSD)
      : undefined,
  };

  return {
    id: lifiChain.id,
    key: lifiChain.key,
    name: lifiChain.name,
    logoUrl: lifiChain.logoURI,
    nativeToken,
    isEvm: lifiChain.chainType === 'EVM',
  };
}

/**
 * Create a fetch request with timeout using AbortController
 * Issue 4 fix: Handle AbortError consistently with balance.ts and token.ts
 */
async function fetchWithTimeout(url: string, timeoutMs: number = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    // Handle abort errors with a descriptive timeout message (Issue 4 fix)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout: LI.FI API did not respond within ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch chains from LI.FI API
 */
async function fetchChainsFromApi(): Promise<Chain[]> {
  const response = await fetchWithTimeout(`${LIFI_API_URL}/chains`);

  if (!response.ok) {
    throw new Error(`LI.FI API error: ${response.status} ${response.statusText}`);
  }

  const data: LifiChainsResponse = await response.json();

  if (!data.chains || !Array.isArray(data.chains)) {
    throw new Error('Invalid response format from LI.FI API');
  }

  // Map LI.FI chains to our format and filter to EVM mainnet chains only
  const chains = data.chains
    .filter(chain => chain.mainnet && chain.chainType === 'EVM')
    .map(mapLifiChainToChain);

  return chains;
}

/**
 * Fetch chains with valid routes to a destination chain
 */
async function fetchChainsWithRoutesToDestination(toChainId: number): Promise<number[]> {
  const response = await fetchWithTimeout(
    `${LIFI_API_URL}/connections?toChain=${toChainId}`
  );

  if (!response.ok) {
    throw new Error(`LI.FI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Extract unique source chain IDs from connections
  const chainIds = new Set<number>();

  if (data.connections && typeof data.connections === 'object') {
    for (const fromChainId of Object.keys(data.connections)) {
      const parsedId = parseInt(fromChainId, 10);
      // Validate parsed value to avoid NaN in Set
      if (!Number.isNaN(parsedId) && parsedId > 0) {
        chainIds.add(parsedId);
      }
    }
  }

  return Array.from(chainIds);
}

/**
 * Get all supported origin chains
 * Fetches from LI.FI API with caching and fallback
 *
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Response with chains array and metadata about staleness
 * @throws ChainFetchError if API fails and no cache available
 */
export async function getChains(cache?: ChainCache): Promise<ChainsResponse> {
  const chainCache = cache ?? getDefaultCache();

  // Check cache first
  const cached = chainCache.getChains();
  if (cached) {
    return {
      chains: cached.data,
      isStale: false,
      cachedAt: cached.cachedAt,
    };
  }

  try {
    const chains = await fetchChainsFromApi();
    chainCache.setChains(chains);
    return {
      chains,
      isStale: false,
      cachedAt: null, // Fresh from API
    };
  } catch (error) {
    // Try to return stale cache if available
    const staleCache = chainCache.getChainsStale();
    if (staleCache) {
      console.warn('[Mina SDK] Using stale chain cache due to API error:', error);
      return {
        chains: staleCache.data,
        isStale: true,
        cachedAt: staleCache.cachedAt,
      };
    }

    // No cache available, throw error
    throw new ChainFetchError(
      error instanceof Error ? error.message : 'Failed to fetch chains',
      false
    );
  }
}

/**
 * Get destination chains (currently only HyperEVM)
 *
 * @returns Array containing HyperEVM chain
 */
export function getDestinationChains(): Chain[] {
  return [HYPEREVM_CHAIN];
}

/**
 * Get chains that have valid bridge routes to a specific destination
 *
 * @param toChainId - Destination chain ID (defaults to HyperEVM)
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Array of chains with valid routes to destination
 * @throws ChainFetchError if API fails and no cache available
 */
export async function getChainsByRoutes(
  toChainId: number = HYPEREVM_CHAIN_ID,
  cache?: ChainCache
): Promise<Chain[]> {
  const chainCache = cache ?? getDefaultCache();

  // Get all chains first
  const { chains: allChains } = await getChains(chainCache);

  // Check route cache
  const cachedRouteChainIds = chainCache.getConnectionsForDestination(toChainId);

  if (cachedRouteChainIds) {
    // Use Set for O(1) lookup instead of Array.includes() which is O(n)
    const routeChainIdSet = new Set(cachedRouteChainIds);
    return allChains.filter(chain => routeChainIdSet.has(chain.id));
  }

  try {
    const chainIdsWithRoutes = await fetchChainsWithRoutesToDestination(toChainId);
    chainCache.setConnectionsForDestination(toChainId, chainIdsWithRoutes);

    // Use Set for O(1) lookup instead of Array.includes() which is O(n)
    const routeChainIdSet = new Set(chainIdsWithRoutes);
    return allChains.filter(chain => routeChainIdSet.has(chain.id));
  } catch (error) {
    // If we can't fetch routes, return all chains as fallback
    console.warn('[Mina SDK] Failed to fetch chain routes, returning all chains:', error);
    return allChains;
  }
}

/**
 * Get a specific chain by ID
 *
 * @param chainId - Chain ID to find
 * @param cache - Optional cache instance (uses default if not provided)
 * @returns Chain if found, undefined otherwise
 */
export async function getChainById(
  chainId: number,
  cache?: ChainCache
): Promise<Chain | undefined> {
  // Check if it's the HyperEVM destination chain
  if (chainId === HYPEREVM_CHAIN_ID) {
    return HYPEREVM_CHAIN;
  }

  const { chains } = await getChains(cache);
  return chains.find(chain => chain.id === chainId);
}

/**
 * Manually invalidate the chain cache
 * Useful for forcing a refresh of chain data
 *
 * @param cache - Optional cache instance (uses default if not provided)
 */
export function invalidateChainCache(cache?: ChainCache): void {
  const chainCache = cache ?? getDefaultCache();
  chainCache.invalidate();
}

/**
 * Reset the default cache instance
 * Primarily useful for testing
 */
export function resetDefaultCache(): void {
  defaultCache = null;
}

/**
 * Export the HyperEVM chain constant for direct access
 */
export { HYPEREVM_CHAIN };

/**
 * Export the ChainCache class for use by Mina client
 */
export { ChainCache };
