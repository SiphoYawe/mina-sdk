/**
 * L1 Deposit Monitoring Service
 * Monitors and confirms when deposits appear on Hyperliquid L1 (chain 1337)
 *
 * After depositing USDC from HyperEVM to Hyperliquid L1 via the CoreDepositWallet,
 * this service polls the Hyperliquid Info API to detect when the deposit
 * is confirmed and reflected in the user's trading account balance.
 */

import { HYPERLIQUID_CHAIN_ID } from '../../constants';
import { MinaError, NetworkError } from '../../errors';
import type { DepositResult } from './execute-deposit';

/**
 * Hyperliquid Info API endpoint
 */
export const HYPERLIQUID_INFO_API = 'https://api.hyperliquid.xyz/info';

/**
 * Default timeout for L1 confirmation monitoring (2 minutes)
 */
export const L1_CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Hard maximum timeout for safety (30 minutes)
 * Prevents infinite polling if deposit never arrives
 */
export const L1_HARD_MAX_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Default polling interval for L1 balance checks (5 seconds)
 */
export const L1_POLL_INTERVAL_MS = 5000;

/**
 * USDC decimals
 */
export const L1_USDC_DECIMALS = 6;

/**
 * Validate Ethereum address format
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Options for L1 deposit monitoring
 */
export interface L1MonitorOptions {
  /** Timeout in milliseconds (default: 2 minutes) */
  timeout?: number;
  /** Polling interval in milliseconds (default: 5 seconds) */
  pollInterval?: number;
  /** Callback for progress updates */
  onProgress?: (progress: L1MonitorProgress) => void;
  /** Callback when timeout warning is emitted (monitoring continues) */
  onTimeoutWarning?: (warning: L1TimeoutWarning) => void;
}

/**
 * Progress information during L1 monitoring
 */
export interface L1MonitorProgress {
  /** Elapsed time in milliseconds */
  elapsed: number;
  /** Current poll attempt number */
  attempt: number;
  /** Whether we're actively checking */
  checking: boolean;
  /** Current trading account balance */
  currentBalance: string;
  /** Initial balance before deposit */
  initialBalance: string;
}

/**
 * Timeout warning payload
 */
export interface L1TimeoutWarning {
  /** Elapsed time in milliseconds */
  elapsed: number;
  /** Whether monitoring will continue */
  continuing: boolean;
  /** Current balance at timeout */
  currentBalance: string;
}

/**
 * Result of L1 confirmation detection
 */
export interface L1ConfirmationResult {
  /** Whether the deposit was confirmed on L1 */
  confirmed: boolean;
  /** Amount confirmed (in smallest units) */
  amount: string;
  /** Amount formatted with decimals */
  amountFormatted: string;
  /** Final trading account balance */
  finalBalance: string;
  /** Final balance formatted */
  finalBalanceFormatted: string;
  /** HyperEVM deposit transaction hash */
  hyperEvmTxHash: string;
  /** Time taken for confirmation in milliseconds */
  confirmationTime: number;
  /** Timestamp of confirmation */
  timestamp: number;
}

/**
 * Step information for completed bridge steps
 */
export interface CompletedStep {
  /** Step ID */
  id: string;
  /** Step type */
  type: 'swap' | 'bridge' | 'deposit' | 'approve';
  /** Transaction hash */
  txHash: string;
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Input amount */
  fromAmount: string;
  /** Output amount */
  toAmount: string;
  /** Time taken for this step in ms */
  duration: number;
}

/**
 * Complete summary of the bridge-to-trading-account flow
 */
export interface BridgeCompleteSummary {
  /** Source chain information */
  sourceChain: {
    id: number;
    name: string;
  };
  /** Source transaction hash (first step) */
  sourceTxHash: string;

  /** All bridge steps completed */
  bridgeSteps: CompletedStep[];
  /** Total time for bridge steps in ms */
  bridgeTime: number;

  /** HyperEVM deposit transaction hash */
  hyperEvmDepositTxHash: string;
  /** Time for HyperEVM deposit confirmation in ms */
  hyperEvmDepositTime: number;

  /** Time for L1 confirmation in ms */
  l1ConfirmationTime: number;

  /** Input amount (original) */
  inputAmount: string;
  /** Input amount formatted */
  inputAmountFormatted: string;
  /** Output amount (deposited to L1) */
  outputAmount: string;
  /** Output amount formatted */
  outputAmountFormatted: string;
  /** Final trading balance on Hyperliquid L1 */
  finalTradingBalance: string;
  /** Final trading balance formatted */
  finalTradingBalanceFormatted: string;

  /** Total time for entire flow in ms */
  totalTime: number;
  /** Total fees in USD */
  totalFeesUsd: string;

  /** Timestamp when flow completed */
  completedAt: number;
}

/**
 * Error thrown when L1 confirmation monitoring is cancelled or times out
 */
export class L1MonitorCancelledError extends MinaError {
  readonly code = 'L1_MONITOR_CANCELLED' as const;
  readonly recoverable = true as const;
  readonly elapsed: number;
  readonly reason: 'cancelled' | 'max_timeout';

  constructor(
    message: string,
    details: { elapsed: number; reason?: 'cancelled' | 'max_timeout' }
  ) {
    super(message, {
      step: 'deposit',
      userMessage: details.reason === 'max_timeout'
        ? 'L1 deposit monitoring reached maximum timeout. Your deposit may still be processing.'
        : 'L1 deposit monitoring was cancelled. Your deposit may still be processing.',
      recoveryAction: 'retry',
      details,
    });
    this.elapsed = details.elapsed;
    this.reason = details.reason || 'cancelled';
  }
}

/**
 * Error thrown when an invalid address is provided
 */
export class InvalidL1AddressError extends MinaError {
  readonly code = 'INVALID_L1_ADDRESS' as const;
  readonly recoverable = false as const;
  readonly address: string;

  constructor(message: string, details: { address: string }) {
    super(message, {
      step: 'deposit',
      userMessage: `Invalid wallet address format: ${details.address}`,
      recoveryAction: 'try_again',
      details,
    });
    this.address = details.address;
  }
}

/**
 * Type guard for L1MonitorCancelledError
 */
export function isL1MonitorCancelledError(error: unknown): error is L1MonitorCancelledError {
  return error instanceof L1MonitorCancelledError;
}

/**
 * Type guard for InvalidL1AddressError
 */
export function isInvalidL1AddressError(error: unknown): error is InvalidL1AddressError {
  return error instanceof InvalidL1AddressError;
}

/**
 * Controller for managing L1 monitoring lifecycle
 */
export interface L1MonitorController {
  /** Cancel the monitoring */
  cancel: () => void;
  /** Extend the timeout by the specified milliseconds */
  extendTimeout: (additionalMs: number) => void;
  /** Get current status */
  getStatus: () => {
    elapsed: number;
    timeout: number;
    isRunning: boolean;
    cancelled: boolean;
    completed: boolean;
  };
}

/**
 * Format a token amount with proper decimals
 */
function formatAmount(amount: string, decimals: number): string {
  const amountBigInt = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const integerPart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0');

  return `${integerPart}.${trimmedFractional}`;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hyperliquid clearinghouse state response
 */
interface ClearinghouseState {
  marginSummary?: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  crossMarginSummary?: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  assetPositions?: Array<{
    position: {
      coin: string;
      entryPx: string;
      leverage: {
        type: string;
        value: number;
      };
    };
  }>;
}

/**
 * Get Hyperliquid L1 trading account balance (account value)
 *
 * Uses the Hyperliquid Info API to fetch the clearinghouse state
 * and extract the account value (total equity).
 *
 * @param walletAddress - The wallet address to check
 * @returns Account value in smallest units (raw USD * 10^6)
 * @throws InvalidL1AddressError if address format is invalid
 * @throws NetworkError if API request fails
 */
export async function getHyperliquidBalance(walletAddress: string): Promise<string> {
  // Validate address format
  if (!isValidAddress(walletAddress)) {
    throw new InvalidL1AddressError(
      `Invalid wallet address format: ${walletAddress}`,
      { address: walletAddress }
    );
  }

  try {
    const response = await fetch(HYPERLIQUID_INFO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'clearinghouseState',
        user: walletAddress,
      }),
    });

    if (!response.ok) {
      throw new NetworkError('Failed to fetch Hyperliquid balance', {
        endpoint: HYPERLIQUID_INFO_API,
        statusCode: response.status,
      });
    }

    // Parse JSON with explicit error handling
    let data: ClearinghouseState;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new NetworkError(
        `Failed to parse Hyperliquid API response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        { endpoint: HYPERLIQUID_INFO_API }
      );
    }

    // Extract account value from margin summary
    // The API returns values as strings with decimal places (e.g., "1234.56")
    // We need to convert to smallest units (multiply by 10^6 for USDC precision)
    const accountValueStr = data.marginSummary?.accountValue ||
                           data.crossMarginSummary?.accountValue ||
                           '0';

    // Convert from decimal string to smallest units
    // e.g., "1234.56" -> "1234560000" (6 decimals)
    const parts = accountValueStr.split('.');
    const integerPart = parts[0] || '0';
    const decimalPart = (parts[1] || '').padEnd(L1_USDC_DECIMALS, '0').slice(0, L1_USDC_DECIMALS);

    return BigInt(integerPart + decimalPart).toString();
  } catch (error) {
    if (error instanceof NetworkError || error instanceof InvalidL1AddressError) {
      throw error;
    }
    throw new NetworkError('Failed to fetch Hyperliquid balance', {
      endpoint: HYPERLIQUID_INFO_API,
    });
  }
}

/**
 * Check if a Hyperliquid account exists (has any activity)
 *
 * @param walletAddress - The wallet address to check
 * @returns Whether the account has any trading history
 */
export async function checkHyperliquidAccountExists(walletAddress: string): Promise<boolean> {
  try {
    const balance = await getHyperliquidBalance(walletAddress);
    return BigInt(balance) > 0n;
  } catch {
    return false;
  }
}

/**
 * Monitor L1 deposit confirmation
 *
 * Polls the Hyperliquid L1 trading account balance to detect when
 * a deposit from HyperEVM is confirmed. Returns immediately with a
 * Promise for the result and a controller to manage the monitoring.
 *
 * @param walletAddress - The wallet address to monitor
 * @param expectedAmount - The expected deposit amount in smallest units
 * @param hyperEvmTxHash - The HyperEVM deposit transaction hash
 * @param options - Monitoring options
 * @returns Object with result Promise and controller for managing the monitoring
 * @throws InvalidL1AddressError if address format is invalid (thrown immediately)
 *
 * @example
 * ```typescript
 * // Get controller immediately, result is a Promise
 * const { result, controller } = monitorL1Confirmation(
 *   '0x1234...',
 *   '10000000', // 10 USDC
 *   '0xabc...',
 *   {
 *     timeout: 120000, // 2 minutes
 *     onProgress: (p) => console.log(`Checking... ${p.elapsed}ms elapsed`),
 *     onTimeoutWarning: (w) => console.log('Timeout warning - continuing...'),
 *   }
 * );
 *
 * // Can use controller while monitoring is in progress
 * setTimeout(() => {
 *   const status = controller.getStatus();
 *   if (status.isRunning && status.elapsed > 60000) {
 *     controller.extendTimeout(60000); // Add 1 more minute
 *   }
 * }, 60000);
 *
 * // Await the result
 * const confirmation = await result;
 * console.log(`Deposit confirmed: ${confirmation.amountFormatted} USDC`);
 * ```
 */
export function monitorL1Confirmation(
  walletAddress: string,
  expectedAmount: string,
  hyperEvmTxHash: string,
  options: L1MonitorOptions = {}
): { result: Promise<L1ConfirmationResult>; controller: L1MonitorController } {
  // Validate address format upfront (throws immediately if invalid)
  if (!isValidAddress(walletAddress)) {
    throw new InvalidL1AddressError(
      `Invalid wallet address format: ${walletAddress}`,
      { address: walletAddress }
    );
  }

  const {
    timeout: initialTimeout = L1_CONFIRMATION_TIMEOUT_MS,
    pollInterval = L1_POLL_INTERVAL_MS,
    onProgress,
    onTimeoutWarning,
  } = options;

  const startTime = Date.now();
  let timeout = initialTimeout;
  let timeoutWarningEmitted = false;
  let cancelled = false;
  let completed = false;
  let attempt = 0;

  // Create controller (returned immediately)
  const controller: L1MonitorController = {
    cancel: () => {
      cancelled = true;
    },
    extendTimeout: (additionalMs: number) => {
      timeout += additionalMs;
      // Reset timeout warning so it can fire again if needed
      timeoutWarningEmitted = false;
    },
    getStatus: () => ({
      elapsed: Date.now() - startTime,
      timeout,
      isRunning: !cancelled && !completed,
      cancelled,
      completed,
    }),
  };

  // Start monitoring loop (runs asynchronously)
  const resultPromise = (async (): Promise<L1ConfirmationResult> => {
    // Get initial balance
    const initialBalance = await getHyperliquidBalance(walletAddress);
    let currentBalance = initialBalance;

    while (true) {
      const elapsed = Date.now() - startTime;
      attempt++;

      // Check for cancellation
      if (cancelled) {
        throw new L1MonitorCancelledError(
          'L1 deposit monitoring was cancelled',
          { elapsed, reason: 'cancelled' }
        );
      }

      // Check for hard maximum timeout (safety net)
      if (elapsed > L1_HARD_MAX_TIMEOUT_MS) {
        throw new L1MonitorCancelledError(
          'L1 deposit monitoring reached maximum timeout',
          { elapsed, reason: 'max_timeout' }
        );
      }

      try {
        currentBalance = await getHyperliquidBalance(walletAddress);

        // Emit progress
        if (onProgress) {
          onProgress({
            elapsed,
            attempt,
            checking: true,
            currentBalance,
            initialBalance,
          });
        }

        // Check for balance increase
        const initialBigInt = BigInt(initialBalance);
        const currentBigInt = BigInt(currentBalance);
        const difference = currentBigInt - initialBigInt;

        // Log if balance decreased (trading activity during monitoring)
        if (difference < 0n) {
          console.warn(
            `L1 balance decreased during monitoring (trading activity detected). ` +
            `Initial: ${initialBalance}, Current: ${currentBalance}`
          );
        }

        // Check if we received at least 99% of expected amount (1% tolerance for fees)
        const expectedBigInt = BigInt(expectedAmount);
        const minExpected = (expectedBigInt * 99n) / 100n;

        if (difference >= minExpected) {
          // Deposit confirmed!
          completed = true;
          const confirmationTime = Date.now() - startTime;
          const amount = difference.toString();

          return {
            confirmed: true,
            amount,
            amountFormatted: formatAmount(amount, L1_USDC_DECIMALS),
            finalBalance: currentBalance,
            finalBalanceFormatted: formatAmount(currentBalance, L1_USDC_DECIMALS),
            hyperEvmTxHash,
            confirmationTime,
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        // Rethrow cancellation errors
        if (error instanceof L1MonitorCancelledError) {
          throw error;
        }
        // Log but continue polling on network errors
        console.warn(`L1 confirmation poll failed (attempt ${attempt}):`, error);
      }

      // Check for timeout warning (but don't stop)
      if (elapsed > timeout && !timeoutWarningEmitted) {
        timeoutWarningEmitted = true;
        if (onTimeoutWarning) {
          onTimeoutWarning({
            elapsed,
            continuing: true,
            currentBalance,
          });
        }
      }

      // Wait before next poll
      await sleep(pollInterval);
    }
  })();

  // Return immediately with Promise and controller
  return { result: resultPromise, controller };
}

/**
 * Simple L1 confirmation monitoring (without controller)
 *
 * For simpler use cases where you don't need to control the monitoring.
 *
 * @param walletAddress - The wallet address to monitor
 * @param expectedAmount - The expected deposit amount in smallest units
 * @param hyperEvmTxHash - The HyperEVM deposit transaction hash
 * @param options - Monitoring options
 * @returns L1ConfirmationResult when deposit is confirmed
 * @throws InvalidL1AddressError if address format is invalid
 * @throws L1MonitorCancelledError if max timeout is reached
 *
 * @example
 * ```typescript
 * const result = await waitForL1Confirmation(
 *   '0x1234...',
 *   '10000000',
 *   '0xabc...'
 * );
 *
 * console.log(`Confirmed: ${result.amountFormatted} USDC`);
 * ```
 */
export async function waitForL1Confirmation(
  walletAddress: string,
  expectedAmount: string,
  hyperEvmTxHash: string,
  options: L1MonitorOptions = {}
): Promise<L1ConfirmationResult> {
  const { result } = monitorL1Confirmation(
    walletAddress,
    expectedAmount,
    hyperEvmTxHash,
    options
  );
  return result;
}

/**
 * Create a complete transaction summary for the entire bridge flow
 *
 * Aggregates information from bridge execution, HyperEVM deposit,
 * and L1 confirmation into a comprehensive summary.
 *
 * @param params - Summary parameters
 * @returns BridgeCompleteSummary
 *
 * @example
 * ```typescript
 * const summary = createBridgeCompleteSummary({
 *   sourceChainId: 42161,
 *   sourceChainName: 'Arbitrum One',
 *   sourceTxHash: '0x123...',
 *   bridgeSteps: [...],
 *   bridgeStartTime: 1234567890000,
 *   depositResult: { ... },
 *   depositStartTime: 1234567900000,
 *   l1MonitorStartTime: 1234567910000,
 *   l1Confirmation: { ... },
 *   inputAmount: '10000000',
 *   totalFeesUsd: 1.50,
 * });
 * ```
 */
export function createBridgeCompleteSummary(params: {
  sourceChainId: number;
  sourceChainName: string;
  sourceTxHash: string;
  bridgeSteps: CompletedStep[];
  bridgeStartTime: number;
  depositResult: DepositResult;
  depositStartTime: number;
  /** Time when L1 monitoring started (after HyperEVM deposit confirmed) */
  l1MonitorStartTime?: number;
  l1Confirmation: L1ConfirmationResult;
  inputAmount: string;
  totalFeesUsd: number;
}): BridgeCompleteSummary {
  const {
    sourceChainId,
    sourceChainName,
    sourceTxHash,
    bridgeSteps,
    bridgeStartTime,
    depositResult,
    depositStartTime,
    l1MonitorStartTime,
    l1Confirmation,
    inputAmount,
    totalFeesUsd,
  } = params;

  // Calculate bridge time (time from start to deposit initiation)
  const bridgeTime = depositStartTime - bridgeStartTime;

  // Calculate HyperEVM deposit time
  // If l1MonitorStartTime is provided, use it for accurate calculation
  // Otherwise estimate from L1 confirmation timestamp
  const l1StartTime = l1MonitorStartTime ?? (l1Confirmation.timestamp - l1Confirmation.confirmationTime);
  const hyperEvmDepositTime = Math.max(0, l1StartTime - depositStartTime);

  // Total time
  const totalTime = l1Confirmation.timestamp - bridgeStartTime;

  return {
    sourceChain: {
      id: sourceChainId,
      name: sourceChainName,
    },
    sourceTxHash,

    bridgeSteps,
    bridgeTime,

    hyperEvmDepositTxHash: depositResult.depositTxHash,
    hyperEvmDepositTime,

    l1ConfirmationTime: l1Confirmation.confirmationTime,

    inputAmount,
    inputAmountFormatted: formatAmount(inputAmount, L1_USDC_DECIMALS),
    outputAmount: l1Confirmation.amount,
    outputAmountFormatted: l1Confirmation.amountFormatted,
    finalTradingBalance: l1Confirmation.finalBalance,
    finalTradingBalanceFormatted: l1Confirmation.finalBalanceFormatted,

    totalTime,
    totalFeesUsd: totalFeesUsd.toFixed(2),

    completedAt: l1Confirmation.timestamp,
  };
}

/**
 * Get current L1 trading account balance (one-time check)
 *
 * @param walletAddress - The wallet address to check
 * @returns Current balance information
 * @throws InvalidL1AddressError if address format is invalid
 */
export async function getL1TradingBalance(walletAddress: string): Promise<{
  balance: string;
  balanceFormatted: string;
  chainId: number;
}> {
  const balance = await getHyperliquidBalance(walletAddress);
  return {
    balance,
    balanceFormatted: formatAmount(balance, L1_USDC_DECIMALS),
    chainId: HYPERLIQUID_CHAIN_ID,
  };
}
