/**
 * Quote Service
 * Fetches optimal bridge routes from LI.FI API
 */

import type { Token, Quote, QuoteParams, Step, Fees, FeeItem, GasEstimate, StepGas } from '../types';
import {
  LIFI_API_URL,
  HYPEREVM_CHAIN_ID,
  QUOTE_API_TIMEOUT_MS,
  QUOTE_CACHE_TTL_MS,
  DEFAULT_SLIPPAGE,
  PRICE_IMPACT_LOW,
  PRICE_IMPACT_MEDIUM,
  PRICE_IMPACT_HIGH,
  PRICE_IMPACT_VERY_HIGH,
} from '../constants';
import { MinaError, NoRouteFoundError, NetworkError } from '../errors';
import { getChainById, ChainCache, createChainCache } from './chain';

/**
 * LI.FI API Quote response types
 */
interface LifiToken {
  address: string;
  decimals: number;
  symbol: string;
  chainId: number;
  name: string;
  logoURI?: string;
  priceUSD?: string;
}

interface LifiGasCost {
  type: string;
  price?: string;
  estimate?: string;
  limit?: string;
  amount: string;
  amountUSD?: string;
  token: LifiToken;
}

interface LifiFeeCost {
  name: string;
  description?: string;
  percentage?: string;
  token: LifiToken;
  amount: string;
  amountUSD?: string;
  included?: boolean;
}

interface LifiAction {
  fromChainId: number;
  toChainId: number;
  fromToken: LifiToken;
  toToken: LifiToken;
  fromAmount: string;
  slippage?: number;
  fromAddress?: string;
  toAddress?: string;
}

interface LifiEstimate {
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  approvalAddress?: string;
  executionDuration: number;
  gasCosts?: LifiGasCost[];
  feeCosts?: LifiFeeCost[];
  fromAmountUSD?: string;
  toAmountUSD?: string;
}

interface LifiStep {
  id: string;
  type: 'swap' | 'cross' | 'lifi' | 'protocol';
  tool: string;
  toolDetails?: {
    key: string;
    name: string;
    logoURI?: string;
  };
  action: LifiAction;
  estimate: LifiEstimate;
  includedSteps?: LifiStep[];
}

interface LifiQuoteResponse {
  id: string;
  type: string;
  tool: string;
  toolDetails?: {
    key: string;
    name: string;
    logoURI?: string;
  };
  action: LifiAction;
  estimate: LifiEstimate;
  includedSteps?: LifiStep[];
  transactionRequest?: {
    to: string;
    from: string;
    data: string;
    value: string;
    gasPrice?: string;
    gasLimit?: string;
    chainId: number;
  };
}

/**
 * LI.FI Routes API response - routes have a different structure
 */
interface LifiRoute {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: LifiToken;
  toToken: LifiToken;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  toAmountUSD?: string;
  fromAmountUSD?: string;
  gasCostUSD?: string;
  steps: LifiStep[];
  insurance?: {
    state: string;
    feeAmountUsd: string;
  };
  tags?: string[];
}

interface LifiRoutesResponse {
  routes: LifiRoute[];
}

/**
 * Error thrown when quote fetching fails
 */
export class QuoteFetchError extends MinaError {
  readonly code = 'QUOTE_FETCH_FAILED' as const;
  readonly recoverable = true as const;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      userMessage: 'Failed to fetch quote. Please try again.',
      recoveryAction: 'retry',
      details,
    });
    this.name = 'QuoteFetchError';
  }
}

/**
 * Error thrown when quote parameters are invalid
 */
export class InvalidQuoteParamsError extends MinaError {
  readonly code = 'INVALID_QUOTE_PARAMS' as const;
  readonly recoverable = false as const;
  readonly param: string;
  readonly reason: string;

  constructor(param: string, reason: string) {
    super(`Invalid quote parameter '${param}': ${reason}`, {
      userMessage: `Invalid ${param}: ${reason}`,
      recoveryAction: 'try_different_amount',
      details: { param, reason },
    });
    this.name = 'InvalidQuoteParamsError';
    this.param = param;
    this.reason = reason;
  }
}

/**
 * Response with metadata for quote queries
 */
export interface QuoteResponse {
  /** Quote data */
  quote: Quote;
  /** Whether the quote is from stale cache */
  isStale: boolean;
  /** Timestamp when quote was cached (null if fresh from API) */
  cachedAt: number | null;
}

/**
 * Response for multiple quotes
 */
export interface QuotesResponse {
  /** Array of quotes sorted by recommendation */
  quotes: Quote[];
  /** Recommended quote index */
  recommendedIndex: number;
}

/**
 * Cache entry for quotes
 */
interface QuoteCacheEntry {
  quote: Quote;
  timestamp: number;
  params: QuoteParams;
}

/**
 * Quote cache for request deduplication
 */
class QuoteCache {
  private cache: Map<string, QuoteCacheEntry> = new Map();

  /**
   * Generate cache key from params
   */
  private getKey(params: QuoteParams): string {
    return `${params.fromChainId}-${params.toChainId}-${params.fromToken}-${params.toToken}-${params.fromAmount}-${params.fromAddress}-${params.slippage ?? DEFAULT_SLIPPAGE}`;
  }

  /**
   * Get cached quote if not expired
   */
  get(params: QuoteParams): Quote | null {
    const key = this.getKey(params);
    const entry = this.cache.get(key);

    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > QUOTE_CACHE_TTL_MS;
    if (isExpired) {
      return null; // Don't delete - keep for stale fallback
    }

    return entry.quote;
  }

  /**
   * Get cached quote even if expired (for stale fallback)
   * Only returns if the quote hasn't expired yet
   */
  getStale(params: QuoteParams): { quote: Quote; cachedAt: number } | null {
    const key = this.getKey(params);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // For quotes, only return stale if the quote itself hasn't expired
    if (entry.quote.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return {
      quote: entry.quote,
      cachedAt: entry.timestamp,
    };
  }

  /**
   * Store quote in cache
   */
  set(params: QuoteParams, quote: Quote): void {
    const key = this.getKey(params);
    this.cache.set(key, {
      quote,
      timestamp: Date.now(),
      params,
    });
  }

  /**
   * Invalidate all cached quotes
   */
  invalidate(): void {
    this.cache.clear();
  }
}

/**
 * Factory function to create a new cache instance
 */
export function createQuoteCache(): QuoteCache {
  return new QuoteCache();
}

/**
 * Default cache instance for standalone function usage
 */
let defaultCache: QuoteCache | null = null;

function getDefaultCache(): QuoteCache {
  if (!defaultCache) {
    defaultCache = new QuoteCache();
  }
  return defaultCache;
}

/**
 * Reset the default cache instance (for testing)
 */
export function resetDefaultQuoteCache(): void {
  defaultCache = null;
}

/**
 * Shared chain cache for validation
 */
let sharedChainCache: ChainCache | null = null;

function getSharedChainCache(): ChainCache {
  if (!sharedChainCache) {
    sharedChainCache = createChainCache();
  }
  return sharedChainCache;
}

/**
 * Create a fetch request with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = QUOTE_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout: LI.FI API did not respond within ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Validate quote parameters including chain support
 */
async function validateQuoteParams(params: QuoteParams, chainCache?: ChainCache): Promise<void> {
  if (!params.fromChainId || params.fromChainId <= 0) {
    throw new InvalidQuoteParamsError('fromChainId', 'Must be a positive chain ID');
  }

  if (!params.toChainId || params.toChainId <= 0) {
    throw new InvalidQuoteParamsError('toChainId', 'Must be a positive chain ID');
  }

  // Validate chains are supported (Issue 1 fix)
  const cache = chainCache ?? getSharedChainCache();

  const fromChain = await getChainById(params.fromChainId, cache);
  if (!fromChain && params.fromChainId !== HYPEREVM_CHAIN_ID) {
    throw new InvalidQuoteParamsError(
      'fromChainId',
      `Chain ${params.fromChainId} is not supported`
    );
  }

  const toChain = await getChainById(params.toChainId, cache);
  if (!toChain && params.toChainId !== HYPEREVM_CHAIN_ID) {
    throw new InvalidQuoteParamsError(
      'toChainId',
      `Chain ${params.toChainId} is not supported`
    );
  }

  if (!params.fromToken || !/^0x[a-fA-F0-9]{40}$/.test(params.fromToken)) {
    throw new InvalidQuoteParamsError('fromToken', 'Must be a valid Ethereum address');
  }

  if (!params.toToken || !/^0x[a-fA-F0-9]{40}$/.test(params.toToken)) {
    throw new InvalidQuoteParamsError('toToken', 'Must be a valid Ethereum address');
  }

  if (!params.fromAmount || params.fromAmount === '0') {
    throw new InvalidQuoteParamsError('fromAmount', 'Must be a non-zero amount');
  }

  // Validate fromAmount is a valid number string
  try {
    const amount = BigInt(params.fromAmount);
    if (amount <= 0n) {
      throw new InvalidQuoteParamsError('fromAmount', 'Must be a positive amount');
    }
  } catch (e) {
    if (e instanceof InvalidQuoteParamsError) throw e;
    throw new InvalidQuoteParamsError('fromAmount', 'Must be a valid numeric string');
  }

  if (!params.fromAddress || !/^0x[a-fA-F0-9]{40}$/.test(params.fromAddress)) {
    throw new InvalidQuoteParamsError('fromAddress', 'Must be a valid Ethereum address');
  }

  if (params.slippage !== undefined) {
    if (params.slippage < 0 || params.slippage > 1) {
      throw new InvalidQuoteParamsError('slippage', 'Must be between 0 and 1 (e.g., 0.005 for 0.5%)');
    }
  }
}

/**
 * Map LI.FI token to our Token type
 */
function mapLifiToken(lifiToken: LifiToken): Token {
  return {
    address: lifiToken.address,
    symbol: lifiToken.symbol,
    name: lifiToken.name,
    decimals: lifiToken.decimals,
    logoUrl: lifiToken.logoURI ?? '',
    chainId: lifiToken.chainId,
    priceUsd: lifiToken.priceUSD ? parseFloat(lifiToken.priceUSD) : undefined,
  };
}

/**
 * Map LI.FI step type to our Step type
 */
function mapStepType(lifiType: string): 'swap' | 'bridge' | 'deposit' | 'approve' {
  switch (lifiType) {
    case 'swap':
      return 'swap';
    case 'cross':
    case 'bridge':
      return 'bridge';
    case 'protocol':
    case 'lifi':
    default:
      return 'bridge';
  }
}

/**
 * Extract steps from LI.FI quote response (flatten nested steps)
 */
function extractStepsFromQuote(lifiResponse: LifiQuoteResponse): Step[] {
  const steps: Step[] = [];

  // If there are included steps, extract from those
  if (lifiResponse.includedSteps && lifiResponse.includedSteps.length > 0) {
    for (const lifiStep of lifiResponse.includedSteps) {
      steps.push({
        id: lifiStep.id,
        type: mapStepType(lifiStep.type),
        tool: lifiStep.toolDetails?.name ?? lifiStep.tool,
        toolLogoUrl: lifiStep.toolDetails?.logoURI,
        fromChainId: lifiStep.action.fromChainId,
        toChainId: lifiStep.action.toChainId,
        fromToken: mapLifiToken(lifiStep.action.fromToken),
        toToken: mapLifiToken(lifiStep.action.toToken),
        fromAmount: lifiStep.estimate.fromAmount,
        toAmount: lifiStep.estimate.toAmount,
        estimatedTime: lifiStep.estimate.executionDuration,
      });
    }
  } else {
    // Single step quote
    steps.push({
      id: lifiResponse.id,
      type: mapStepType(lifiResponse.type),
      tool: lifiResponse.toolDetails?.name ?? lifiResponse.tool,
      toolLogoUrl: lifiResponse.toolDetails?.logoURI,
      fromChainId: lifiResponse.action.fromChainId,
      toChainId: lifiResponse.action.toChainId,
      fromToken: mapLifiToken(lifiResponse.action.fromToken),
      toToken: mapLifiToken(lifiResponse.action.toToken),
      fromAmount: lifiResponse.estimate.fromAmount,
      toAmount: lifiResponse.estimate.toAmount,
      estimatedTime: lifiResponse.estimate.executionDuration,
    });
  }

  return steps;
}

/**
 * Extract steps from LI.FI route response (Issue 6 fix)
 */
function extractStepsFromRoute(lifiRoute: LifiRoute): Step[] {
  const steps: Step[] = [];

  if (lifiRoute.steps && lifiRoute.steps.length > 0) {
    for (const lifiStep of lifiRoute.steps) {
      steps.push({
        id: lifiStep.id,
        type: mapStepType(lifiStep.type),
        tool: lifiStep.toolDetails?.name ?? lifiStep.tool,
        toolLogoUrl: lifiStep.toolDetails?.logoURI,
        fromChainId: lifiStep.action.fromChainId,
        toChainId: lifiStep.action.toChainId,
        fromToken: mapLifiToken(lifiStep.action.fromToken),
        toToken: mapLifiToken(lifiStep.action.toToken),
        fromAmount: lifiStep.estimate.fromAmount,
        toAmount: lifiStep.estimate.toAmount,
        estimatedTime: lifiStep.estimate.executionDuration,
      });
    }
  }

  return steps;
}

/**
 * Calculate fees from LI.FI quote response with detailed breakdown
 */
function calculateFeesFromQuote(lifiResponse: LifiQuoteResponse): Fees {
  const estimate = lifiResponse.estimate;
  let totalGasUsd = 0;
  let bridgeFeeUsd = 0;
  let protocolFeeUsd = 0;
  let totalGasLimit = BigInt(0);
  let gasPrice = '0';
  let totalGasCost = BigInt(0);
  let nativeToken: Token | undefined;
  const stepGasBreakdown: StepGas[] = [];

  // Process gas costs - aggregate across all steps (Fix for Issue 1, 2, 3)
  if (estimate.gasCosts && estimate.gasCosts.length > 0) {
    for (const gasCostItem of estimate.gasCosts) {
      const gasUsd = parseFloat(gasCostItem.amountUSD ?? '0');
      totalGasUsd += gasUsd;

      // Track native token from gas costs
      if (!nativeToken && gasCostItem.token) {
        nativeToken = mapLifiToken(gasCostItem.token);
      }

      // Aggregate gas limit and gas cost across all steps
      if (gasCostItem.limit) {
        totalGasLimit += BigInt(gasCostItem.limit);
      }
      // Use first non-zero gas price (same chain typically has same gas price)
      if (gasPrice === '0' && gasCostItem.price) {
        gasPrice = gasCostItem.price;
      }
      if (gasCostItem.amount) {
        totalGasCost += BigInt(gasCostItem.amount);
      }

      // Add to step gas breakdown
      stepGasBreakdown.push({
        stepType: mapGasType(gasCostItem.type),
        stepId: gasCostItem.type,
        gasUnits: gasCostItem.estimate ?? gasCostItem.limit ?? '0',
        gasUsd,
      });
    }
  }

  // Convert aggregated BigInt values to strings for output
  const gasLimit = totalGasLimit.toString();
  const gasCost = totalGasCost.toString();

  // Process fee costs (bridge fees, protocol fees)
  let bridgeFeeToken: Token | undefined;
  let bridgeFeeAmount = '0';
  let protocolFeeToken: Token | undefined;
  let protocolFeeAmount = '0';

  if (estimate.feeCosts && estimate.feeCosts.length > 0) {
    for (const feeCostItem of estimate.feeCosts) {
      const feeUsd = parseFloat(feeCostItem.amountUSD ?? '0');
      if (!feeCostItem.included) {
        // Distinguish between bridge fees and protocol fees
        const feeNameLower = (feeCostItem.name || '').toLowerCase();
        if (feeNameLower.includes('protocol') || feeNameLower.includes('lifi')) {
          protocolFeeUsd += feeUsd;
          protocolFeeToken = mapLifiToken(feeCostItem.token);
          protocolFeeAmount = feeCostItem.amount;
        } else {
          bridgeFeeUsd += feeUsd;
          bridgeFeeToken = mapLifiToken(feeCostItem.token);
          bridgeFeeAmount = feeCostItem.amount;
        }
      }
    }
  }

  // Build detailed fee items
  const gasFee: FeeItem | undefined = nativeToken
    ? { amount: gasCost, amountUsd: totalGasUsd, token: nativeToken }
    : undefined;

  const bridgeFee: FeeItem | undefined = bridgeFeeToken
    ? { amount: bridgeFeeAmount, amountUsd: bridgeFeeUsd, token: bridgeFeeToken }
    : undefined;

  const protocolFee: FeeItem | undefined = protocolFeeToken
    ? { amount: protocolFeeAmount, amountUsd: protocolFeeUsd, token: protocolFeeToken }
    : undefined;

  const gasEstimate: GasEstimate = {
    gasLimit,
    gasPrice,
    gasCost,
    gasCostUsd: totalGasUsd,
    nativeToken,
    steps: stepGasBreakdown.length > 0 ? stepGasBreakdown : undefined,
    timestamp: Date.now(),
  };

  return {
    totalUsd: totalGasUsd + bridgeFeeUsd + protocolFeeUsd,
    gasUsd: totalGasUsd,
    bridgeFeeUsd,
    protocolFeeUsd,
    gasEstimate,
    gasFee,
    bridgeFee,
    protocolFee,
  };
}

/**
 * Map gas cost type to step type
 */
function mapGasType(type: string): 'approval' | 'swap' | 'bridge' | 'deposit' {
  const typeLower = type.toLowerCase();
  if (typeLower.includes('approval') || typeLower.includes('approve')) return 'approval';
  if (typeLower.includes('swap')) return 'swap';
  if (typeLower.includes('deposit')) return 'deposit';
  return 'bridge'; // default to bridge
}

/**
 * Calculate fees from LI.FI route response with detailed breakdown
 */
function calculateFeesFromRoute(lifiRoute: LifiRoute): Fees {
  let totalGasUsd = 0;
  let bridgeFeeUsd = 0;
  let protocolFeeUsd = 0;
  let totalGasLimit = BigInt(0);
  let gasPrice = '0';
  let totalGasCost = BigInt(0);
  let nativeToken: Token | undefined;
  const stepGasBreakdown: StepGas[] = [];

  // Track fee tokens
  let bridgeFeeToken: Token | undefined;
  let bridgeFeeAmount = '0';
  let protocolFeeToken: Token | undefined;
  let protocolFeeAmount = '0';

  // Aggregate fees from all steps (Fix for Issue 1, 2, 3)
  for (const step of lifiRoute.steps) {
    const stepType = mapStepType(step.type);

    if (step.estimate.gasCosts && step.estimate.gasCosts.length > 0) {
      for (const gasCostItem of step.estimate.gasCosts) {
        const gasUsd = parseFloat(gasCostItem.amountUSD ?? '0');
        totalGasUsd += gasUsd;

        // Track native token from gas costs
        if (!nativeToken && gasCostItem.token) {
          nativeToken = mapLifiToken(gasCostItem.token);
        }

        // Aggregate gas limit and gas cost across all steps (instead of overwriting)
        if (gasCostItem.limit) {
          totalGasLimit += BigInt(gasCostItem.limit);
        }
        // Use first non-zero gas price (same chain typically has same gas price)
        if (gasPrice === '0' && gasCostItem.price) {
          gasPrice = gasCostItem.price;
        }
        if (gasCostItem.amount) {
          totalGasCost += BigInt(gasCostItem.amount);
        }

        // Add to step gas breakdown (map 'approve' to 'approval' for StepGas type)
        stepGasBreakdown.push({
          stepType: stepType === 'approve' ? 'approval' : stepType,
          stepId: step.id,
          gasUnits: gasCostItem.estimate ?? gasCostItem.limit ?? '0',
          gasUsd,
        });
      }
    }

    if (step.estimate.feeCosts && step.estimate.feeCosts.length > 0) {
      for (const feeCostItem of step.estimate.feeCosts) {
        const feeUsd = parseFloat(feeCostItem.amountUSD ?? '0');
        if (!feeCostItem.included) {
          // Distinguish between bridge fees and protocol fees
          const feeNameLower = (feeCostItem.name || '').toLowerCase();
          if (feeNameLower.includes('protocol') || feeNameLower.includes('lifi')) {
            protocolFeeUsd += feeUsd;
            if (!protocolFeeToken) {
              protocolFeeToken = mapLifiToken(feeCostItem.token);
              protocolFeeAmount = feeCostItem.amount;
            }
          } else {
            bridgeFeeUsd += feeUsd;
            if (!bridgeFeeToken) {
              bridgeFeeToken = mapLifiToken(feeCostItem.token);
              bridgeFeeAmount = feeCostItem.amount;
            }
          }
        }
      }
    }
  }

  // Use route-level gasCostUSD if step-level sum is 0
  if (totalGasUsd === 0 && lifiRoute.gasCostUSD) {
    totalGasUsd = parseFloat(lifiRoute.gasCostUSD);
  }

  // Convert aggregated BigInt values to strings for output
  const gasLimit = totalGasLimit.toString();
  const gasCost = totalGasCost.toString();

  // Build detailed fee items
  const gasFee: FeeItem | undefined = nativeToken
    ? { amount: gasCost, amountUsd: totalGasUsd, token: nativeToken }
    : undefined;

  const bridgeFee: FeeItem | undefined = bridgeFeeToken
    ? { amount: bridgeFeeAmount, amountUsd: bridgeFeeUsd, token: bridgeFeeToken }
    : undefined;

  const protocolFee: FeeItem | undefined = protocolFeeToken
    ? { amount: protocolFeeAmount, amountUsd: protocolFeeUsd, token: protocolFeeToken }
    : undefined;

  const gasEstimate: GasEstimate = {
    gasLimit,
    gasPrice,
    gasCost,
    gasCostUsd: totalGasUsd,
    nativeToken,
    steps: stepGasBreakdown.length > 0 ? stepGasBreakdown : undefined,
    timestamp: Date.now(),
  };

  return {
    totalUsd: totalGasUsd + bridgeFeeUsd + protocolFeeUsd,
    gasUsd: totalGasUsd,
    bridgeFeeUsd,
    protocolFeeUsd,
    gasEstimate,
    gasFee,
    bridgeFee,
    protocolFee,
  };
}

/**
 * Calculate price impact (Issue 7 fix - cleaner calculation)
 * Returns price impact as decimal (0.01 = 1%)
 */
function calculatePriceImpact(fromAmountUsd: number, toAmountUsd: number): number {
  if (fromAmountUsd === 0) return 0;

  // Price impact as decimal (0.01 = 1%)
  const impact = (fromAmountUsd - toAmountUsd) / fromAmountUsd;

  // Round to 4 decimal places
  return Math.round(impact * 10000) / 10000;
}

/**
 * Determine price impact severity based on thresholds
 * @param priceImpact - Price impact as decimal (0.01 = 1%)
 * @returns Impact severity level
 */
function getImpactSeverity(priceImpact: number): 'low' | 'medium' | 'high' | 'very_high' {
  const absImpact = Math.abs(priceImpact);
  if (absImpact >= PRICE_IMPACT_VERY_HIGH) return 'very_high';
  if (absImpact >= PRICE_IMPACT_HIGH) return 'high';
  if (absImpact >= PRICE_IMPACT_MEDIUM) return 'medium';
  return 'low';
}

/**
 * Check if price impact exceeds the HIGH threshold
 * @param priceImpact - Price impact as decimal (0.01 = 1%)
 * @returns true if impact is >= 1%
 */
function isHighImpact(priceImpact: number): boolean {
  return Math.abs(priceImpact) >= PRICE_IMPACT_HIGH;
}

/**
 * Map LI.FI quote response to our Quote type
 */
function mapLifiQuoteToQuote(
  lifiResponse: LifiQuoteResponse,
  params: QuoteParams,
  autoDeposit: boolean
): Quote {
  const steps = extractStepsFromQuote(lifiResponse);
  const fees = calculateFeesFromQuote(lifiResponse);

  const fromAmountUsd = parseFloat(lifiResponse.estimate.fromAmountUSD ?? '0');
  const toAmountUsd = parseFloat(lifiResponse.estimate.toAmountUSD ?? '0');
  const priceImpact = calculatePriceImpact(fromAmountUsd, toAmountUsd);

  // Calculate total estimated time
  const estimatedTime = steps.reduce((total, step) => total + step.estimatedTime, 0);

  // Generate unique quote ID
  const quoteId = `mina-${lifiResponse.id}-${Date.now()}`;

  // Quote expires in 60 seconds (LI.FI quotes are typically valid for ~60s)
  const expiresAt = Date.now() + 60000;

  return {
    id: quoteId,
    steps,
    fees,
    estimatedTime,
    fromAmount: lifiResponse.estimate.fromAmount,
    toAmount: lifiResponse.estimate.toAmount,
    priceImpact,
    highImpact: isHighImpact(priceImpact),
    impactSeverity: getImpactSeverity(priceImpact),
    expiresAt,
    fromToken: mapLifiToken(lifiResponse.action.fromToken),
    toToken: mapLifiToken(lifiResponse.action.toToken),
    includesAutoDeposit: autoDeposit && params.toChainId === HYPEREVM_CHAIN_ID,
    manualDepositRequired: !autoDeposit && params.toChainId === HYPEREVM_CHAIN_ID,
  };
}

/**
 * Map LI.FI route response to our Quote type (Issue 6 fix)
 */
function mapLifiRouteToQuote(
  lifiRoute: LifiRoute,
  params: QuoteParams,
  autoDeposit: boolean
): Quote {
  const steps = extractStepsFromRoute(lifiRoute);
  const fees = calculateFeesFromRoute(lifiRoute);

  const fromAmountUsd = parseFloat(lifiRoute.fromAmountUSD ?? '0');
  const toAmountUsd = parseFloat(lifiRoute.toAmountUSD ?? '0');
  const priceImpact = calculatePriceImpact(fromAmountUsd, toAmountUsd);

  // Calculate total estimated time
  const estimatedTime = steps.reduce((total, step) => total + step.estimatedTime, 0);

  // Generate unique quote ID
  const quoteId = `mina-${lifiRoute.id}-${Date.now()}`;

  // Quote expires in 60 seconds
  const expiresAt = Date.now() + 60000;

  return {
    id: quoteId,
    steps,
    fees,
    estimatedTime,
    fromAmount: lifiRoute.fromAmount,
    toAmount: lifiRoute.toAmount,
    priceImpact,
    highImpact: isHighImpact(priceImpact),
    impactSeverity: getImpactSeverity(priceImpact),
    expiresAt,
    fromToken: mapLifiToken(lifiRoute.fromToken),
    toToken: mapLifiToken(lifiRoute.toToken),
    includesAutoDeposit: autoDeposit && params.toChainId === HYPEREVM_CHAIN_ID,
    manualDepositRequired: !autoDeposit && params.toChainId === HYPEREVM_CHAIN_ID,
  };
}

/**
 * Build LI.FI quote API URL with parameters
 */
function buildQuoteUrl(params: QuoteParams): string {
  const url = new URL(`${LIFI_API_URL}/quote`);

  url.searchParams.set('fromChain', params.fromChainId.toString());
  url.searchParams.set('toChain', params.toChainId.toString());
  url.searchParams.set('fromToken', params.fromToken);
  url.searchParams.set('toToken', params.toToken);
  url.searchParams.set('fromAmount', params.fromAmount);
  url.searchParams.set('fromAddress', params.fromAddress);

  if (params.toAddress) {
    url.searchParams.set('toAddress', params.toAddress);
  }

  // Convert slippage from decimal to percentage (0.005 -> 0.5)
  const slippagePercent = (params.slippage ?? DEFAULT_SLIPPAGE) * 100;
  url.searchParams.set('slippage', slippagePercent.toFixed(2));

  return url.toString();
}

/**
 * Build LI.FI routes API URL for multiple quotes
 */
function buildRoutesUrl(): string {
  const url = new URL(`${LIFI_API_URL}/advanced/routes`);
  return url.toString();
}

/**
 * Fetch a single quote from LI.FI API
 */
async function fetchQuoteFromApi(
  params: QuoteParams,
  timeoutMs: number = QUOTE_API_TIMEOUT_MS
): Promise<LifiQuoteResponse> {
  const url = buildQuoteUrl(params);

  const response = await fetchWithTimeout(url, undefined, timeoutMs);

  if (!response.ok) {
    const errorBody = await response.text();

    // Check for no route found error
    if (response.status === 404 || errorBody.includes('No available quotes')) {
      throw new NoRouteFoundError(
        `No bridge route found from chain ${params.fromChainId} to chain ${params.toChainId}`,
        {
          fromChainId: params.fromChainId,
          toChainId: params.toChainId,
          fromToken: params.fromToken,
          toToken: params.toToken,
        }
      );
    }

    throw new NetworkError(
      `LI.FI API error: ${response.status} ${response.statusText}`,
      {
        endpoint: url,
        statusCode: response.status,
      }
    );
  }

  const data: LifiQuoteResponse = await response.json();

  if (!data.id || !data.action || !data.estimate) {
    throw new QuoteFetchError('Invalid quote response format from LI.FI API');
  }

  return data;
}

/**
 * Fetch multiple quotes from LI.FI routes API (Issue 6 fix)
 */
async function fetchRoutesFromApi(
  params: QuoteParams,
  timeoutMs: number = QUOTE_API_TIMEOUT_MS
): Promise<LifiRoute[]> {
  const url = buildRoutesUrl();

  const body = {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromToken,
    toTokenAddress: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress ?? params.fromAddress,
    options: {
      slippage: (params.slippage ?? DEFAULT_SLIPPAGE) * 100,
      order: 'RECOMMENDED',
    },
  };

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!response.ok) {
    const errorBody = await response.text();

    if (response.status === 404 || errorBody.includes('No available quotes')) {
      throw new NoRouteFoundError(
        `No bridge routes found from chain ${params.fromChainId} to chain ${params.toChainId}`,
        {
          fromChainId: params.fromChainId,
          toChainId: params.toChainId,
          fromToken: params.fromToken,
          toToken: params.toToken,
        }
      );
    }

    throw new NetworkError(
      `LI.FI API error: ${response.status} ${response.statusText}`,
      {
        endpoint: url,
        statusCode: response.status,
      }
    );
  }

  const data: LifiRoutesResponse = await response.json();

  if (!data.routes || !Array.isArray(data.routes)) {
    throw new QuoteFetchError('Invalid routes response format from LI.FI API');
  }

  if (data.routes.length === 0) {
    throw new NoRouteFoundError(
      `No bridge routes available from chain ${params.fromChainId} to chain ${params.toChainId}`,
      {
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
      }
    );
  }

  return data.routes;
}

/**
 * Get a single optimal bridge quote
 * Fetches from LI.FI API and returns the recommended route
 *
 * @param params - Quote parameters
 * @param autoDeposit - Whether to include auto-deposit step
 * @param cache - Optional cache instance
 * @param timeoutMs - Optional timeout override
 * @param chainCache - Optional chain cache for validation
 * @returns Quote with route and fee information
 * @throws InvalidQuoteParamsError if parameters are invalid
 * @throws NoRouteFoundError if no route is available
 * @throws NetworkError if API request fails
 */
export async function getQuote(
  params: QuoteParams,
  autoDeposit: boolean = true,
  cache?: QuoteCache,
  timeoutMs?: number,
  chainCache?: ChainCache
): Promise<Quote> {
  // Validate params first (now async for chain validation - Issue 1 fix)
  await validateQuoteParams(params, chainCache);

  const quoteCache = cache ?? getDefaultCache();

  // Normalize params with defaults
  const normalizedParams: QuoteParams = {
    ...params,
    toChainId: params.toChainId ?? HYPEREVM_CHAIN_ID,
    slippage: params.slippage ?? DEFAULT_SLIPPAGE,
  };

  // Check cache first
  const cached = quoteCache.get(normalizedParams);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  try {
    const lifiResponse = await fetchQuoteFromApi(normalizedParams, timeoutMs);
    const quote = mapLifiQuoteToQuote(lifiResponse, normalizedParams, autoDeposit);

    // Cache the quote
    quoteCache.set(normalizedParams, quote);

    return quote;
  } catch (error) {
    // Issue 5 fix: Try to return stale cache if available
    const staleCache = quoteCache.getStale(normalizedParams);
    if (staleCache) {
      console.warn('[Mina SDK] Using stale quote cache due to API error:', error);
      return staleCache.quote;
    }

    // Re-throw typed errors as-is
    if (
      error instanceof NoRouteFoundError ||
      error instanceof NetworkError ||
      error instanceof InvalidQuoteParamsError ||
      error instanceof QuoteFetchError
    ) {
      throw error;
    }

    // Wrap unexpected errors
    throw new QuoteFetchError(
      error instanceof Error ? error.message : 'Failed to fetch quote'
    );
  }
}

/**
 * Get multiple bridge quotes for comparison
 * Fetches all available routes from LI.FI API
 *
 * @param params - Quote parameters
 * @param autoDeposit - Whether to include auto-deposit step
 * @param cache - Optional cache instance
 * @param timeoutMs - Optional timeout override
 * @param chainCache - Optional chain cache for validation
 * @returns Array of quotes sorted by recommendation
 * @throws InvalidQuoteParamsError if parameters are invalid
 * @throws NoRouteFoundError if no routes are available
 * @throws NetworkError if API request fails
 */
export async function getQuotes(
  params: QuoteParams,
  autoDeposit: boolean = true,
  cache?: QuoteCache,
  timeoutMs?: number,
  chainCache?: ChainCache
): Promise<QuotesResponse> {
  // Validate params first (now async for chain validation - Issue 1 fix)
  await validateQuoteParams(params, chainCache);

  // Normalize params with defaults
  const normalizedParams: QuoteParams = {
    ...params,
    toChainId: params.toChainId ?? HYPEREVM_CHAIN_ID,
    slippage: params.slippage ?? DEFAULT_SLIPPAGE,
  };

  try {
    const lifiRoutes = await fetchRoutesFromApi(normalizedParams, timeoutMs);

    // Issue 6 fix: Use route-specific mapping
    const quotes = lifiRoutes.map((route) =>
      mapLifiRouteToQuote(route, normalizedParams, autoDeposit)
    );

    return {
      quotes,
      recommendedIndex: 0, // LI.FI returns routes sorted by recommendation
    };
  } catch (error) {
    // Re-throw typed errors as-is
    if (
      error instanceof NoRouteFoundError ||
      error instanceof NetworkError ||
      error instanceof InvalidQuoteParamsError ||
      error instanceof QuoteFetchError
    ) {
      throw error;
    }

    // Wrap unexpected errors
    throw new QuoteFetchError(
      error instanceof Error ? error.message : 'Failed to fetch quotes'
    );
  }
}

/**
 * Invalidate the quote cache
 * Forces fresh quotes on next request
 *
 * @param cache - Optional cache instance (uses default if not provided)
 */
export function invalidateQuoteCache(cache?: QuoteCache): void {
  const quoteCache = cache ?? getDefaultCache();
  quoteCache.invalidate();
}

/**
 * Type guard to check if an error is a QuoteFetchError
 */
export function isQuoteFetchError(error: unknown): error is QuoteFetchError {
  return error instanceof QuoteFetchError;
}

/**
 * Type guard to check if an error is an InvalidQuoteParamsError
 */
export function isInvalidQuoteParamsError(error: unknown): error is InvalidQuoteParamsError {
  return error instanceof InvalidQuoteParamsError;
}

/**
 * Result of price impact estimation
 */
export interface PriceImpactEstimate {
  /** Estimated price impact as decimal (0.01 = 1%) */
  impact: number;
  /** Whether the impact exceeds HIGH threshold (1%) */
  highImpact: boolean;
  /** Impact severity level */
  severity: 'low' | 'medium' | 'high' | 'very_high';
}

/**
 * Estimate price impact without fetching a full quote
 * This is a lightweight estimation method for UI preview purposes
 *
 * Note: This uses a simplified calculation based on cached token prices
 * and may not account for all factors like liquidity depth.
 * For accurate price impact, use getQuote() which fetches real route data.
 *
 * @param fromToken - Source token with price data
 * @param toToken - Destination token with price data
 * @param fromAmount - Amount in smallest unit (wei)
 * @returns Price impact estimate with severity
 */
export function estimatePriceImpact(
  fromToken: Token,
  toToken: Token,
  fromAmount: string
): PriceImpactEstimate {
  // If prices are not available, assume minimal impact
  if (!fromToken.priceUsd || !toToken.priceUsd) {
    return {
      impact: 0,
      highImpact: false,
      severity: 'low',
    };
  }

  try {
    // Calculate input value in USD
    const fromAmountNum = parseFloat(fromAmount);
    const fromValueUsd = (fromAmountNum / Math.pow(10, fromToken.decimals)) * fromToken.priceUsd;

    // Calculate expected output value (assuming 1:1 value at market prices, before any impact)
    // The real output would be lower due to fees and slippage
    const expectedOutputUsd = fromValueUsd;

    // For lightweight estimation, assume minimal impact for small amounts
    // and scale up for larger amounts (simplified liquidity model)
    let estimatedImpact = 0;

    // Simple heuristic: larger trades have more impact
    // This is a placeholder - real impact depends on liquidity pools
    if (fromValueUsd > 100000) {
      estimatedImpact = 0.01; // 1% for very large trades
    } else if (fromValueUsd > 10000) {
      estimatedImpact = 0.005; // 0.5% for large trades
    } else if (fromValueUsd > 1000) {
      estimatedImpact = 0.001; // 0.1% for medium trades
    } else {
      estimatedImpact = 0.0001; // 0.01% for small trades
    }

    const impact = Math.round(estimatedImpact * 10000) / 10000;

    return {
      impact,
      highImpact: isHighImpact(impact),
      severity: getImpactSeverity(impact),
    };
  } catch {
    // On error, return minimal impact
    return {
      impact: 0,
      highImpact: false,
      severity: 'low',
    };
  }
}

/**
 * Export the QuoteCache class for use by Mina client
 */
export { QuoteCache };
