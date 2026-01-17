/**
 * SDK Configuration Store
 * Stores global configuration like API keys
 */

/**
 * Internal SDK configuration
 */
interface SDKConfig {
  /** LI.FI API key for higher rate limits */
  lifiApiKey?: string;
  /** Integrator identifier */
  integrator?: string;
}

/**
 * Global configuration store
 */
let sdkConfig: SDKConfig = {};

/**
 * Set the SDK configuration
 * Called internally by the Mina client constructor
 */
export function setSDKConfig(config: SDKConfig): void {
  sdkConfig = { ...sdkConfig, ...config };
}

/**
 * Get the current SDK configuration
 */
export function getSDKConfig(): SDKConfig {
  return sdkConfig;
}

/**
 * Get LI.FI API headers including API key if configured
 */
export function getLifiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (sdkConfig.lifiApiKey) {
    headers['x-lifi-api-key'] = sdkConfig.lifiApiKey;
  }

  if (sdkConfig.integrator) {
    headers['x-lifi-integrator'] = sdkConfig.integrator;
  }

  return headers;
}

/**
 * Reset SDK configuration (for testing)
 */
export function resetSDKConfig(): void {
  sdkConfig = {};
}
