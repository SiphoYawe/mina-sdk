/**
 * Chain IDs for Hyperliquid ecosystem
 */
export const HYPEREVM_CHAIN_ID = 999;
export const HYPERLIQUID_CHAIN_ID = 1337;

/**
 * Native token address (zero address for native gas token)
 */
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Default slippage tolerance (0.5%)
 */
export const DEFAULT_SLIPPAGE = 0.005;

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
