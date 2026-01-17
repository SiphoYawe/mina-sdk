'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMina } from './MinaProvider';
import type { TransactionStatus } from '../types';

/**
 * Return type for the useTransactionStatus hook
 */
export interface UseTransactionStatusReturn {
  /** The current transaction status (null if not yet fetched) */
  status: TransactionStatus | null;
  /** Whether a status request is currently in flight */
  isLoading: boolean;
  /** Any error that occurred during status fetch */
  error: Error | null;
  /** Manually trigger a status refresh */
  refetch: () => Promise<void>;
}

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 3000;

/** Terminal statuses that stop polling */
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/**
 * Check if a status is terminal (completed or failed)
 */
function isTerminalStatus(status: TransactionStatus | null): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.includes(status.status as TerminalStatus);
}

/**
 * React hook for tracking bridge transaction status with automatic polling
 *
 * Polls the transaction status every 3 seconds while the transaction is pending.
 * Automatically stops polling when the transaction reaches a terminal status
 * (completed or failed).
 *
 * @param transactionId - The transaction hash to track (null disables polling)
 * @returns Object containing status, loading state, error, and refetch function
 *
 * @example
 * ```tsx
 * function TransactionTracker({ txId }: { txId: string }) {
 *   const { status, isLoading, error, refetch } = useTransactionStatus(txId);
 *
 *   if (isLoading && !status) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!status) return null;
 *
 *   return (
 *     <div>
 *       <p>Status: {status.status}</p>
 *       {status.steps.map((step, i) => (
 *         <div key={i}>
 *           {step.stepId}: {step.status}
 *           {step.txHash && <a href={`https://etherscan.io/tx/${step.txHash}`}>View</a>}
 *         </div>
 *       ))}
 *       <button onClick={refetch}>Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Using with execution result
 * function BridgeExecution() {
 *   const [txHash, setTxHash] = useState<string | null>(null);
 *   const { status } = useTransactionStatus(txHash);
 *
 *   const handleBridge = async () => {
 *     const result = await mina.execute({ quote, signer });
 *     if (result.txHash) {
 *       setTxHash(result.txHash);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <button onClick={handleBridge}>Bridge</button>
 *       {status && <p>Progress: {status.status}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTransactionStatus(
  transactionId: string | null
): UseTransactionStatusReturn {
  const { mina, isReady } = useMina();
  const [status, setStatus] = useState<TransactionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  // Clear the polling interval
  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!mina || !transactionId) {
      return;
    }

    setIsLoading(true);

    try {
      const result = await mina.getStatus(transactionId);

      // Only update state if component is still mounted
      if (isMountedRef.current) {
        setStatus(result);
        setError(null);

        // Stop polling if we've reached a terminal status
        if (isTerminalStatus(result)) {
          clearPolling();
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(
          err instanceof Error ? err : new Error('Failed to fetch transaction status')
        );
        // Don't clear status on error - keep the last known status
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [mina, transactionId, clearPolling]);

  // Start/stop polling when transaction ID changes
  useEffect(() => {
    isMountedRef.current = true;

    // Clear previous state when transaction ID changes
    if (transactionId) {
      setStatus(null);
      setError(null);
    }

    if (!isReady || !transactionId) {
      clearPolling();
      return;
    }

    // Initial fetch
    fetchStatus();

    // Start polling
    intervalRef.current = setInterval(() => {
      // Don't poll if already loading or if we have a terminal status
      if (!isMountedRef.current) return;
      fetchStatus();
    }, POLL_INTERVAL_MS);

    // Cleanup on unmount or when transaction ID changes
    return () => {
      isMountedRef.current = false;
      clearPolling();
    };
  }, [isReady, transactionId, fetchStatus, clearPolling]);

  // Stop polling when status becomes terminal
  useEffect(() => {
    if (isTerminalStatus(status)) {
      clearPolling();
    }
  }, [status, clearPolling]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  return {
    status,
    isLoading,
    error,
    refetch,
  };
}
