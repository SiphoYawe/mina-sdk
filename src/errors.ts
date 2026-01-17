/**
 * Error types for @mina-bridge/sdk
 *
 * Each error includes:
 * - code: Unique error code for programmatic handling
 * - message: Human-readable error message
 * - recoverable: Whether the error can be retried
 * - userMessage: User-friendly explanation
 * - recoveryAction: Suggested action to resolve the error
 * - details: Additional context when available
 */

import type { StepType } from './types';

/**
 * Recovery action types for error handling
 */
export type RecoveryAction =
  | 'retry'
  | 'add_funds'
  | 'increase_slippage'
  | 'try_different_amount'
  | 'try_again'
  | 'fetch_new_quote'
  | 'contact_support'
  | 'switch_network'
  | 'check_allowance'
  | 'adjust_slippage';

/**
 * Recovery action mapping by error code
 */
export const RECOVERY_ACTIONS: Record<string, RecoveryAction> = {
  INSUFFICIENT_BALANCE: 'add_funds',
  NO_ROUTE_FOUND: 'try_different_amount',
  SLIPPAGE_EXCEEDED: 'increase_slippage',
  INVALID_SLIPPAGE: 'adjust_slippage',
  TRANSACTION_FAILED: 'retry',
  USER_REJECTED: 'try_again',
  NETWORK_ERROR: 'retry',
  DEPOSIT_FAILED: 'retry',
  QUOTE_EXPIRED: 'fetch_new_quote',
  MAX_RETRIES_EXCEEDED: 'contact_support',
  APPROVAL_FAILED: 'check_allowance',
};

/**
 * Base error class for all Mina SDK errors
 */
export abstract class MinaError extends Error {
  abstract readonly code: string;
  /** Whether this error is recoverable via retry */
  abstract readonly recoverable: boolean;
  /** The step where this error occurred */
  readonly step?: StepType;
  /** User-friendly error message for display */
  readonly userMessage: string;
  /** Suggested recovery action */
  readonly recoveryAction: RecoveryAction;
  /** Additional details for debugging */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      step?: StepType;
      userMessage?: string;
      recoveryAction?: RecoveryAction;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.step = options.step;
    this.userMessage = options.userMessage || message;
    this.recoveryAction = options.recoveryAction || 'retry';
    this.details = options.details;
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    const ErrorWithCaptureStackTrace = Error as typeof Error & {
      captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void;
    };
    if (ErrorWithCaptureStackTrace.captureStackTrace) {
      ErrorWithCaptureStackTrace.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when user doesn't have enough tokens for the transaction
 */
export class InsufficientBalanceError extends MinaError {
  readonly code = 'INSUFFICIENT_BALANCE' as const;
  readonly recoverable = false as const;
  readonly required: string;
  readonly available: string;
  readonly token: string;

  constructor(
    message: string,
    details: {
      required: string;
      available: string;
      token: string;
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step,
      userMessage: `Insufficient ${details.token} balance. You need ${details.required} but only have ${details.available}.`,
      recoveryAction: 'add_funds',
      details,
    });
    this.required = details.required;
    this.available = details.available;
    this.token = details.token;
  }
}

/**
 * Error thrown when no bridge route is available for the requested path
 */
export class NoRouteFoundError extends MinaError {
  readonly code = 'NO_ROUTE_FOUND' as const;
  readonly recoverable = false as const;
  readonly fromChainId: number;
  readonly toChainId: number;
  readonly fromToken: string;
  readonly toToken: string;

  constructor(
    message: string,
    details: {
      fromChainId: number;
      toChainId: number;
      fromToken: string;
      toToken: string;
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step,
      userMessage: 'No bridge route found for this token pair. Try a different amount or token.',
      recoveryAction: 'try_different_amount',
      details,
    });
    this.fromChainId = details.fromChainId;
    this.toChainId = details.toChainId;
    this.fromToken = details.fromToken;
    this.toToken = details.toToken;
  }
}

/**
 * Error thrown when price moved beyond the specified slippage tolerance
 */
export class SlippageExceededError extends MinaError {
  readonly code = 'SLIPPAGE_EXCEEDED' as const;
  readonly recoverable = true as const;
  readonly expectedAmount: string;
  readonly actualAmount: string;
  readonly slippageTolerance: number;

  constructor(
    message: string,
    details: {
      expectedAmount: string;
      actualAmount: string;
      slippageTolerance: number;
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step,
      userMessage: `Price moved beyond your ${(details.slippageTolerance * 100).toFixed(1)}% slippage tolerance. Try increasing slippage or getting a new quote.`,
      recoveryAction: 'increase_slippage',
      details,
    });
    this.expectedAmount = details.expectedAmount;
    this.actualAmount = details.actualAmount;
    this.slippageTolerance = details.slippageTolerance;
  }
}

/**
 * Error thrown when slippage tolerance value is invalid (outside 0.01-5.0 range)
 */
export class InvalidSlippageError extends MinaError {
  readonly code = 'INVALID_SLIPPAGE' as const;
  readonly recoverable = false as const;
  readonly provided: number;
  readonly min: number;
  readonly max: number;

  constructor(
    message: string,
    details: {
      provided: number;
      min: number;
      max: number;
    }
  ) {
    super(message, {
      userMessage: `Slippage must be between ${details.min}% and ${details.max}%. You provided ${details.provided}%.`,
      recoveryAction: 'adjust_slippage',
      details,
    });
    this.name = 'InvalidSlippageError';
    this.provided = details.provided;
    this.min = details.min;
    this.max = details.max;
  }
}

/**
 * Error thrown when an on-chain transaction reverted
 */
export class TransactionFailedError extends MinaError {
  readonly code = 'TRANSACTION_FAILED' as const;
  readonly recoverable = true as const;
  readonly txHash?: string;
  readonly chainId: number;
  readonly reason?: string;

  constructor(
    message: string,
    details: {
      txHash?: string;
      chainId: number;
      reason?: string;
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step,
      userMessage: details.reason
        ? `Transaction failed: ${details.reason}. You can try again.`
        : 'Transaction failed. You can try again.',
      recoveryAction: 'retry',
      details,
    });
    this.txHash = details.txHash;
    this.chainId = details.chainId;
    this.reason = details.reason;
  }
}

/**
 * Error thrown when user rejected the wallet prompt/transaction
 */
export class UserRejectedError extends MinaError {
  readonly code = 'USER_REJECTED' as const;
  readonly recoverable = false as const;

  constructor(
    message: string = 'User rejected the transaction',
    details?: { step?: StepType }
  ) {
    super(message, {
      step: details?.step,
      userMessage: 'Transaction was rejected. Click "Try Again" to start over.',
      recoveryAction: 'try_again',
      details,
    });
  }
}

/**
 * Error thrown when RPC or API communication fails
 */
export class NetworkError extends MinaError {
  readonly code = 'NETWORK_ERROR' as const;
  readonly recoverable = true as const;
  readonly endpoint?: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    details: {
      endpoint?: string;
      statusCode?: number;
      step?: StepType;
    } = {}
  ) {
    super(message, {
      step: details.step,
      userMessage: 'Network connection issue. Please check your connection and try again.',
      recoveryAction: 'retry',
      details,
    });
    this.endpoint = details.endpoint;
    this.statusCode = details.statusCode;
  }
}

/**
 * Error thrown when Hyperliquid deposit step fails
 */
export class DepositFailedError extends MinaError {
  readonly code = 'DEPOSIT_FAILED' as const;
  readonly recoverable = true as const;
  readonly bridgeTxHash?: string;
  readonly depositTxHash?: string;
  readonly amount: string;

  constructor(
    message: string,
    details: {
      bridgeTxHash?: string;
      depositTxHash?: string;
      amount: string;
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step || 'deposit',
      userMessage: 'Deposit to Hyperliquid failed. Your funds are safe on HyperEVM. You can retry the deposit.',
      recoveryAction: 'retry',
      details,
    });
    this.bridgeTxHash = details.bridgeTxHash;
    this.depositTxHash = details.depositTxHash;
    this.amount = details.amount;
  }
}

/**
 * Maximum number of retry attempts
 */
export const MAX_RETRIES = 3;

/**
 * Error thrown when maximum retry attempts have been exceeded
 */
export class MaxRetriesExceededError extends MinaError {
  readonly code = 'MAX_RETRIES_EXCEEDED' as const;
  readonly recoverable = false as const;
  readonly previousErrors: Error[];
  readonly executionId: string;

  constructor(
    message: string,
    details: {
      executionId: string;
      previousErrors: Error[];
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step,
      userMessage: `Maximum retry attempts (${MAX_RETRIES}) exceeded. Please contact support or try a new transaction.`,
      recoveryAction: 'contact_support',
      details: {
        executionId: details.executionId,
        errorCount: details.previousErrors.length,
      },
    });
    this.executionId = details.executionId;
    this.previousErrors = details.previousErrors;
  }
}

/**
 * Error thrown when quote has expired
 */
export class QuoteExpiredError extends MinaError {
  readonly code = 'QUOTE_EXPIRED' as const;
  readonly recoverable = true as const;
  readonly quoteId: string;
  readonly expiredAt: number;

  constructor(
    message: string,
    details: {
      quoteId: string;
      expiredAt: number;
      step?: StepType;
    }
  ) {
    super(message, {
      step: details.step,
      userMessage: 'Your quote has expired. Please get a new quote to continue.',
      recoveryAction: 'fetch_new_quote',
      details,
    });
    this.quoteId = details.quoteId;
    this.expiredAt = details.expiredAt;
  }
}

/**
 * Error thrown when chain fetching fails (re-exported from chain service for convenience)
 */
export { ChainFetchError } from './services/chain';

/**
 * Type guard to check if an error is a MinaError
 */
export function isMinaError(error: unknown): error is MinaError {
  return error instanceof MinaError;
}

/**
 * Type guard to check for specific error types
 */
export function isInsufficientBalanceError(error: unknown): error is InsufficientBalanceError {
  return error instanceof InsufficientBalanceError;
}

export function isNoRouteFoundError(error: unknown): error is NoRouteFoundError {
  return error instanceof NoRouteFoundError;
}

export function isSlippageExceededError(error: unknown): error is SlippageExceededError {
  return error instanceof SlippageExceededError;
}

export function isInvalidSlippageError(error: unknown): error is InvalidSlippageError {
  return error instanceof InvalidSlippageError;
}

export function isTransactionFailedError(error: unknown): error is TransactionFailedError {
  return error instanceof TransactionFailedError;
}

export function isUserRejectedError(error: unknown): error is UserRejectedError {
  return error instanceof UserRejectedError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isDepositFailedError(error: unknown): error is DepositFailedError {
  return error instanceof DepositFailedError;
}

export function isMaxRetriesExceededError(error: unknown): error is MaxRetriesExceededError {
  return error instanceof MaxRetriesExceededError;
}

export function isQuoteExpiredError(error: unknown): error is QuoteExpiredError {
  return error instanceof QuoteExpiredError;
}

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof MinaError) {
    return error.recoverable;
  }
  return false;
}

/**
 * Normalize any error to a MinaError with proper typing
 * @param error - Any error to normalize
 * @param step - Optional step context
 */
export function normalizeError(error: unknown, step?: StepType): MinaError {
  // Already a MinaError
  if (error instanceof MinaError) {
    return error;
  }

  // Handle wallet rejection errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // User rejection patterns from various wallets
    if (
      message.includes('user rejected') ||
      message.includes('user denied') ||
      message.includes('rejected by user') ||
      message.includes('user cancelled')
    ) {
      return new UserRejectedError('User rejected the transaction', { step });
    }

    // Insufficient funds patterns
    if (
      message.includes('insufficient funds') ||
      message.includes('insufficient balance')
    ) {
      return new InsufficientBalanceError('Insufficient balance for transaction', {
        required: 'unknown',
        available: 'unknown',
        token: 'unknown',
        step,
      });
    }

    // Network error patterns
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('fetch failed') ||
      message.includes('connection')
    ) {
      return new NetworkError(error.message, { step });
    }

    // Transaction failed patterns
    if (
      message.includes('transaction failed') ||
      message.includes('reverted') ||
      message.includes('execution reverted')
    ) {
      return new TransactionFailedError(error.message, {
        chainId: 0,
        reason: error.message,
        step,
      });
    }
  }

  // Generic fallback
  return new TransactionFailedError(
    error instanceof Error ? error.message : String(error),
    {
      chainId: 0,
      reason: 'Unknown error',
      step,
    }
  );
}
