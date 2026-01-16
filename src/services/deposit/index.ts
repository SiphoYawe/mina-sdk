/**
 * Deposit services for Hyperliquid integration
 *
 * This module provides functionality for:
 * - Detecting USDC arrival on HyperEVM after bridging
 * - Executing deposits from HyperEVM to Hyperliquid L1 (HyperCore)
 * - Monitoring deposit confirmation on Hyperliquid L1
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

// L1 Deposit Monitoring (HyperEVM deposit → Hyperliquid L1 confirmation)
export {
  monitorL1Confirmation,
  waitForL1Confirmation,
  getHyperliquidBalance,
  getL1TradingBalance,
  checkHyperliquidAccountExists,
  createBridgeCompleteSummary,
  // Constants
  HYPERLIQUID_INFO_API,
  L1_CONFIRMATION_TIMEOUT_MS,
  L1_HARD_MAX_TIMEOUT_MS,
  L1_POLL_INTERVAL_MS,
  L1_USDC_DECIMALS,
  // Error classes
  L1MonitorCancelledError,
  InvalidL1AddressError,
  // Type guards
  isL1MonitorCancelledError,
  isInvalidL1AddressError,
} from './monitor-l1';

export type {
  L1MonitorOptions,
  L1MonitorProgress,
  L1TimeoutWarning,
  L1ConfirmationResult,
  L1MonitorController,
  CompletedStep,
  BridgeCompleteSummary,
} from './monitor-l1';
