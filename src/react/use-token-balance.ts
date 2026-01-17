'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMina } from './MinaProvider';
import type { BalanceWithMetadata } from '../services/balance';

/**
 * Parameters for the useTokenBalance hook
 */
export interface UseTokenBalanceParams {
  /**
   * Chain ID to fetch balance from
   * @example 1 for Ethereum, 42161 for Arbitrum, 999 for HyperEVM
   */
  chainId?: number;

  /**
   * Token contract address to fetch balance for
   * Use 'native' or the zero address (0x0000...0000) for native tokens
   * @example '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' for USDC on Ethereum
   */
  tokenAddress?: string;

  /**
   * Wallet address to fetch balance for
   * @example '0x1234567890123456789012345678901234567890'
   */
  walletAddress?: string;

  /**
   * Interval in milliseconds to automatically refresh the balance
   * Set to 0 or undefined to disable automatic refreshing
   * @default undefined (disabled)
   * @example 10000 for 10-second refresh interval
   */
  refetchInterval?: number;

  /**
   * Whether to enable fetching
   * Set to false to pause fetching without clearing the hook params
   * @default true
   */
  enabled?: boolean;
}

/**
 * Return value from the useTokenBalance hook
 */
export interface UseTokenBalanceReturn {
  /**
   * Raw balance in smallest unit (wei)
   * Returns null when loading or when params are missing
   */
  balance: string | null;

  /**
   * Human-readable formatted balance with proper decimals
   * Returns null when loading or when params are missing
   */
  formattedBalance: string | null;

  /**
   * Token decimals (e.g., 18 for ETH, 6 for USDC)
   * Returns null when loading or when params are missing
   */
  decimals: number | null;

  /**
   * Token symbol (e.g., 'ETH', 'USDC')
   * Returns null when loading or when params are missing
   */
  symbol: string | null;

  /**
   * USD value of the balance (if available from the API)
   * Returns null when loading, params missing, or USD price unavailable
   */
  balanceUsd: number | null;

  /**
   * Whether a balance fetch is currently in progress
   */
  isLoading: boolean;

  /**
   * Error that occurred during the last fetch attempt
   * Returns null if no error occurred
   */
  error: Error | null;

  /**
   * Manually trigger a balance refresh
   * Returns a promise that resolves when the fetch completes
   */
  refetch: () => Promise<void>;
}

/**
 * Format display balance with smart formatting
 * Shows appropriate precision based on value size
 * Extracted as pure function to avoid unnecessary recreations
 */
function formatDisplayBalance(formatted: string): string {
  const num = parseFloat(formatted);
  if (isNaN(num)) return formatted;
  if (num === 0) return '0';
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  if (num < 1000000) return `${(num / 1000).toFixed(2)}K`;
  return `${(num / 1000000).toFixed(2)}M`;
}

/**
 * React hook to fetch and display token balances for connected wallets
 *
 * This hook provides reactive balance tracking with automatic updates,
 * caching, and proper cleanup on unmount.
 *
 * @param params - Configuration for balance fetching
 * @returns Balance data with loading/error states and refetch function
 *
 * @example
 * ```tsx
 * // Basic usage with a specific token
 * function TokenBalanceDisplay() {
 *   const { address } = useAccount(); // From wagmi
 *
 *   const {
 *     formattedBalance,
 *     symbol,
 *     isLoading,
 *     error,
 *     refetch
 *   } = useTokenBalance({
 *     chainId: 1, // Ethereum
 *     tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 *     walletAddress: address,
 *     refetchInterval: 10000, // Refresh every 10 seconds
 *   });
 *
 *   if (isLoading) return <span>Loading...</span>;
 *   if (error) return <span>Error loading balance</span>;
 *   if (!formattedBalance) return <span>--</span>;
 *
 *   return (
 *     <div className="flex items-center gap-2">
 *       <span>{formattedBalance} {symbol}</span>
 *       <button onClick={refetch} className="text-xs text-muted">
 *         Refresh
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Native token balance
 * function NativeBalanceDisplay() {
 *   const { address, chainId } = useAccount();
 *
 *   const { formattedBalance, symbol } = useTokenBalance({
 *     chainId,
 *     tokenAddress: 'native', // Or '0x0000000000000000000000000000000000000000'
 *     walletAddress: address,
 *   });
 *
 *   return <span>{formattedBalance ?? '0'} {symbol ?? 'ETH'}</span>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Conditional fetching
 * function ConditionalBalance({ shouldFetch }: { shouldFetch: boolean }) {
 *   const { address } = useAccount();
 *
 *   const { formattedBalance } = useTokenBalance({
 *     chainId: 1,
 *     tokenAddress: '0x...',
 *     walletAddress: address,
 *     enabled: shouldFetch, // Only fetch when shouldFetch is true
 *   });
 *
 *   return <span>{formattedBalance}</span>;
 * }
 * ```
 */
export function useTokenBalance(params: UseTokenBalanceParams): UseTokenBalanceReturn {
  const { mina, isReady } = useMina();

  // Extract params with defaults
  const {
    chainId,
    tokenAddress,
    walletAddress,
    refetchInterval,
    enabled = true,
  } = params;

  // Memoize normalized token address to prevent unnecessary re-renders (Issue 4 fix)
  const normalizedTokenAddress = useMemo(
    () =>
      tokenAddress?.toLowerCase() === 'native'
        ? '0x0000000000000000000000000000000000000000'
        : tokenAddress,
    [tokenAddress]
  );

  // Check if all required params are present
  const hasRequiredParams = Boolean(chainId && normalizedTokenAddress && walletAddress);

  // State
  const [balance, setBalance] = useState<string | null>(null);
  const [formattedBalance, setFormattedBalance] = useState<string | null>(null);
  const [decimals, setDecimals] = useState<number | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(false); // Start false, set true in effect (Issue 1 fix)
  const fetchIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null); // Issue 2 fix

  /**
   * Clear balance data - called when params change or become invalid
   */
  const clearBalance = useCallback(() => {
    setBalance(null);
    setFormattedBalance(null);
    setDecimals(null);
    setSymbol(null);
    setBalanceUsd(null);
    setError(null);
  }, []);

  /**
   * Fetch the balance from the SDK
   */
  const fetchBalance = useCallback(async () => {
    // Use explicit type guards instead of non-null assertions (Issue 6 fix)
    if (!mina || !enabled) return;
    if (!chainId || !normalizedTokenAddress || !walletAddress) return;

    // Cancel any previous pending request (Issue 2 fix)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Track this fetch to handle race conditions
    const currentFetchId = ++fetchIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const result: BalanceWithMetadata = await mina.getBalance(
        chainId,
        normalizedTokenAddress,
        walletAddress
      );

      // Only update state if this is still the latest fetch and component is mounted
      if (currentFetchId === fetchIdRef.current && isMountedRef.current) {
        setBalance(result.balance);
        setFormattedBalance(formatDisplayBalance(result.formatted));
        setDecimals(result.token.decimals);
        setSymbol(result.token.symbol);
        setBalanceUsd(result.balanceUsd ?? null);
        setError(null);
      }
    } catch (err) {
      // Only update error if this is still the latest fetch and component is mounted
      // Ignore abort errors (Issue 2 fix)
      if (currentFetchId === fetchIdRef.current && isMountedRef.current) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        const fetchError = err instanceof Error ? err : new Error('Failed to fetch balance');
        setError(fetchError);
        // Don't clear existing balance data on error - keep stale data visible
      }
    } finally {
      if (currentFetchId === fetchIdRef.current && isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [mina, chainId, normalizedTokenAddress, walletAddress, enabled]);

  /**
   * Effect: Main fetch effect - handles param changes and mount tracking
   * Consolidates clearing logic to avoid double clearing (Issue 5 fix)
   * Sets isMountedRef before fetch to avoid race condition (Issue 1 fix)
   */
  useEffect(() => {
    isMountedRef.current = true; // Set mount state before any fetching (Issue 1 fix)

    // Clear and return early if conditions not met
    if (!isReady || !hasRequiredParams || !enabled) {
      clearBalance();
      return;
    }

    // Trigger initial fetch
    fetchBalance();

    return () => {
      // Increment fetchId to invalidate any in-flight requests
      fetchIdRef.current++;
      // Abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [isReady, hasRequiredParams, enabled, fetchBalance, clearBalance, walletAddress, chainId, normalizedTokenAddress]);

  /**
   * Effect: Set up automatic refetch interval
   */
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Don't set up interval if disabled, no params, or no interval specified
    if (!refetchInterval || !hasRequiredParams || !enabled || refetchInterval <= 0) {
      return;
    }

    // Set up new interval
    intervalRef.current = setInterval(fetchBalance, refetchInterval);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [refetchInterval, hasRequiredParams, enabled, fetchBalance]);

  /**
   * Effect: Track component unmount for cleanup
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Clean up interval on unmount
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  /**
   * Manual refetch function exposed to consumers
   * Clears interval to prevent overlapping fetches (Issue 3 fix)
   */
  const refetch = useCallback(async () => {
    // Clear interval to prevent overlapping fetches (Issue 3 fix)
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    await fetchBalance();

    // Restart interval if needed (Issue 3 fix)
    if (refetchInterval && hasRequiredParams && enabled && refetchInterval > 0) {
      intervalRef.current = setInterval(fetchBalance, refetchInterval);
    }
  }, [fetchBalance, refetchInterval, hasRequiredParams, enabled]);

  return {
    balance,
    formattedBalance,
    decimals,
    symbol,
    balanceUsd,
    isLoading,
    error,
    refetch,
  };
}
