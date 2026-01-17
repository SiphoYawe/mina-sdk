'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMina } from './MinaProvider';
import type { Quote, RoutePreference } from '../types';

/**
 * Parameters for the useQuote hook
 *
 * Note: autoDeposit is configured at the SDK client level via MinaProvider,
 * not per-quote. See MinaConfig.autoDeposit
 */
export interface UseQuoteParams {
  /** Source chain ID */
  fromChain?: number;
  /** Destination chain ID (defaults to HyperEVM 999) */
  toChain?: number;
  /** Source token address */
  fromToken?: string;
  /** Destination token address */
  toToken?: string;
  /** Amount to bridge (in smallest unit, e.g., wei) */
  amount?: string;
  /** User's wallet address */
  fromAddress?: string;
  /** Slippage tolerance in percentage format (e.g., 0.5 = 0.5%) */
  slippageTolerance?: number;
  /** Route preference: 'recommended' | 'fastest' | 'cheapest' */
  routePreference?: RoutePreference;
  /** Disable automatic fetching (default: true) */
  enabled?: boolean;
}

/**
 * Return type for the useQuote hook
 */
export interface UseQuoteReturn {
  /** The current quote (null if not yet fetched or no valid params) */
  quote: Quote | null;
  /** Whether a quote request is currently in flight */
  isLoading: boolean;
  /** Any error that occurred during quote fetch */
  error: Error | null;
  /** Manually trigger a new quote request */
  refetch: () => Promise<void>;
}

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 500;

/**
 * React hook for fetching bridge quotes with automatic debounced refetching
 *
 * @param params - Quote parameters
 * @returns Object containing quote, loading state, error, and refetch function
 *
 * @example
 * ```tsx
 * function QuoteDisplay() {
 *   const { quote, isLoading, error, refetch } = useQuote({
 *     fromChain: 1,
 *     toChain: 999,
 *     fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 *     toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f',
 *     amount: '1000000000', // 1000 USDC
 *     fromAddress: '0x...',
 *   });
 *
 *   if (isLoading) return <div>Getting quote...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!quote) return <div>Enter amount to get quote</div>;
 *
 *   return (
 *     <div>
 *       <p>You'll receive: {quote.toAmount}</p>
 *       <p>Fees: ${quote.fees.totalUsd.toFixed(2)}</p>
 *       <button onClick={refetch}>Refresh Quote</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useQuote(params: UseQuoteParams): UseQuoteReturn {
  const { mina, isReady } = useMina();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for cleanup and debouncing
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  // Track if a fetch is currently in progress to prevent concurrent requests
  const isFetchingRef = useRef(false);

  const {
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    fromAddress,
    slippageTolerance,
    routePreference,
    enabled = true,
  } = params;

  // Check if all required params are present and valid
  const hasRequiredParams = Boolean(
    fromChain &&
      toChain &&
      fromToken &&
      toToken &&
      amount &&
      fromAddress &&
      // Amount must be a valid positive number
      amount !== '0' &&
      amount !== ''
  );

  const fetchQuote = useCallback(async () => {
    if (!mina || !hasRequiredParams || !enabled) {
      return;
    }

    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const result = await mina.getQuote({
        fromChainId: fromChain!,
        toChainId: toChain!,
        fromToken: fromToken!,
        toToken: toToken!,
        fromAmount: amount!,
        fromAddress: fromAddress!,
        slippageTolerance,
        routePreference,
      });

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setQuote(result);
        setError(null);
      }
    } catch (err) {
      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to fetch quote'));
        // Keep previous quote on error (stale-while-revalidate)
      }
    } finally {
      isFetchingRef.current = false;
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    mina,
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    fromAddress,
    slippageTolerance,
    routePreference,
    hasRequiredParams,
    enabled,
  ]);

  // Debounced fetch on parameter changes
  useEffect(() => {
    // Track mount state
    isMountedRef.current = true;

    if (!isReady || !hasRequiredParams || !enabled) {
      return;
    }

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new debounced fetch
    timeoutRef.current = setTimeout(() => {
      fetchQuote();
    }, DEBOUNCE_MS);

    // Cleanup on unmount or when dependencies change
    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [
    fetchQuote,
    isReady,
    hasRequiredParams,
    enabled,
    // Include individual params to trigger on any change
    fromChain,
    toChain,
    fromToken,
    toToken,
    amount,
    fromAddress,
    slippageTolerance,
    routePreference,
  ]);

  // Manual refetch function (immediate, no debounce)
  const refetch = useCallback(async () => {
    // Clear any pending debounced fetch
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    await fetchQuote();
  }, [fetchQuote]);

  return {
    quote,
    isLoading,
    error,
    refetch,
  };
}
