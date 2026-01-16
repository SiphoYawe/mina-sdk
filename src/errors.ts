/**
 * Error types for @mina-bridge/sdk
 *
 * Each error includes:
 * - code: Unique error code for programmatic handling
 * - message: Human-readable error message
 * - details: Additional context when available
 */

/**
 * Base error class for all Mina SDK errors
 */
export abstract class MinaError extends Error {
  abstract readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
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
  readonly required: string;
  readonly available: string;
  readonly token: string;

  constructor(
    message: string,
    details: {
      required: string;
      available: string;
      token: string;
    }
  ) {
    super(message, details);
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
    }
  ) {
    super(message, details);
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
  readonly expectedAmount: string;
  readonly actualAmount: string;
  readonly slippageTolerance: number;

  constructor(
    message: string,
    details: {
      expectedAmount: string;
      actualAmount: string;
      slippageTolerance: number;
    }
  ) {
    super(message, details);
    this.expectedAmount = details.expectedAmount;
    this.actualAmount = details.actualAmount;
    this.slippageTolerance = details.slippageTolerance;
  }
}

/**
 * Error thrown when an on-chain transaction reverted
 */
export class TransactionFailedError extends MinaError {
  readonly code = 'TRANSACTION_FAILED' as const;
  readonly txHash?: string;
  readonly chainId: number;
  readonly reason?: string;

  constructor(
    message: string,
    details: {
      txHash?: string;
      chainId: number;
      reason?: string;
    }
  ) {
    super(message, details);
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
  readonly step?: string;

  constructor(message: string = 'User rejected the transaction', details?: { step?: string }) {
    super(message, details);
    this.step = details?.step;
  }
}

/**
 * Error thrown when RPC or API communication fails
 */
export class NetworkError extends MinaError {
  readonly code = 'NETWORK_ERROR' as const;
  readonly endpoint?: string;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    details: {
      endpoint?: string;
      statusCode?: number;
      retryable?: boolean;
    } = {}
  ) {
    super(message, details);
    this.endpoint = details.endpoint;
    this.statusCode = details.statusCode;
    this.retryable = details.retryable ?? true;
  }
}

/**
 * Error thrown when Hyperliquid deposit step fails
 */
export class DepositFailedError extends MinaError {
  readonly code = 'DEPOSIT_FAILED' as const;
  readonly bridgeTxHash?: string;
  readonly depositTxHash?: string;
  readonly amount: string;

  constructor(
    message: string,
    details: {
      bridgeTxHash?: string;
      depositTxHash?: string;
      amount: string;
    }
  ) {
    super(message, details);
    this.bridgeTxHash = details.bridgeTxHash;
    this.depositTxHash = details.depositTxHash;
    this.amount = details.amount;
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
