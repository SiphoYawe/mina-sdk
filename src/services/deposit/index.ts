/**
 * Deposit services for Hyperliquid integration
 *
 * This module provides functionality for:
 * - Detecting USDC arrival on HyperEVM after bridging
 * - Executing deposits from HyperEVM to Hyperliquid L1 (HyperCore)
 */

// USDC Arrival Detection
export {
  detectUsdcArrival,
  detectUsdcArrivalFromSnapshot,
  snapshotUsdcBalance,
  checkUsdcBalance,
  UsdcArrivalTimeoutError,
  isUsdcArrivalTimeoutError,
  ARRIVAL_DETECTION_TIMEOUT_MS,
  ARRIVAL_POLL_INTERVAL_MS,
} from './detect-arrival';

export type {
  UsdcArrivalResult,
  DetectionOptions,
} from './detect-arrival';

// Deposit Execution (HyperEVM → HyperCore)
export {
  executeDeposit,
  executeDepositFor,
  validateDepositRequirements,
  approveUsdcForDeposit,
  checkDepositAllowance,
  // Constants
  CORE_DEPOSIT_WALLET_ADDRESS,
  MINIMUM_DEPOSIT_AMOUNT,
  DestinationDex,
  CORE_DEPOSIT_WALLET_ABI,
  ERC20_ABI,
  // Error classes
  MinimumDepositError,
  InsufficientGasError,
  DepositTransactionError,
  InvalidDepositAddressError,
  // Type guards
  isMinimumDepositError,
  isInsufficientGasError,
  isDepositTransactionError,
  isInvalidDepositAddressError,
} from './execute-deposit';

export type {
  DepositOptions,
  DepositResult,
  DepositStatus,
  DepositValidation,
  DepositSigner,
  DestinationDexType,
} from './execute-deposit';
