/**
 * @mina-bridge/sdk
 * Cross-chain bridge SDK for Hyperliquid
 */

export const SDK_VERSION = '1.3.1';

// Main client
export { Mina } from './client';

// Types
export type {
  MinaConfig,
  Chain,
  Token,
  Quote,
  QuoteParams,
  Step,
  StepStatus,
  StepStatusPayload,
  TransactionStatusPayload,
  Fees,
  FeeItem,
  GasEstimate,
  StepGas,
  ExecuteOptions,
  ExecutionResult,
  TransactionStatus,
  Balance,
  TransactionSigner,
  TransactionRequestData,
  ExecutionStatusType,
  StepType,
  OnStepChange,
  OnStatusChange,
  SlippagePreset,
  RoutePreference,
  RouteComparison,
} from './types';

// Slippage constraints for validation
export { SLIPPAGE_CONSTRAINTS } from './types';

// Event system
export {
  SDKEventEmitter,
  SDK_EVENTS,
  calculateProgress,
  mapSubstatusToMessage,
} from './events';

export type {
  SDKEventName,
  SDKEventPayloads,
} from './events';

// Execution store for status tracking
export {
  executionStore,
  generateExecutionId,
} from './execution-store';

export type {
  ExecutionState,
  ExecutionStatusResult,
} from './execution-store';

// Chain response type with metadata
export type { ChainsResponse } from './services/chain';

// Token response type with metadata
export type { TokensResponse } from './services/token';

// Constants
export {
  HYPEREVM_CHAIN_ID,
  HYPERLIQUID_CHAIN_ID,
  NATIVE_TOKEN_ADDRESS,
  DEFAULT_SLIPPAGE,
  LIFI_API_URL,
  HYPEREVM_USDC_ADDRESS,
  // Price impact thresholds
  PRICE_IMPACT_LOW,
  PRICE_IMPACT_MEDIUM,
  PRICE_IMPACT_HIGH,
  PRICE_IMPACT_VERY_HIGH,
} from './constants';

// Errors - all documented error types
export {
  // Base error class
  MinaError,
  // Specific error types
  InsufficientBalanceError,
  NoRouteFoundError,
  SlippageExceededError,
  InvalidSlippageError,
  TransactionFailedError,
  UserRejectedError,
  NetworkError,
  DepositFailedError,
  ChainFetchError,
  MaxRetriesExceededError,
  QuoteExpiredError as QuoteExpiredErrorFromErrors,
  // Type guards
  isMinaError,
  isInsufficientBalanceError,
  isNoRouteFoundError,
  isSlippageExceededError,
  isInvalidSlippageError,
  isTransactionFailedError,
  isUserRejectedError,
  isNetworkError,
  isDepositFailedError,
  isMaxRetriesExceededError,
  isQuoteExpiredError as isQuoteExpiredErrorFromErrors,
  isRecoverableError,
  // Error normalization
  normalizeError,
  // Recovery actions
  RECOVERY_ACTIONS,
  // Constants
  MAX_RETRIES,
} from './errors';

// Recovery action type
export type { RecoveryAction } from './errors';

// Token fetch error from token service
export { TokenFetchError } from './services/token';

// Balance errors from balance service
export { BalanceFetchError, InvalidAddressError } from './services/balance';

// Quote errors and type guards from quote service
export {
  QuoteFetchError,
  InvalidQuoteParamsError,
  isQuoteFetchError,
  isInvalidQuoteParamsError,
} from './services/quote';

// Standalone chain discovery functions (for use without Mina client)
export {
  getChains,
  getDestinationChains,
  getChainsByRoutes,
  getChainById,
  invalidateChainCache,
  createChainCache,
  resetDefaultCache,
  HYPEREVM_CHAIN,
} from './services/chain';

// Export ChainCache class for advanced usage
export { ChainCache } from './services/chain';

// Standalone token discovery functions (for use without Mina client)
export {
  getTokens,
  getBridgeableTokens,
  getDestinationTokens,
  getTokenByAddress,
  invalidateTokenCache,
  createTokenCache,
  resetDefaultTokenCache,
  HYPEREVM_DESTINATION_TOKENS,
} from './services/token';

// Export TokenCache class for advanced usage
export { TokenCache } from './services/token';

// Standalone balance functions (for use without Mina client)
export {
  getBalance,
  getBalanceWithMetadata,
  getBalances,
  getChainBalances,
  validateBalance,
  checkBalance,
  invalidateBalanceCache,
  createBalanceCache,
  resetDefaultBalanceCache,
} from './services/balance';

// Export BalanceCache class for advanced usage
export { BalanceCache } from './services/balance';

// Balance types with metadata
export type {
  BalanceParams,
  MultiBalanceParams,
  BalanceWithMetadata,
  BalancesResponse,
  SingleBalanceResponse,
  BalanceValidation,
  BalanceWarning,
  BalanceWarningType,
  BalanceCheckResult,
} from './services/balance';

// Standalone quote functions (for use without Mina client)
export {
  getQuote,
  getQuotes,
  estimatePriceImpact,
  invalidateQuoteCache,
  createQuoteCache,
  resetDefaultQuoteCache,
} from './services/quote';

// Export QuoteCache class for advanced usage
export { QuoteCache } from './services/quote';

// Quote types with metadata
export type {
  QuoteResponse,
  QuotesResponse,
  PriceImpactEstimate,
} from './services/quote';

// Execute service - transaction execution
export {
  execute,
  validateQuote,
  QuoteExpiredError,
  InvalidQuoteError,
  isQuoteExpiredError,
  isInvalidQuoteError,
} from './services/execute';

// Execute types
export type { ExecuteConfig, ExecutionStatus } from './services/execute';

// USDC Arrival Detection - for detecting bridged funds on HyperEVM
export {
  detectUsdcArrival,
  detectUsdcArrivalFromSnapshot,
  snapshotUsdcBalance,
  checkUsdcBalance,
  UsdcArrivalTimeoutError,
  isUsdcArrivalTimeoutError,
  ARRIVAL_DETECTION_TIMEOUT_MS,
  ARRIVAL_POLL_INTERVAL_MS,
} from './services/deposit';

// USDC Arrival types
export type { UsdcArrivalResult, DetectionOptions } from './services/deposit';

// Deposit Execution - for depositing USDC from HyperEVM to Hyperliquid L1 (HyperCore)
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
} from './services/deposit';

// Deposit execution types
export type {
  DepositOptions,
  DepositResult,
  DepositStatus,
  DepositValidation,
  DepositSigner,
  DestinationDexType,
} from './services/deposit';

// L1 Deposit Monitoring - for confirming deposits on Hyperliquid L1
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
} from './services/deposit';

// L1 Monitoring types
export type {
  L1MonitorOptions,
  L1MonitorProgress,
  L1TimeoutWarning,
  L1ConfirmationResult,
  L1MonitorController,
  CompletedStep,
  BridgeCompleteSummary,
} from './services/deposit';
