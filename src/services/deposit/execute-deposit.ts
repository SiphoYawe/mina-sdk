/**
 * Execute Deposit Service
 * Handles depositing USDC from HyperEVM to Hyperliquid L1 (HyperCore) trading account
 *
 * Uses the CoreDepositWallet contract provided by Circle for CCTP-enabled deposits.
 * @see https://developers.circle.com/cctp/references/coredepositwallet-contract-interface
 */

import { HYPEREVM_CHAIN_ID, HYPEREVM_USDC_ADDRESS } from '../../constants';
import { MinaError, NetworkError, InsufficientBalanceError, UserRejectedError } from '../../errors';

/**
 * Validate Ethereum address format
 */
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if an error is a user rejection
 */
function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('user rejected') ||
      message.includes('user denied') ||
      message.includes('user cancelled') ||
      message.includes('user canceled') ||
      message.includes('rejected by user') ||
      message.includes('action_rejected') ||
      message.includes('user refused')
    );
  }
  return false;
}

/**
 * CoreDepositWallet contract address on HyperEVM (Mainnet)
 * This contract handles USDC deposits from HyperEVM to HyperCore
 */
export const CORE_DEPOSIT_WALLET_ADDRESS = '0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24' as const;

/**
 * HyperEVM RPC endpoint
 */
const HYPEREVM_RPC_URL = 'https://api.hyperliquid.xyz/evm';

/**
 * USDC decimals
 */
const USDC_DECIMALS = 6;

/**
 * Default gas limit for deposit transaction
 * CoreDepositWallet deposit typically uses ~80,000 gas
 */
const DEFAULT_DEPOSIT_GAS_LIMIT = '150000';

/**
 * Default gas limit for approval transaction
 */
const DEFAULT_APPROVAL_GAS_LIMIT = '60000';

/**
 * Minimum USDC deposit amount (5 USDC in smallest units)
 */
export const MINIMUM_DEPOSIT_AMOUNT = '5000000';

/**
 * Destination DEX indices for HyperCore
 */
export const DestinationDex = {
  /** Default perps DEX (trading account) */
  PERPS: 0,
  /** Spot DEX */
  SPOT: 4294967295, // uint32.max
} as const;

export type DestinationDexType = typeof DestinationDex[keyof typeof DestinationDex];

/**
 * CoreDepositWallet ABI (minimal required functions)
 */
export const CORE_DEPOSIT_WALLET_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDex', type: 'uint32' },
    ],
    outputs: [],
  },
  {
    name: 'depositFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'destinationId', type: 'uint32' },
    ],
    outputs: [],
  },
] as const;

/**
 * ERC20 ABI (minimal required functions for approval and balance checking)
 */
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * Maximum uint256 value for infinite approval
 */
const MAX_UINT256 = '115792089237316195423570985008687907853269984665640564039457584007913129639935';

/**
 * Options for executing a deposit to Hyperliquid
 */
export interface DepositOptions {
  /** Amount to deposit in smallest units (e.g., 1000000 = 1 USDC) */
  amount: string;
  /** Wallet address performing the deposit */
  walletAddress: string;
  /** Destination DEX (0 = perps/trading, uint32.max = spot). Defaults to perps. */
  destinationDex?: DestinationDexType;
  /** Callback when deposit transaction is submitted */
  onDepositSubmitted?: (txHash: string) => void;
  /** Callback when approval transaction is submitted */
  onApprovalSubmitted?: (txHash: string) => void;
  /** Callback for status updates */
  onStatusChange?: (status: DepositStatus) => void;
  /** Allow infinite token approval (saves gas on future deposits). Defaults to false. */
  infiniteApproval?: boolean;
}

/**
 * Deposit status during execution
 */
export type DepositStatus =
  | 'checking_balance'
  | 'checking_allowance'
  | 'approving'
  | 'approval_pending'
  | 'approval_confirmed'
  | 'depositing'
  | 'deposit_pending'
  | 'deposit_confirmed'
  | 'completed'
  | 'failed';

/**
 * Result of a deposit execution
 */
export interface DepositResult {
  /** Whether the deposit was successful */
  success: boolean;
  /** Deposit transaction hash */
  depositTxHash: string;
  /** Approval transaction hash (if approval was needed) */
  approvalTxHash?: string;
  /** Amount deposited in smallest units */
  amount: string;
  /** Amount formatted with decimals */
  amountFormatted: string;
  /** Destination DEX (perps or spot) */
  destinationDex: DestinationDexType;
  /** Block number of the deposit confirmation */
  blockNumber?: number;
  /** Gas used for deposit transaction */
  gasUsed?: string;
}

/**
 * Pre-flight validation result
 */
export interface DepositValidation {
  /** Whether the deposit can proceed */
  valid: boolean;
  /** USDC balance available */
  usdcBalance: string;
  /** USDC balance formatted */
  usdcBalanceFormatted: string;
  /** Native gas (HYPE) balance for gas fees */
  gasBalance: string;
  /** Current allowance for CoreDepositWallet */
  currentAllowance: string;
  /** Whether approval is needed */
  needsApproval: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Signer interface compatible with viem WalletClient
 * Allows the SDK to be wallet-agnostic
 */
export interface DepositSigner {
  /** Sign and send a transaction, returns transaction hash */
  sendTransaction: (request: {
    to: string;
    data: string;
    value?: string;
    gas?: string;
    chainId: number;
  }) => Promise<string>;
  /** Get the signer's address */
  getAddress: () => Promise<string>;
  /** Wait for transaction receipt */
  waitForTransactionReceipt?: (hash: string) => Promise<{
    status: 'success' | 'reverted';
    blockNumber: bigint;
    gasUsed: bigint;
  }>;
}

/**
 * Error thrown when deposit amount is below minimum
 */
export class MinimumDepositError extends MinaError {
  readonly code = 'MINIMUM_DEPOSIT_NOT_MET' as const;
  readonly recoverable = false as const;
  readonly minimumAmount: string;
  readonly requestedAmount: string;

  constructor(
    message: string,
    details: { minimumAmount: string; requestedAmount: string }
  ) {
    super(message, {
      step: 'deposit',
      userMessage: `Deposit amount must be at least ${details.minimumAmount} USDC.`,
      recoveryAction: 'try_different_amount',
      details,
    });
    this.minimumAmount = details.minimumAmount;
    this.requestedAmount = details.requestedAmount;
  }
}

/**
 * Error thrown when gas balance is insufficient
 */
export class InsufficientGasError extends MinaError {
  readonly code = 'INSUFFICIENT_GAS' as const;
  readonly recoverable = false as const;
  readonly required: string;
  readonly available: string;

  constructor(message: string, details: { required: string; available: string }) {
    super(message, {
      step: 'deposit',
      userMessage: `Insufficient gas for deposit. Required: ${details.required}, Available: ${details.available}`,
      recoveryAction: 'add_funds',
      details,
    });
    this.required = details.required;
    this.available = details.available;
  }
}

/**
 * Error thrown when deposit transaction fails
 */
export class DepositTransactionError extends MinaError {
  readonly code = 'DEPOSIT_TRANSACTION_FAILED' as const;
  readonly recoverable = true as const;
  readonly txHash?: string;
  readonly reason?: string;

  constructor(message: string, details: { txHash?: string; reason?: string }) {
    super(message, {
      step: 'deposit',
      userMessage: details.reason
        ? `Deposit failed: ${details.reason}. You can try again.`
        : 'Deposit transaction failed. You can try again.',
      recoveryAction: 'retry',
      details,
    });
    this.txHash = details.txHash;
    this.reason = details.reason;
  }
}

/**
 * Error thrown when an invalid address is provided
 */
export class InvalidDepositAddressError extends MinaError {
  readonly code = 'INVALID_DEPOSIT_ADDRESS' as const;
  readonly recoverable = false as const;
  readonly address: string;

  constructor(message: string, details: { address: string }) {
    super(message, {
      step: 'deposit',
      userMessage: `Invalid address: ${details.address}`,
      recoveryAction: 'try_again',
      details,
    });
    this.address = details.address;
  }
}

/**
 * Type guards for deposit errors
 */
export function isMinimumDepositError(error: unknown): error is MinimumDepositError {
  return error instanceof MinimumDepositError;
}

export function isInsufficientGasError(error: unknown): error is InsufficientGasError {
  return error instanceof InsufficientGasError;
}

export function isDepositTransactionError(error: unknown): error is DepositTransactionError {
  return error instanceof DepositTransactionError;
}

export function isInvalidDepositAddressError(error: unknown): error is InvalidDepositAddressError {
  return error instanceof InvalidDepositAddressError;
}

/**
 * Format a token amount with proper decimals
 */
function formatAmount(amount: string, decimals: number): string {
  const amountBigInt = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const integerPart = amountBigInt / divisor;
  const fractionalPart = amountBigInt % divisor;

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '').padEnd(2, '0');

  return `${integerPart}.${trimmedFractional}`;
}

/**
 * Encode function call data for EVM transactions
 */
function encodeFunctionData(
  functionName: string,
  args: (string | number | bigint)[]
): string {
  // Function selectors (first 4 bytes of keccak256 hash of function signature)
  // Verified via 4byte.directory
  const selectors: Record<string, string> = {
    'approve': '0x095ea7b3', // approve(address,uint256)
    'deposit': '0x2b2dfd2c', // deposit(uint256,uint32)
    'depositFor': '0x7a92539e', // depositFor(address,uint256,uint32)
    'allowance': '0xdd62ed3e', // allowance(address,address)
    'balanceOf': '0x70a08231', // balanceOf(address)
  };

  const selector = selectors[functionName];
  if (!selector) {
    throw new Error(`Unknown function: ${functionName}`);
  }

  // Encode arguments
  const encodedArgs = args.map((arg) => {
    if (typeof arg === 'string' && arg.startsWith('0x')) {
      // Address - pad to 32 bytes
      return arg.toLowerCase().replace('0x', '').padStart(64, '0');
    }
    // Number/BigInt - convert to hex and pad to 32 bytes
    const hex = BigInt(arg).toString(16);
    return hex.padStart(64, '0');
  });

  return selector + encodedArgs.join('');
}

/**
 * Make an eth_call to read contract state
 */
async function ethCall(to: string, data: string): Promise<string> {
  const response = await fetch(HYPEREVM_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new NetworkError('RPC call failed', {
      endpoint: HYPEREVM_RPC_URL,
      statusCode: response.status,
    });
  }

  const result = await response.json();
  if (result.error) {
    throw new NetworkError(`RPC error: ${result.error.message}`, {
      endpoint: HYPEREVM_RPC_URL,
    });
  }

  return result.result;
}

/**
 * Get the native HYPE balance for gas
 */
async function getGasBalance(address: string): Promise<string> {
  const response = await fetch(HYPEREVM_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    }),
  });

  if (!response.ok) {
    throw new NetworkError('Failed to get gas balance', {
      endpoint: HYPEREVM_RPC_URL,
      statusCode: response.status,
    });
  }

  const result = await response.json();
  if (result.error) {
    throw new NetworkError(`RPC error: ${result.error.message}`, {
      endpoint: HYPEREVM_RPC_URL,
    });
  }

  const balanceHex = result.result;
  if (!balanceHex || balanceHex === '0x') {
    return '0';
  }

  return BigInt(balanceHex).toString();
}

/**
 * Get USDC balance on HyperEVM
 */
async function getUsdcBalance(address: string): Promise<string> {
  const data = encodeFunctionData('balanceOf', [address]);
  const result = await ethCall(HYPEREVM_USDC_ADDRESS, data);

  if (!result || result === '0x') {
    return '0';
  }

  return BigInt(result).toString();
}

/**
 * Get current USDC allowance for CoreDepositWallet
 */
async function getAllowance(ownerAddress: string): Promise<string> {
  const data = encodeFunctionData('allowance', [ownerAddress, CORE_DEPOSIT_WALLET_ADDRESS]);
  const result = await ethCall(HYPEREVM_USDC_ADDRESS, data);

  if (!result || result === '0x') {
    return '0';
  }

  return BigInt(result).toString();
}

/**
 * Wait for a transaction to be mined using polling
 */
async function waitForTransaction(
  txHash: string,
  maxAttempts = 60,
  intervalMs = 2000
): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint; gasUsed: bigint }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(HYPEREVM_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      }),
    });

    if (!response.ok) {
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }

    const result = await response.json();
    if (result.result) {
      const receipt = result.result;
      return {
        status: receipt.status === '0x1' ? 'success' : 'reverted',
        blockNumber: BigInt(receipt.blockNumber),
        gasUsed: BigInt(receipt.gasUsed),
      };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new NetworkError('Transaction receipt timeout', {
    endpoint: HYPEREVM_RPC_URL,
  });
}

/**
 * Validate deposit requirements before execution
 *
 * Performs pre-flight checks:
 * - Validates amount is above minimum
 * - Checks USDC balance
 * - Checks gas (HYPE) balance
 * - Checks current allowance
 *
 * @param walletAddress - The wallet address to validate
 * @param amount - The amount to deposit in smallest units
 * @returns Validation result with balances and approval status
 *
 * @example
 * ```typescript
 * const validation = await validateDepositRequirements(
 *   '0x1234...',
 *   '10000000' // 10 USDC
 * );
 *
 * if (!validation.valid) {
 *   console.error('Cannot deposit:', validation.error);
 * }
 *
 * if (validation.needsApproval) {
 *   // Will need to approve before deposit
 * }
 * ```
 */
export async function validateDepositRequirements(
  walletAddress: string,
  amount: string
): Promise<DepositValidation> {
  // Check minimum amount
  if (BigInt(amount) < BigInt(MINIMUM_DEPOSIT_AMOUNT)) {
    return {
      valid: false,
      usdcBalance: '0',
      usdcBalanceFormatted: '0.00',
      gasBalance: '0',
      currentAllowance: '0',
      needsApproval: true,
      error: `Minimum deposit is ${formatAmount(MINIMUM_DEPOSIT_AMOUNT, USDC_DECIMALS)} USDC`,
    };
  }

  // Fetch balances and allowance in parallel
  const [usdcBalance, gasBalance, currentAllowance] = await Promise.all([
    getUsdcBalance(walletAddress),
    getGasBalance(walletAddress),
    getAllowance(walletAddress),
  ]);

  // Estimate required gas (approval + deposit)
  const estimatedGasRequired = BigInt(DEFAULT_APPROVAL_GAS_LIMIT) + BigInt(DEFAULT_DEPOSIT_GAS_LIMIT);
  // Use a conservative gas price estimate (0.1 gwei = 100000000 wei)
  const estimatedGasCost = estimatedGasRequired * BigInt(100000000);

  // Check USDC balance
  if (BigInt(usdcBalance) < BigInt(amount)) {
    return {
      valid: false,
      usdcBalance,
      usdcBalanceFormatted: formatAmount(usdcBalance, USDC_DECIMALS),
      gasBalance,
      currentAllowance,
      needsApproval: BigInt(currentAllowance) < BigInt(amount),
      error: `Insufficient USDC balance. Required: ${formatAmount(amount, USDC_DECIMALS)}, Available: ${formatAmount(usdcBalance, USDC_DECIMALS)}`,
    };
  }

  // Check gas balance
  if (BigInt(gasBalance) < estimatedGasCost) {
    return {
      valid: false,
      usdcBalance,
      usdcBalanceFormatted: formatAmount(usdcBalance, USDC_DECIMALS),
      gasBalance,
      currentAllowance,
      needsApproval: BigInt(currentAllowance) < BigInt(amount),
      error: `Insufficient HYPE for gas fees. Please add HYPE to your wallet on HyperEVM.`,
    };
  }

  return {
    valid: true,
    usdcBalance,
    usdcBalanceFormatted: formatAmount(usdcBalance, USDC_DECIMALS),
    gasBalance,
    currentAllowance,
    needsApproval: BigInt(currentAllowance) < BigInt(amount),
  };
}

/**
 * Execute USDC approval for CoreDepositWallet
 *
 * @param signer - The wallet signer
 * @param amount - Amount to approve (or max uint256 for infinite approval)
 * @param onSubmitted - Callback when transaction is submitted
 * @returns Transaction hash and receipt
 */
export async function approveUsdcForDeposit(
  signer: DepositSigner,
  amount: string,
  onSubmitted?: (txHash: string) => void
): Promise<{ txHash: string; receipt: { status: 'success' | 'reverted'; blockNumber: bigint; gasUsed: bigint } }> {
  const data = encodeFunctionData('approve', [CORE_DEPOSIT_WALLET_ADDRESS, amount]);

  const txHash = await signer.sendTransaction({
    to: HYPEREVM_USDC_ADDRESS,
    data,
    gas: DEFAULT_APPROVAL_GAS_LIMIT,
    chainId: HYPEREVM_CHAIN_ID,
  });

  if (onSubmitted) {
    onSubmitted(txHash);
  }

  // Wait for confirmation
  const receipt = signer.waitForTransactionReceipt
    ? await signer.waitForTransactionReceipt(txHash)
    : await waitForTransaction(txHash);

  if (receipt.status === 'reverted') {
    throw new DepositTransactionError('USDC approval transaction reverted', {
      txHash,
      reason: 'Transaction reverted on-chain',
    });
  }

  return { txHash, receipt };
}

/**
 * Execute deposit to Hyperliquid L1 trading account
 *
 * Deposits USDC from HyperEVM to the user's Hyperliquid L1 (HyperCore) trading account.
 * This function handles the complete flow including:
 * - Pre-flight validation (balance, gas, allowance checks)
 * - USDC approval if needed
 * - Deposit transaction execution
 * - Transaction confirmation
 *
 * @param signer - The wallet signer for transaction signing
 * @param options - Deposit options including amount and callbacks
 * @returns DepositResult with transaction details
 * @throws MinimumDepositError if amount is below 5 USDC
 * @throws InsufficientBalanceError if USDC balance is insufficient
 * @throws InsufficientGasError if HYPE balance is insufficient for gas
 * @throws DepositTransactionError if the transaction fails
 *
 * @example
 * ```typescript
 * import { executeDeposit, DestinationDex } from '@mina-bridge/sdk';
 *
 * const result = await executeDeposit(walletSigner, {
 *   amount: '10000000', // 10 USDC
 *   walletAddress: '0x1234...',
 *   destinationDex: DestinationDex.PERPS, // Trading account
 *   onStatusChange: (status) => console.log('Status:', status),
 *   onDepositSubmitted: (txHash) => console.log('Deposit tx:', txHash),
 * });
 *
 * if (result.success) {
 *   console.log(`Deposited ${result.amountFormatted} USDC`);
 *   console.log('Deposit tx:', result.depositTxHash);
 * }
 * ```
 */
export async function executeDeposit(
  signer: DepositSigner,
  options: DepositOptions
): Promise<DepositResult> {
  const {
    amount,
    walletAddress,
    destinationDex = DestinationDex.PERPS,
    onDepositSubmitted,
    onApprovalSubmitted,
    onStatusChange,
    infiniteApproval = false,
  } = options;

  const updateStatus = (status: DepositStatus) => {
    if (onStatusChange) {
      onStatusChange(status);
    }
  };

  // Validate wallet address format
  if (!isValidAddress(walletAddress)) {
    throw new InvalidDepositAddressError(
      `Invalid wallet address format: ${walletAddress}`,
      { address: walletAddress }
    );
  }

  // Validate minimum amount
  if (BigInt(amount) < BigInt(MINIMUM_DEPOSIT_AMOUNT)) {
    throw new MinimumDepositError(
      `Minimum deposit is ${formatAmount(MINIMUM_DEPOSIT_AMOUNT, USDC_DECIMALS)} USDC`,
      {
        minimumAmount: MINIMUM_DEPOSIT_AMOUNT,
        requestedAmount: amount,
      }
    );
  }

  // Pre-flight validation
  updateStatus('checking_balance');
  const validation = await validateDepositRequirements(walletAddress, amount);

  if (!validation.valid) {
    if (validation.error?.includes('USDC balance')) {
      throw new InsufficientBalanceError(validation.error, {
        required: amount,
        available: validation.usdcBalance,
        token: 'USDC',
      });
    }
    if (validation.error?.includes('HYPE') || validation.error?.includes('gas')) {
      throw new InsufficientGasError(validation.error, {
        required: 'estimated gas cost',
        available: validation.gasBalance,
      });
    }
    throw new DepositTransactionError(validation.error || 'Validation failed', {});
  }

  let approvalTxHash: string | undefined;

  // Handle approval if needed
  if (validation.needsApproval) {
    updateStatus('checking_allowance');
    updateStatus('approving');

    try {
      const approvalAmount = infiniteApproval ? MAX_UINT256 : amount;
      const approvalResult = await approveUsdcForDeposit(
        signer,
        approvalAmount,
        (txHash) => {
          approvalTxHash = txHash;
          if (onApprovalSubmitted) {
            onApprovalSubmitted(txHash);
          }
          updateStatus('approval_pending');
        }
      );

      approvalTxHash = approvalResult.txHash;
      updateStatus('approval_confirmed');
    } catch (error) {
      if (isUserRejection(error)) {
        throw new UserRejectedError('User rejected the approval transaction', { step: 'approval' });
      }
      throw error;
    }
  }

  // Execute deposit
  updateStatus('depositing');

  const depositData = encodeFunctionData('deposit', [amount, destinationDex]);

  let depositTxHash: string;
  try {
    depositTxHash = await signer.sendTransaction({
      to: CORE_DEPOSIT_WALLET_ADDRESS,
      data: depositData,
      gas: DEFAULT_DEPOSIT_GAS_LIMIT,
      chainId: HYPEREVM_CHAIN_ID,
    });
  } catch (error) {
    if (isUserRejection(error)) {
      throw new UserRejectedError('User rejected the deposit transaction', { step: 'deposit' });
    }
    throw error;
  }

  if (onDepositSubmitted) {
    onDepositSubmitted(depositTxHash);
  }
  updateStatus('deposit_pending');

  // Wait for deposit confirmation
  const receipt = signer.waitForTransactionReceipt
    ? await signer.waitForTransactionReceipt(depositTxHash)
    : await waitForTransaction(depositTxHash);

  if (receipt.status === 'reverted') {
    updateStatus('failed');
    throw new DepositTransactionError('Deposit transaction reverted', {
      txHash: depositTxHash,
      reason: 'Transaction reverted on-chain',
    });
  }

  updateStatus('deposit_confirmed');
  updateStatus('completed');

  return {
    success: true,
    depositTxHash,
    approvalTxHash,
    amount,
    amountFormatted: formatAmount(amount, USDC_DECIMALS),
    destinationDex,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Execute deposit on behalf of another address
 *
 * Similar to executeDeposit but credits a different recipient address on HyperCore.
 * Useful for relayer patterns or depositing for sub-accounts.
 *
 * @param signer - The wallet signer (pays gas, USDC comes from this wallet)
 * @param recipientAddress - The address to credit on HyperCore
 * @param options - Deposit options
 * @returns DepositResult with transaction details
 */
export async function executeDepositFor(
  signer: DepositSigner,
  recipientAddress: string,
  options: Omit<DepositOptions, 'walletAddress'> & { walletAddress: string }
): Promise<DepositResult> {
  const {
    amount,
    walletAddress,
    destinationDex = DestinationDex.PERPS,
    onDepositSubmitted,
    onApprovalSubmitted,
    onStatusChange,
    infiniteApproval = false,
  } = options;

  const updateStatus = (status: DepositStatus) => {
    if (onStatusChange) {
      onStatusChange(status);
    }
  };

  // Validate wallet address format
  if (!isValidAddress(walletAddress)) {
    throw new InvalidDepositAddressError(
      `Invalid wallet address format: ${walletAddress}`,
      { address: walletAddress }
    );
  }

  // Validate recipient address format
  if (!isValidAddress(recipientAddress)) {
    throw new InvalidDepositAddressError(
      `Invalid recipient address format: ${recipientAddress}`,
      { address: recipientAddress }
    );
  }

  // Validate minimum amount
  if (BigInt(amount) < BigInt(MINIMUM_DEPOSIT_AMOUNT)) {
    throw new MinimumDepositError(
      `Minimum deposit is ${formatAmount(MINIMUM_DEPOSIT_AMOUNT, USDC_DECIMALS)} USDC`,
      {
        minimumAmount: MINIMUM_DEPOSIT_AMOUNT,
        requestedAmount: amount,
      }
    );
  }

  // Pre-flight validation
  updateStatus('checking_balance');
  const validation = await validateDepositRequirements(walletAddress, amount);

  if (!validation.valid) {
    if (validation.error?.includes('USDC balance')) {
      throw new InsufficientBalanceError(validation.error, {
        required: amount,
        available: validation.usdcBalance,
        token: 'USDC',
      });
    }
    if (validation.error?.includes('HYPE') || validation.error?.includes('gas')) {
      throw new InsufficientGasError(validation.error, {
        required: 'estimated gas cost',
        available: validation.gasBalance,
      });
    }
    throw new DepositTransactionError(validation.error || 'Validation failed', {});
  }

  let approvalTxHash: string | undefined;

  // Handle approval if needed
  if (validation.needsApproval) {
    updateStatus('checking_allowance');
    updateStatus('approving');

    try {
      const approvalAmount = infiniteApproval ? MAX_UINT256 : amount;
      const approvalResult = await approveUsdcForDeposit(
        signer,
        approvalAmount,
        (txHash) => {
          approvalTxHash = txHash;
          if (onApprovalSubmitted) {
            onApprovalSubmitted(txHash);
          }
          updateStatus('approval_pending');
        }
      );

      approvalTxHash = approvalResult.txHash;
      updateStatus('approval_confirmed');
    } catch (error) {
      if (isUserRejection(error)) {
        throw new UserRejectedError('User rejected the approval transaction', { step: 'approval' });
      }
      throw error;
    }
  }

  // Execute depositFor
  updateStatus('depositing');

  const depositData = encodeFunctionData('depositFor', [recipientAddress, amount, destinationDex]);

  let depositTxHash: string;
  try {
    depositTxHash = await signer.sendTransaction({
      to: CORE_DEPOSIT_WALLET_ADDRESS,
      data: depositData,
      gas: DEFAULT_DEPOSIT_GAS_LIMIT,
      chainId: HYPEREVM_CHAIN_ID,
    });
  } catch (error) {
    if (isUserRejection(error)) {
      throw new UserRejectedError('User rejected the deposit transaction', { step: 'deposit' });
    }
    throw error;
  }

  if (onDepositSubmitted) {
    onDepositSubmitted(depositTxHash);
  }
  updateStatus('deposit_pending');

  // Wait for deposit confirmation
  const receipt = signer.waitForTransactionReceipt
    ? await signer.waitForTransactionReceipt(depositTxHash)
    : await waitForTransaction(depositTxHash);

  if (receipt.status === 'reverted') {
    updateStatus('failed');
    throw new DepositTransactionError('Deposit transaction reverted', {
      txHash: depositTxHash,
      reason: 'Transaction reverted on-chain',
    });
  }

  updateStatus('deposit_confirmed');
  updateStatus('completed');

  return {
    success: true,
    depositTxHash,
    approvalTxHash,
    amount,
    amountFormatted: formatAmount(amount, USDC_DECIMALS),
    destinationDex,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  };
}

/**
 * Check current USDC allowance for CoreDepositWallet
 *
 * @param walletAddress - The wallet address to check
 * @returns Current allowance in smallest units
 */
export async function checkDepositAllowance(walletAddress: string): Promise<{
  allowance: string;
  allowanceFormatted: string;
}> {
  const allowance = await getAllowance(walletAddress);
  return {
    allowance,
    allowanceFormatted: formatAmount(allowance, USDC_DECIMALS),
  };
}
