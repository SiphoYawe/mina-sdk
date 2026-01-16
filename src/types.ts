/**
 * Core types for @mina-bridge/sdk
 */

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
  /** Slippage tolerance (0.005 = 0.5%) */
  slippage?: number;
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
}

/**
 * Options for executing a quote
 */
export interface ExecuteOptions {
  /** Quote to execute */
  quote: Quote;
  /** Signer/wallet for signing transactions */
  signer: unknown; // Will be typed properly when integrating with viem/ethers
  /** Callback for step updates */
  onStepUpdate?: (step: Step, status: StepStatus) => void;
  /** Callback for transaction hash */
  onTxHash?: (txHash: string, step: Step) => void;
}

/**
 * Status of a step during execution
 */
export interface StepStatus {
  /** Step ID */
  stepId: string;
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
  /** Overall status */
  status: 'pending' | 'executing' | 'completed' | 'failed';
  /** All step statuses */
  steps: StepStatus[];
  /** Final transaction hash (if completed) */
  txHash?: string;
  /** Error (if failed) */
  error?: Error;
  /** Received amount (if completed) */
  receivedAmount?: string;
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
