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
  GasEstimate,
  ExecuteOptions,
  ExecutionResult,
  TransactionStatus,
  Balance,
} from './types';

// Constants
export {
  HYPEREVM_CHAIN_ID,
  HYPERLIQUID_CHAIN_ID,
  NATIVE_TOKEN_ADDRESS,
  DEFAULT_SLIPPAGE,
  LIFI_API_URL,
  HYPEREVM_USDC_ADDRESS,
} from './constants';
