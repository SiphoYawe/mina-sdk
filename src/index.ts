/**
 * @mina-bridge/sdk
 * Cross-chain bridge SDK for Hyperliquid
 */

export const SDK_VERSION = '0.0.1';

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
  Fees,
  FeeItem,
  GasEstimate,
  StepGas,
  ExecuteOptions,
  ExecutionResult,
  TransactionStatus,
  Balance,
} from './types';

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
  TransactionFailedError,
  UserRejectedError,
  NetworkError,
  DepositFailedError,
  ChainFetchError,
  // Type guards
  isMinaError,
  isInsufficientBalanceError,
  isNoRouteFoundError,
  isSlippageExceededError,
  isTransactionFailedError,
  isUserRejectedError,
  isNetworkError,
  isDepositFailedError,
} from './errors';

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
