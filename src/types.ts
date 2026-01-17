/**
 * Core types for @mina-bridge/sdk
 */

/**
 * Slippage tolerance preset values (in percentage)
 */
export type SlippagePreset = 0.1 | 0.5 | 1.0;

/**
 * Slippage validation constraints
 */
export const SLIPPAGE_CONSTRAINTS = {
  /** Minimum slippage tolerance: 0.01% */
  MIN: 0.01,
  /** Maximum slippage tolerance: 5.0% */
  MAX: 5.0,
  /** Default slippage tolerance: 0.5% */
  DEFAULT: 0.5,
  /** Preset slippage values */
  PRESETS: [0.1, 0.5, 1.0] as const,
} as const;

/**
 * Route preference for bridge quotes
 * - recommended: Balance of speed and cost (default)
 * - fastest: Prioritize routes with lowest estimated time
 * - cheapest: Prioritize routes with lowest total fees
 */
export type RoutePreference = 'recommended' | 'fastest' | 'cheapest';

/**
 * Route comparison data for alternative routes
 */
export interface RouteComparison {
  /** Route preference classification */
  type: RoutePreference;
  /** Estimated execution time in seconds */
  estimatedTime: number;
  /** Total fees in USD */
  totalFees: string;
  /** Expected output amount */
  outputAmount: string;
  /** Route ID for reference */
  routeId: string;
}

/**
 * Configuration for the Mina client
 */
export interface MinaConfig {
  /** Unique identifier for the integrator */
  integrator: string;
  /** Custom RPC URLs by chain ID */
  rpcUrls?: Record<number, string>;
  /** Enable automatic deposit to Hyperliquid L1 after bridge */
  autoDeposit?: boolean;
  /** Default slippage tolerance (0.005 = 0.5%) */
  defaultSlippage?: number;
}

/**
 * Chain metadata
 */
export interface Chain {
  /** Chain ID (e.g., 1 for Ethereum mainnet) */
  id: number;
  /** Chain key/slug (e.g., "eth", "arb") */
  key: string;
  /** Human-readable chain name */
  name: string;
  /** URL to chain logo image */
  logoUrl: string;
  /** Native gas token for the chain */
  nativeToken: Token;
  /** Whether this is an EVM-compatible chain */
  isEvm: boolean;
}

/**
 * Token metadata
 */
export interface Token {
  /** Token contract address (or native token address) */
  address: string;
  /** Token symbol (e.g., "USDC") */
  symbol: string;
  /** Token name (e.g., "USD Coin") */
  name: string;
  /** Token decimals (e.g., 6 for USDC) */
  decimals: number;
  /** URL to token logo image */
  logoUrl: string;
  /** Current USD price (optional) */
  priceUsd?: number;
  /** Chain ID this token is on */
  chainId: number;
}

/**
 * Parameters for requesting a bridge quote
 */
export interface QuoteParams {
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID (typically HyperEVM 999) */
  toChainId: number;
  /** Source token address */
  fromToken: string;
  /** Destination token address */
  toToken: string;
  /** Amount to bridge (in smallest unit, e.g., wei) */
  fromAmount: string;
  /** User's wallet address */
  fromAddress: string;
  /** Destination address (defaults to fromAddress) */
  toAddress?: string;
  /**
   * Slippage tolerance in percentage format (e.g., 0.5 = 0.5%)
   * Valid range: 0.01 to 5.0
   * Preset values: 0.1, 0.5, 1.0
   * Defaults to 0.5 if not specified
   */
  slippageTolerance?: number;
  /**
   * @deprecated Use slippageTolerance instead. Slippage in decimal format (0.005 = 0.5%)
   */
  slippage?: number;
  /** Route preference: 'recommended' | 'fastest' | 'cheapest' (defaults to 'recommended') */
  routePreference?: RoutePreference;
}

/**
 * A single step in a bridge route
 */
export interface Step {
  /** Step ID */
  id: string;
  /** Step type (e.g., "swap", "bridge", "deposit") */
  type: 'swap' | 'bridge' | 'deposit' | 'approve';
  /** Tool/protocol being used */
  tool: string;
  /** Tool logo URL */
  toolLogoUrl?: string;
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Source token */
  fromToken: Token;
  /** Destination token */
  toToken: Token;
  /** Input amount */
  fromAmount: string;
  /** Expected output amount */
  toAmount: string;
  /** Estimated execution time in seconds */
  estimatedTime: number;
}

/**
 * Individual fee item with amount and token info
 */
export interface FeeItem {
  /** Fee amount in token units (smallest unit) */
  amount: string;
  /** Fee amount in USD */
  amountUsd: number;
  /** Token the fee is paid in */
  token: Token;
}

/**
 * Gas cost for a single step
 */
export interface StepGas {
  /** Type of step */
  stepType: 'approval' | 'swap' | 'bridge' | 'deposit';
  /** Step identifier */
  stepId: string;
  /** Estimated gas units */
  gasUnits: string;
  /** Gas cost in USD */
  gasUsd: number;
}

/**
 * Gas estimation details
 */
export interface GasEstimate {
  /** Estimated gas limit (total) */
  gasLimit: string;
  /** Gas price in wei */
  gasPrice: string;
  /** Total gas cost in native token */
  gasCost: string;
  /** Total gas cost in USD */
  gasCostUsd: number;
  /** Native token used for gas */
  nativeToken?: Token;
  /** Gas breakdown per step */
  steps?: StepGas[];
  /** Timestamp when gas price was fetched */
  timestamp?: number;
}

/**
 * Fee breakdown for a quote
 */
export interface Fees {
  /** Total fees in USD */
  totalUsd: number;
  /** Gas fees in USD */
  gasUsd: number;
  /** Bridge/protocol fees in USD */
  bridgeFeeUsd: number;
  /** Protocol fee in USD (e.g., LI.FI fee) */
  protocolFeeUsd: number;
  /** Gas estimate in native token */
  gasEstimate: GasEstimate;
  /** Detailed gas fee breakdown */
  gasFee?: FeeItem;
  /** Detailed bridge fee breakdown */
  bridgeFee?: FeeItem;
  /** Detailed protocol fee breakdown */
  protocolFee?: FeeItem;
}

/**
 * Quote response from the SDK
 */
export interface Quote {
  /** Unique quote ID */
  id: string;
  /** Route steps */
  steps: Step[];
  /** Fee breakdown */
  fees: Fees;
  /** Estimated total time in seconds */
  estimatedTime: number;
  /** Input amount */
  fromAmount: string;
  /** Expected output amount */
  toAmount: string;
  /** Slippage tolerance applied to this quote (percentage format, e.g., 0.5 = 0.5%) */
  slippageTolerance: number;
  /** Minimum amount to receive after slippage (in smallest unit) */
  minimumReceived: string;
  /** Minimum amount to receive formatted with decimals */
  minimumReceivedFormatted: string;
  /** Price impact percentage (e.g., 0.01 = 1%) */
  priceImpact: number;
  /** Whether price impact exceeds HIGH threshold (1%) */
  highImpact: boolean;
  /** Price impact severity level */
  impactSeverity: 'low' | 'medium' | 'high' | 'very_high';
  /** Quote expiration timestamp */
  expiresAt: number;
  /** Source token */
  fromToken: Token;
  /** Destination token */
  toToken: Token;
  /** Whether auto-deposit to Hyperliquid L1 is included */
  includesAutoDeposit: boolean;
  /** Whether manual deposit is required (when autoDeposit is disabled for HyperEVM destination) */
  manualDepositRequired: boolean;
  /** Route preference used for this quote */
  routePreference: RoutePreference;
  /** Alternative routes for comparison (up to 3 alternatives with time/fee data) */
  alternativeRoutes?: RouteComparison[];
}

/**
 * Signer interface for transaction signing
 * Compatible with viem WalletClient and ethers Signer
 */
export interface TransactionSigner {
  /** Sign and send a transaction */
  sendTransaction: (request: TransactionRequestData) => Promise<string>;
  /** Get the signer's address */
  getAddress: () => Promise<string>;
  /** Get the current chain ID */
  getChainId: () => Promise<number>;
}

/**
 * Transaction request data for signing
 */
export interface TransactionRequestData {
  to: string;
  data: string;
  value: string;
  gasLimit?: string;
  gasPrice?: string;
  chainId: number;
}

/**
 * Step type for bridge execution
 */
export type StepType = 'approval' | 'swap' | 'bridge' | 'deposit';

/**
 * Enhanced step status payload for callbacks
 */
export interface StepStatusPayload {
  /** Step identifier */
  stepId: string;
  /** Type of step */
  step: StepType;
  /** Current status */
  status: 'pending' | 'active' | 'completed' | 'failed';
  /** Transaction hash (if submitted) */
  txHash: string | null;
  /** Error (if failed) */
  error: Error | null;
  /** Timestamp of last update */
  timestamp: number;
}

/**
 * Transaction status payload with progress tracking
 */
export interface TransactionStatusPayload {
  /** Overall status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Substatus for detailed state */
  substatus: string;
  /** Current step index (1-based for UI display) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Input amount */
  fromAmount: string;
  /** Output amount (or expected) */
  toAmount: string | null;
  /** Bridge transaction hash */
  txHash: string;
  /** Receiving transaction hash on destination chain */
  receivingTxHash: string | null;
  /** Progress percentage (0-100) */
  progress: number;
  /** Estimated time remaining in seconds */
  estimatedTime: number;
}

/**
 * Callback type for step changes
 */
export type OnStepChange = (stepStatus: StepStatusPayload) => void;

/**
 * Callback type for overall status changes
 */
export type OnStatusChange = (status: TransactionStatusPayload) => void;

/**
 * Options for executing a quote
 */
export interface ExecuteOptions {
  /** Quote to execute */
  quote: Quote;
  /** Signer for transaction signing */
  signer: TransactionSigner;
  /** Callback for step status updates (typed as OnStepChange) */
  onStepChange?: OnStepChange;
  /** Callback for overall status updates (typed as OnStatusChange) */
  onStatusChange?: OnStatusChange;
  /** Callback before approval transaction */
  onApprovalRequest?: () => void;
  /** Callback before main transaction */
  onTransactionRequest?: () => void;
  /** Allow infinite token approval */
  infiniteApproval?: boolean;
}

/**
 * Overall execution status type
 */
export type ExecutionStatusType =
  | 'idle'
  | 'approving'
  | 'approved'
  | 'executing'
  | 'bridging'
  | 'completed'
  | 'failed';

/**
 * Status of a step during execution (legacy interface for internal use)
 */
export interface StepStatus {
  /** Step ID */
  stepId: string;
  /** Step type */
  stepType?: StepType;
  /** Current status */
  status: 'pending' | 'executing' | 'completed' | 'failed';
  /** Transaction hash (if submitted) */
  txHash?: string;
  /** Error message (if failed) */
  error?: string;
  /** Timestamp of last update */
  updatedAt: number;
}

/**
 * Result of executing a bridge transaction
 */
export interface ExecutionResult {
  /** Unique execution ID for status tracking */
  executionId: string;
  /** Overall status ('completed' maps to 'success' in story spec) */
  status: 'pending' | 'executing' | 'completed' | 'failed';
  /** All step statuses */
  steps: StepStatus[];
  /** Final bridge transaction hash */
  txHash?: string;
  /** Input amount that was bridged */
  fromAmount?: string;
  /** Output amount received (or expected) */
  toAmount?: string;
  /** Received amount after bridge completion */
  receivedAmount?: string;
  /** Deposit transaction hash (if auto-deposit was enabled) */
  depositTxHash?: string | null;
  /** Error (if failed) */
  error?: Error;
}

/**
 * Transaction status for tracking
 */
export interface TransactionStatus {
  /** Transaction ID/hash */
  id: string;
  /** Overall status */
  status: 'pending' | 'bridging' | 'depositing' | 'completed' | 'failed';
  /** Step statuses */
  steps: StepStatus[];
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Bridge transaction hash */
  bridgeTxHash?: string;
  /** Deposit transaction hash (if auto-deposit) */
  depositTxHash?: string;
  /** Created timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
}

/**
 * Token balance information
 */
export interface Balance {
  /** Token */
  token: Token;
  /** Balance in smallest unit */
  balance: string;
  /** Balance formatted with decimals */
  formatted: string;
  /** Balance in USD */
  balanceUsd?: number;
}
