/**
 * USDC Arrival Detection Service
 * Monitors for bridged USDC arrival on HyperEVM (chain 999)
 */

import { HYPEREVM_CHAIN_ID, HYPEREVM_USDC_ADDRESS, LIFI_API_URL, getNetworkConfig } from '../../constants';
import { MinaError, NetworkError } from '../../errors';

/**
 * Default timeout for USDC arrival detection (5 minutes)
 */
export const ARRIVAL_DETECTION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Polling interval for balance checks (5 seconds)
 */
export const ARRIVAL_POLL_INTERVAL_MS = 5000;

/**
 * USDC decimals on HyperEVM
 */
const USDC_DECIMALS = 6;

/**
 * Result of USDC arrival detection
 */
export interface UsdcArrivalResult {
  /** Whether USDC arrival was detected */
  detected: boolean;
  /** Amount received in base units (smallest unit) */
  amount: string;
  /** Human-readable amount with proper decimal formatting */
  amountFormatted: string;
  /** Transaction hash on HyperEVM (if available from LI.FI status) */
  receivingTxHash?: string;
  /** Timestamp when arrival was detected */
  timestamp: number;
  /** Pre-bridge balance snapshot */
  previousBalance: string;
  /** Current balance after detection */
  currentBalance: string;
}

/**
 * Options for USDC arrival detection
 */
export interface DetectionOptions {
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Polling interval in milliseconds (default: 5 seconds) */
  pollInterval?: number;
  /** Callback for each poll attempt */
  onPoll?: (attempt: number, currentBalance: string) => void;
  /** Expected minimum amount (optional, for validation) */
  expectedAmount?: string;
  /** HyperEVM chain ID for network selection (998=testnet, 999=mainnet) */
  chainId?: number;
}

/**
 * Error thrown when USDC arrival is not detected within timeout
 */
export class UsdcArrivalTimeoutError extends MinaError {
  readonly code = 'USDC_ARRIVAL_TIMEOUT' as const;
  readonly recoverable = true as const;
  readonly walletAddress: string;
  readonly timeout: number;
  readonly lastBalance: string;

  constructor(
    message: string,
    details: {
      walletAddress: string;
      timeout: number;
      lastBalance: string;
    }
  ) {
    super(message, {
      step: 'bridge',
      userMessage: 'USDC arrival detection timed out. Your funds may still be in transit.',
      recoveryAction: 'retry',
      details,
    });
    this.walletAddress = details.walletAddress;
    this.timeout = details.timeout;
    this.lastBalance = details.lastBalance;
  }
}

/**
 * Type guard for UsdcArrivalTimeoutError
 */
export function isUsdcArrivalTimeoutError(error: unknown): error is UsdcArrivalTimeoutError {
  return error instanceof UsdcArrivalTimeoutError;
}

/**
 * Format a token amount with proper decimals
 */
function formatAmount(amount: string, decimals: number): string {
  const amountBigInt = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const integerPart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  // Remove trailing zeros but keep at least 2 decimal places
  const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0');

  return `${integerPart}.${trimmedFractional}`;
}

/**
 * Get USDC balance on HyperEVM via LI.FI API
 * @param walletAddress - Wallet address to check
 * @param chainId - Chain ID for network selection (998=testnet, 999=mainnet)
 */
async function getUsdcBalance(walletAddress: string, chainId: number = HYPEREVM_CHAIN_ID): Promise<string> {
  const url = `${LIFI_API_URL}/token/balance`;
  const params = new URLSearchParams({
    chain: chainId.toString(),
    token: HYPEREVM_USDC_ADDRESS,
    address: walletAddress,
  });

  try {
    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // Try alternative endpoint format
      const altUrl = `${LIFI_API_URL}/token`;
      const altParams = new URLSearchParams({
        chain: chainId.toString(),
        token: HYPEREVM_USDC_ADDRESS,
      });

      const altResponse = await fetch(`${altUrl}?${altParams}`);
      if (!altResponse.ok) {
        throw new NetworkError('Failed to fetch USDC balance', {
          endpoint: url,
          statusCode: response.status,
        });
      }
    }

    const data = await response.json();

    // Handle different response formats
    if (data.amount !== undefined) {
      return data.amount.toString();
    }
    if (data.balance !== undefined) {
      return data.balance.toString();
    }

    // Fallback: try to get balance directly
    return await getUsdcBalanceDirect(walletAddress, chainId);
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error;
    }
    // Fallback to direct RPC call
    return await getUsdcBalanceDirect(walletAddress, chainId);
  }
}

/**
 * Get USDC balance directly via RPC (fallback method)
 * Uses eth_call to read balanceOf from the USDC contract
 * @param walletAddress - Wallet address to check
 * @param chainId - Chain ID for network selection (998=testnet, 999=mainnet)
 */
async function getUsdcBalanceDirect(walletAddress: string, chainId: number = HYPEREVM_CHAIN_ID): Promise<string> {
  // HyperEVM RPC endpoint - dynamic based on network
  const networkConfig = getNetworkConfig(chainId);
  const rpcUrl = networkConfig.rpcUrl;

  // ERC20 balanceOf function selector: 0x70a08231
  // Padded address (remove 0x, pad to 32 bytes)
  const addressPadded = walletAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  const data = `0x70a08231${addressPadded}`;

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: HYPEREVM_USDC_ADDRESS,
            data,
          },
          'latest',
        ],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new NetworkError('Failed to fetch USDC balance via RPC', {
        endpoint: rpcUrl,
        statusCode: response.status,
      });
    }

    const result = await response.json();

    if (result.error) {
      throw new NetworkError(`RPC error: ${result.error.message}`, {
        endpoint: rpcUrl,
      });
    }

    // Convert hex result to decimal string
    const balanceHex = result.result;
    if (!balanceHex || balanceHex === '0x') {
      return '0';
    }

    return BigInt(balanceHex).toString();
  } catch (error) {
    if (error instanceof NetworkError) {
      throw error;
    }
    throw new NetworkError('Failed to fetch USDC balance', {
      endpoint: rpcUrl,
    });
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detect USDC arrival on HyperEVM
 *
 * Polls the USDC balance on HyperEVM and detects when it increases
 * from the initial snapshot, indicating the bridged funds have arrived.
 *
 * @param walletAddress - The wallet address to monitor
 * @param options - Detection options (timeout, pollInterval, callbacks)
 * @returns UsdcArrivalResult with detected amount and details
 * @throws UsdcArrivalTimeoutError if detection times out
 *
 * @example
 * ```typescript
 * const result = await detectUsdcArrival('0x...', {
 *   timeout: 300000, // 5 minutes
 *   onPoll: (attempt, balance) => console.log(`Poll ${attempt}: ${balance}`),
 * });
 *
 * if (result.detected) {
 *   console.log(`USDC arrived: ${result.amountFormatted} USDC`);
 * }
 * ```
 */
export async function detectUsdcArrival(
  walletAddress: string,
  options: DetectionOptions = {}
): Promise<UsdcArrivalResult> {
  const {
    timeout = ARRIVAL_DETECTION_TIMEOUT_MS,
    pollInterval = ARRIVAL_POLL_INTERVAL_MS,
    onPoll,
    expectedAmount,
    chainId,
  } = options;

  const startTime = Date.now();
  let attempt = 0;

  // Get initial balance snapshot
  const initialBalance = await getUsdcBalance(walletAddress, chainId);
  let lastBalance = initialBalance;

  while (Date.now() - startTime < timeout) {
    attempt++;

    try {
      const currentBalance = await getUsdcBalance(walletAddress, chainId);
      lastBalance = currentBalance;

      // Notify callback
      if (onPoll) {
        onPoll(attempt, currentBalance);
      }

      // Check if balance increased
      const initialBigInt = BigInt(initialBalance);
      const currentBigInt = BigInt(currentBalance);
      const difference = currentBigInt - initialBigInt;

      if (difference > 0n) {
        // USDC has arrived!
        const amountStr = difference.toString();

        // Optionally validate against expected amount (with some tolerance)
        if (expectedAmount) {
          const expectedBigInt = BigInt(expectedAmount);
          // Allow 1% tolerance for slippage
          const minExpected = (expectedBigInt * 99n) / 100n;
          if (difference < minExpected) {
            // Amount is significantly less than expected, might be partial
            // Continue polling for more
            await sleep(pollInterval);
            continue;
          }
        }

        return {
          detected: true,
          amount: amountStr,
          amountFormatted: formatAmount(amountStr, USDC_DECIMALS),
          timestamp: Date.now(),
          previousBalance: initialBalance,
          currentBalance,
        };
      }
    } catch (error) {
      // Log but continue polling on network errors
      console.warn(`USDC detection poll failed (attempt ${attempt}):`, error);
    }

    // Wait before next poll
    await sleep(pollInterval);
  }

  // Timeout reached
  throw new UsdcArrivalTimeoutError(
    `USDC arrival not detected within ${timeout / 1000} seconds`,
    {
      walletAddress,
      timeout,
      lastBalance,
    }
  );
}

/**
 * Create a pre-bridge balance snapshot for later comparison
 *
 * Call this before initiating a bridge to capture the starting balance.
 *
 * @param walletAddress - The wallet address to snapshot
 * @param chainId - Optional HyperEVM chain ID for network selection (998=testnet, 999=mainnet)
 * @returns The current USDC balance on HyperEVM
 *
 * @example
 * ```typescript
 * const preBalance = await snapshotUsdcBalance('0x...');
 * // ... execute bridge ...
 * const result = await detectUsdcArrivalFromSnapshot('0x...', preBalance);
 * ```
 */
export async function snapshotUsdcBalance(walletAddress: string, chainId?: number): Promise<string> {
  return getUsdcBalance(walletAddress, chainId);
}

/**
 * Detect USDC arrival starting from a known balance snapshot
 *
 * Use this when you've already captured the pre-bridge balance.
 *
 * @param walletAddress - The wallet address to monitor
 * @param previousBalance - The pre-bridge balance snapshot
 * @param options - Detection options
 * @returns UsdcArrivalResult with detected amount
 * @throws UsdcArrivalTimeoutError if detection times out
 */
export async function detectUsdcArrivalFromSnapshot(
  walletAddress: string,
  previousBalance: string,
  options: DetectionOptions = {}
): Promise<UsdcArrivalResult> {
  const {
    timeout = ARRIVAL_DETECTION_TIMEOUT_MS,
    pollInterval = ARRIVAL_POLL_INTERVAL_MS,
    onPoll,
    expectedAmount,
    chainId,
  } = options;

  const startTime = Date.now();
  let attempt = 0;
  let lastBalance = previousBalance;

  while (Date.now() - startTime < timeout) {
    attempt++;

    try {
      const currentBalance = await getUsdcBalance(walletAddress, chainId);
      lastBalance = currentBalance;

      // Notify callback
      if (onPoll) {
        onPoll(attempt, currentBalance);
      }

      // Check if balance increased
      const previousBigInt = BigInt(previousBalance);
      const currentBigInt = BigInt(currentBalance);
      const difference = currentBigInt - previousBigInt;

      if (difference > 0n) {
        const amountStr = difference.toString();

        // Optionally validate against expected amount
        if (expectedAmount) {
          const expectedBigInt = BigInt(expectedAmount);
          const minExpected = (expectedBigInt * 99n) / 100n;
          if (difference < minExpected) {
            await sleep(pollInterval);
            continue;
          }
        }

        return {
          detected: true,
          amount: amountStr,
          amountFormatted: formatAmount(amountStr, USDC_DECIMALS),
          timestamp: Date.now(),
          previousBalance,
          currentBalance,
        };
      }
    } catch (error) {
      console.warn(`USDC detection poll failed (attempt ${attempt}):`, error);
    }

    await sleep(pollInterval);
  }

  throw new UsdcArrivalTimeoutError(
    `USDC arrival not detected within ${timeout / 1000} seconds`,
    {
      walletAddress,
      timeout,
      lastBalance,
    }
  );
}

/**
 * Check USDC balance on HyperEVM (one-time check, no polling)
 *
 * @param walletAddress - The wallet address to check
 * @param chainId - Optional HyperEVM chain ID for network selection (998=testnet, 999=mainnet)
 * @returns Current USDC balance details
 */
export async function checkUsdcBalance(walletAddress: string, chainId: number = HYPEREVM_CHAIN_ID): Promise<{
  balance: string;
  balanceFormatted: string;
  chainId: number;
  tokenAddress: string;
}> {
  const balance = await getUsdcBalance(walletAddress, chainId);
  return {
    balance,
    balanceFormatted: formatAmount(balance, USDC_DECIMALS),
    chainId,
    tokenAddress: HYPEREVM_USDC_ADDRESS,
  };
}
