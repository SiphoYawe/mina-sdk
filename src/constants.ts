/**
 * Chain IDs for Hyperliquid ecosystem
 */
export const HYPEREVM_CHAIN_ID = 999;
export const HYPEREVM_TESTNET_CHAIN_ID = 998;
export const HYPERLIQUID_CHAIN_ID = 1337;

/**
 * Network type
 */
export type HyperliquidNetwork = 'mainnet' | 'testnet';

/**
 * Network configuration for mainnet and testnet
 */
export interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  infoUrl: string;
  explorerUrl: string;
}

/**
 * Network configurations for Hyperliquid ecosystem
 */
export const NETWORK_CONFIG: Record<HyperliquidNetwork, NetworkConfig> = {
  mainnet: {
    chainId: 999,
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    apiUrl: 'https://api.hyperliquid.xyz',
    infoUrl: 'https://api.hyperliquid.xyz/info',
    explorerUrl: 'https://explorer.hyperliquid.xyz',
  },
  testnet: {
    chainId: 998,
    rpcUrl: 'https://rpc.hyperliquid-testnet.xyz/evm',
    apiUrl: 'https://api.hyperliquid-testnet.xyz',
    infoUrl: 'https://api.hyperliquid-testnet.xyz/info',
    explorerUrl: 'https://explorer.hyperliquid-testnet.xyz',
  },
};

/**
 * Get network configuration by chain ID
 * @param chainId - The chain ID (998 for testnet, 999 for mainnet)
 * @returns The network configuration
 */
export function getNetworkConfig(chainId: number): NetworkConfig {
  if (chainId === HYPEREVM_TESTNET_CHAIN_ID) {
    return NETWORK_CONFIG.testnet;
  }
  return NETWORK_CONFIG.mainnet;
}

/**
 * Get network type from chain ID
 * @param chainId - The chain ID
 * @returns 'testnet' or 'mainnet'
 */
export function getNetworkType(chainId: number): HyperliquidNetwork {
  return chainId === HYPEREVM_TESTNET_CHAIN_ID ? 'testnet' : 'mainnet';
}

/**
 * Native token address (zero address for native gas token)
 */
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Slippage tolerance configuration (PERCENTAGE FORMAT)
 * Values are in percentage format (0.5 = 0.5%)
 * Used by the new slippageTolerance parameter
 */
/** Minimum allowed slippage tolerance: 0.01% */
export const MIN_SLIPPAGE_PERCENT = 0.01;
/** Maximum allowed slippage tolerance: 5% */
export const MAX_SLIPPAGE_PERCENT = 5.0;
/** Default slippage tolerance: 0.5% */
export const DEFAULT_SLIPPAGE_PERCENT = 0.5;
/** Preset slippage options: 0.1%, 0.5%, 1.0% */
export const SLIPPAGE_PRESETS_PERCENT = [0.1, 0.5, 1.0] as const;

/**
 * Slippage tolerance configuration (DECIMAL FORMAT)
 * Values are in decimal format (0.005 = 0.5%)
 * @deprecated Used by the legacy slippage parameter for backward compatibility
 */
/** Minimum allowed slippage tolerance (0.01%) */
export const MIN_SLIPPAGE = 0.0001;
/** Maximum allowed slippage tolerance (5%) */
export const MAX_SLIPPAGE = 0.05;
/** Default slippage tolerance (0.5%) */
export const DEFAULT_SLIPPAGE = 0.005;
/** Preset slippage options in decimal format */
export const SLIPPAGE_PRESETS = [0.001, 0.005, 0.01] as const; // 0.1%, 0.5%, 1.0%

/**
 * Convert slippage from percentage to decimal format
 * @param percent - Slippage in percentage (0.5 = 0.5%)
 * @returns Slippage in decimal (0.005 = 0.5%)
 */
export function slippagePercentToDecimal(percent: number): number {
  return percent / 100;
}

/**
 * Convert slippage from decimal to percentage format
 * @param decimal - Slippage in decimal (0.005 = 0.5%)
 * @returns Slippage in percentage (0.5 = 0.5%)
 */
export function slippageDecimalToPercent(decimal: number): number {
  return decimal * 100;
}

/**
 * USDC address on HyperEVM (Circle USDC Token)
 * @see https://hyperevmscan.io/address/0xb88339cb7199b77e23db6e890353e22632ba630f
 */
export const HYPEREVM_USDC_ADDRESS = '0xb88339cb7199b77e23db6e890353e22632ba630f' as const;

/**
 * API endpoints
 */
export const LIFI_API_URL = 'https://li.quest/v1';

/**
 * API request timeout configuration (in milliseconds)
 * These are centralized to ensure consistent timeout behavior across services
 */
/** Timeout for chain-related API requests - shorter as chains endpoint is faster */
export const CHAIN_API_TIMEOUT_MS = 10000; // 10 seconds
/** Timeout for token-related API requests - longer as tokens endpoint can be slow */
export const TOKEN_API_TIMEOUT_MS = 15000; // 15 seconds
/** Timeout for balance-related API requests */
export const BALANCE_API_TIMEOUT_MS = 10000; // 10 seconds

/** Timeout for quote-related API requests - longer as quote computation can be slow */
export const QUOTE_API_TIMEOUT_MS = 30000; // 30 seconds (default)

/**
 * Cache TTL configuration (in milliseconds)
 */
/** Balance cache TTL - short for real-time balance updates */
export const BALANCE_CACHE_TTL_MS = 10000; // 10 seconds
/** Debounce window for rapid balance requests */
export const BALANCE_DEBOUNCE_MS = 300; // 300 milliseconds
/** Quote cache TTL - short for real-time quotes */
export const QUOTE_CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Price impact thresholds (as decimal, 0.01 = 1%)
 */
/** Low price impact threshold - negligible impact */
export const PRICE_IMPACT_LOW = 0.001; // 0.1%
/** Medium price impact threshold - acceptable impact */
export const PRICE_IMPACT_MEDIUM = 0.005; // 0.5%
/** High price impact threshold - warning level */
export const PRICE_IMPACT_HIGH = 0.01; // 1%
/** Very high price impact threshold - danger level */
export const PRICE_IMPACT_VERY_HIGH = 0.03; // 3%
