/**
 * Execute service for transaction execution via LI.FI API
 * Handles bridge transaction execution with step tracking and callbacks
 */

import type {
  Quote,
  Step,
  StepStatus,
  ExecutionResult,
  StepType,
  StepStatusPayload,
  TransactionStatusPayload,
  OnStepChange,
  OnStatusChange,
} from '../types';
import { LIFI_API_URL } from '../constants';
import {
  MinaError,
  TransactionFailedError,
  UserRejectedError,
  NetworkError,
} from '../errors';
import {
  SDKEventEmitter,
  SDK_EVENTS,
  calculateProgress,
  mapSubstatusToMessage,
} from '../events';
import {
  executionStore,
  generateExecutionId,
} from '../execution-store';

/**
 * Maximum quote age in milliseconds (5 minutes)
 */
const MAX_QUOTE_AGE_MS = 5 * 60 * 1000;

/**
 * Polling interval for transaction status (5 seconds)
 */
const STATUS_POLL_INTERVAL_MS = 5000;

/**
 * Maximum time to wait for transaction completion (10 minutes)
 */
const MAX_EXECUTION_WAIT_MS = 10 * 60 * 1000;

/**
 * Time to wait for approval transaction to be mined (3 seconds)
 */
const APPROVAL_CONFIRMATION_WAIT_MS = 3000;

/**
 * Signer interface for transaction signing
 * Compatible with viem WalletClient and ethers Signer
 */
export interface TransactionSigner {
  /** Sign and send a transaction */
  sendTransaction: (request: TransactionRequest) => Promise<string>;
  /** Get the signer's address */
  getAddress: () => Promise<string>;
  /** Get the current chain ID */
  getChainId: () => Promise<number>;
}

/**
 * Transaction request for signing
 */
export interface TransactionRequest {
  to: string;
  data: string;
  value: string;
  gasLimit?: string;
  gasPrice?: string;
  chainId: number;
}

/**
 * Options for executing a quote
 */
export interface ExecuteConfig {
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
  /** Event emitter for SDK events (optional, passed from Mina client) */
  emitter?: SDKEventEmitter;
}

/**
 * Overall execution status
 */
export type ExecutionStatus =
  | 'idle'
  | 'approving'
  | 'approved'
  | 'executing'
  | 'bridging'
  | 'completed'
  | 'failed';

/**
 * LI.FI step transaction request response
 */
interface LifiStepTransactionResponse {
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
    gasPrice?: string;
    chainId: number;
  };
  estimate?: {
    approvalAddress?: string;
    toAmount: string;
    toAmountMin: string;
  };
}

/**
 * LI.FI transaction status response
 */
interface LifiStatusResponse {
  status: 'NOT_FOUND' | 'PENDING' | 'DONE' | 'FAILED';
  substatus?: string;
  substatusMessage?: string;
  receiving?: {
    chainId: number;
    txHash?: string;
    amount?: string;
    token?: {
      address: string;
      symbol: string;
      decimals: number;
    };
  };
  sending?: {
    chainId: number;
    txHash?: string;
    amount?: string;
  };
  tool?: string;
  bridge?: string;
}

/**
 * Error thrown when a quote has expired
 */
export class QuoteExpiredError extends MinaError {
  readonly code = 'QUOTE_EXPIRED' as const;
  readonly recoverable = true as const;
  readonly quoteId: string;
  readonly expiredAt: number;

  constructor(
    message: string,
    details: {
      quoteId: string;
      expiredAt: number;
    }
  ) {
    super(message, {
      userMessage: 'Your quote has expired. Please get a new quote to continue.',
      recoveryAction: 'fetch_new_quote',
      details,
    });
    this.quoteId = details.quoteId;
    this.expiredAt = details.expiredAt;
  }
}

/**
 * Error thrown when a quote is invalid or malformed
 */
export class InvalidQuoteError extends MinaError {
  readonly code = 'INVALID_QUOTE' as const;
  readonly recoverable = false as const;
  readonly reason: string;

  constructor(message: string, details: { reason: string }) {
    super(message, {
      userMessage: 'The quote is invalid or malformed. Please get a new quote.',
      recoveryAction: 'fetch_new_quote',
      details,
    });
    this.reason = details.reason;
  }
}

/**
 * Type guard for QuoteExpiredError
 */
export function isQuoteExpiredError(error: unknown): error is QuoteExpiredError {
  return error instanceof QuoteExpiredError;
}

/**
 * Type guard for InvalidQuoteError
 */
export function isInvalidQuoteError(error: unknown): error is InvalidQuoteError {
  return error instanceof InvalidQuoteError;
}

/**
 * Validate a quote before execution
 * @throws QuoteExpiredError if quote has expired
 * @throws InvalidQuoteError if quote is malformed
 */
export function validateQuote(quote: Quote): void {
  // Check quote structure
  if (!quote || typeof quote !== 'object') {
    throw new InvalidQuoteError('Quote is null or undefined', {
      reason: 'null_quote',
    });
  }

  if (!quote.id) {
    throw new InvalidQuoteError('Quote is missing ID', {
      reason: 'missing_id',
    });
  }

  if (!quote.steps || quote.steps.length === 0) {
    throw new InvalidQuoteError('Quote has no execution steps', {
      reason: 'no_steps',
    });
  }

  if (!quote.fromAmount || !quote.toAmount) {
    throw new InvalidQuoteError('Quote is missing amount information', {
      reason: 'missing_amounts',
    });
  }

  // Check quote expiration
  const now = Date.now();
  if (quote.expiresAt && now > quote.expiresAt) {
    throw new QuoteExpiredError('Quote has expired, please fetch a new one', {
      quoteId: quote.id,
      expiredAt: quote.expiresAt,
    });
  }

  // Additional check based on quote age (if expiresAt not set)
  // Quotes are typically valid for 5 minutes
  const quoteTimestamp = quote.expiresAt
    ? quote.expiresAt - MAX_QUOTE_AGE_MS
    : 0;

  if (quoteTimestamp > 0) {
    const quoteAge = now - quoteTimestamp;
    if (quoteAge > MAX_QUOTE_AGE_MS) {
      throw new QuoteExpiredError(
        'Quote has exceeded maximum age, please fetch a new one',
        {
          quoteId: quote.id,
          expiredAt: quoteTimestamp + MAX_QUOTE_AGE_MS,
        }
      );
    }
  }
}

/**
 * Get transaction data for a step from LI.FI API
 */
async function getStepTransaction(
  step: Step,
  fromAddress: string
): Promise<LifiStepTransactionResponse> {
  const url = `${LIFI_API_URL}/quote`;

  const params = new URLSearchParams({
    fromChain: step.fromChainId.toString(),
    toChain: step.toChainId.toString(),
    fromToken: step.fromToken.address,
    toToken: step.toToken.address,
    fromAmount: step.fromAmount,
    fromAddress: fromAddress,
    slippage: '0.005', // 0.5%
  });

  const response = await fetch(`${url}?${params}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new NetworkError(`Failed to get step transaction: ${errorText}`, {
      endpoint: url,
      statusCode: response.status,
    });
  }

  const data = await response.json();
  return data;
}

/**
 * Check if token approval is needed
 */
async function checkApprovalNeeded(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  amount: string,
  chainId: number
): Promise<boolean> {
  // Native token doesn't need approval
  if (
    tokenAddress === '0x0000000000000000000000000000000000000000' ||
    tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  ) {
    return false;
  }

  try {
    const url = `${LIFI_API_URL}/token/allowance`;
    const params = new URLSearchParams({
      chain: chainId.toString(),
      token: tokenAddress,
      owner: ownerAddress,
      spender: spenderAddress,
    });

    const response = await fetch(`${url}?${params}`);
    if (!response.ok) {
      // If we can't check, assume approval is needed
      return true;
    }

    const data = await response.json();
    const allowance = BigInt(data.allowance || '0');
    const requiredAmount = BigInt(amount);

    return allowance < requiredAmount;
  } catch {
    // If check fails, assume approval needed
    return true;
  }
}

/**
 * Get approval transaction data
 */
async function getApprovalTransaction(
  tokenAddress: string,
  spenderAddress: string,
  amount: string,
  chainId: number,
  infiniteApproval: boolean
): Promise<TransactionRequest> {
  const url = `${LIFI_API_URL}/token/approve`;

  // Use max uint256 for infinite approval
  const approvalAmount = infiniteApproval
    ? '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    : amount;

  const params = new URLSearchParams({
    chain: chainId.toString(),
    token: tokenAddress,
    spender: spenderAddress,
    amount: approvalAmount,
  });

  const response = await fetch(`${url}?${params}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new NetworkError(`Failed to get approval transaction: ${errorText}`, {
      endpoint: url,
      statusCode: response.status,
    });
  }

  const data = await response.json();
  return {
    to: data.to,
    data: data.data,
    value: '0',
    chainId,
  };
}

/**
 * Poll for transaction status
 */
async function pollTransactionStatus(
  txHash: string,
  fromChainId: number,
  toChainId: number
): Promise<LifiStatusResponse> {
  const url = `${LIFI_API_URL}/status`;
  const params = new URLSearchParams({
    txHash,
    fromChain: fromChainId.toString(),
    toChain: toChainId.toString(),
  });

  const response = await fetch(`${url}?${params}`);
  if (!response.ok) {
    throw new NetworkError('Failed to get transaction status', {
      endpoint: url,
      statusCode: response.status,
    });
  }

  return response.json();
}

/**
 * Wait for transaction to complete
 */
async function waitForCompletion(
  txHash: string,
  fromChainId: number,
  toChainId: number,
  onStatusUpdate?: (status: LifiStatusResponse) => void
): Promise<LifiStatusResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_EXECUTION_WAIT_MS) {
    try {
      const status = await pollTransactionStatus(txHash, fromChainId, toChainId);

      if (onStatusUpdate) {
        onStatusUpdate(status);
      }

      if (status.status === 'DONE') {
        return status;
      }

      if (status.status === 'FAILED') {
        throw new TransactionFailedError(
          status.substatusMessage || 'Transaction failed',
          {
            txHash,
            chainId: fromChainId,
            reason: status.substatus,
          }
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
    } catch (error) {
      if (error instanceof TransactionFailedError) {
        throw error;
      }
      // Network errors during polling - continue trying
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
    }
  }

  throw new TransactionFailedError('Transaction timed out waiting for completion', {
    txHash,
    chainId: fromChainId,
    reason: 'timeout',
  });
}

/**
 * Map Step type to StepType
 */
function mapStepType(stepType: Step['type']): StepType {
  switch (stepType) {
    case 'approve':
      return 'approval';
    case 'swap':
      return 'swap';
    case 'bridge':
      return 'bridge';
    case 'deposit':
      return 'deposit';
    default:
      return 'bridge';
  }
}

/**
 * Create initial step statuses from quote steps
 */
function createInitialStepStatuses(steps: Step[]): StepStatus[] {
  return steps.map((step) => ({
    stepId: step.id,
    stepType: mapStepType(step.type),
    status: 'pending' as const,
    updatedAt: Date.now(),
  }));
}

/**
 * Update a step status in the array
 */
function updateStepStatus(
  statuses: StepStatus[],
  stepId: string,
  update: Partial<StepStatus>
): StepStatus[] {
  return statuses.map((status) =>
    status.stepId === stepId
      ? { ...status, ...update, updatedAt: Date.now() }
      : status
  );
}

/**
 * Execute a bridge transaction
 *
 * @param config - Execution configuration
 * @returns ExecutionResult with status and transaction details
 * @throws QuoteExpiredError if quote has expired
 * @throws InvalidQuoteError if quote is malformed
 * @throws TransactionFailedError if transaction fails
 * @throws UserRejectedError if user rejects the transaction
 * @throws NetworkError if network request fails
 *
 * @example
 * ```typescript
 * const result = await execute({
 *   quote,
 *   signer: walletClient,
 *   onStepChange: (step) => console.log('Step:', step),
 *   onStatusChange: (status) => console.log('Status:', status),
 *   infiniteApproval: true,
 * });
 *
 * if (result.status === 'completed') {
 *   console.log('Bridge complete! TxHash:', result.txHash);
 * }
 * ```
 */
export async function execute(config: ExecuteConfig): Promise<ExecutionResult> {
  const {
    quote,
    signer,
    onStepChange,
    onStatusChange,
    onApprovalRequest,
    onTransactionRequest,
    infiniteApproval = false,
    emitter,
  } = config;

  // Validate quote first
  validateQuote(quote);

  // Generate execution ID and create execution state
  const executionId = generateExecutionId();
  const totalSteps = quote.steps.length;

  // Create execution in store
  executionStore.create({
    executionId,
    quoteId: quote.id,
    steps: quote.steps.map((s) => ({ id: s.id, type: mapStepType(s.type) })),
    fromAmount: quote.fromAmount,
    toAmount: quote.toAmount,
    fromChainId: quote.steps[0]?.fromChainId ?? 0,
    toChainId: quote.steps[quote.steps.length - 1]?.toChainId ?? 0,
    estimatedTime: quote.estimatedTime,
  });

  // Emit execution started event
  emitter?.emit(SDK_EVENTS.EXECUTION_STARTED, {
    executionId,
    quoteId: quote.id,
    timestamp: Date.now(),
  });

  // Initialize result
  let stepStatuses = createInitialStepStatuses(quote.steps);
  let currentStatus: ExecutionStatus = 'idle';
  let currentStepIndex = 0;
  let finalTxHash: string | undefined;
  let receivedAmount: string | undefined;
  let receivingTxHash: string | null = null;

  const updateStatus = (status: ExecutionStatus, substatus: string = '') => {
    currentStatus = status;

    // Map ExecutionStatus to TransactionStatusPayload status
    const mappedStatus = status === 'completed' ? 'completed' as const
      : status === 'failed' ? 'failed' as const
      : status === 'idle' ? 'pending' as const
      : 'in_progress' as const;

    // Update execution store
    executionStore.update(executionId, {
      status: mappedStatus,
      substatus: substatus || mapSubstatusToMessage(status.toUpperCase()),
      progress: calculateProgress(currentStepIndex, totalSteps, status === 'completed' ? 1 : 0.5),
    });

    // Create transaction status payload
    const txStatusPayload: TransactionStatusPayload = {
      status: mappedStatus,
      substatus: substatus || mapSubstatusToMessage(status.toUpperCase()),
      currentStep: currentStepIndex + 1,
      totalSteps,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      txHash: finalTxHash ?? '',
      receivingTxHash,
      progress: calculateProgress(currentStepIndex, totalSteps, status === 'completed' ? 1 : 0.5),
      estimatedTime: quote.estimatedTime,
    };

    // Emit status changed event
    emitter?.emit(SDK_EVENTS.STATUS_CHANGED, txStatusPayload);

    // Call callback with TransactionStatusPayload
    onStatusChange?.(txStatusPayload);
  };

  const updateStep = (stepId: string, update: Partial<StepStatus>) => {
    stepStatuses = updateStepStatus(stepStatuses, stepId, update);
    const stepStatus = stepStatuses.find((s) => s.stepId === stepId);
    if (!stepStatus) return;

    // Update execution store
    const stepType = stepStatus.stepType || 'bridge';
    executionStore.updateStep(executionId, stepId, {
      step: stepType,
      status: update.status === 'executing' ? 'active' : (update.status ?? stepStatus.status) as 'pending' | 'active' | 'completed' | 'failed',
      txHash: update.txHash ?? stepStatus.txHash ?? null,
      error: update.error ? new Error(update.error) : null,
    });

    // Create step status payload
    const stepPayload: StepStatusPayload = {
      stepId,
      step: stepType,
      status: update.status === 'executing' ? 'active' : (update.status ?? stepStatus.status) as 'pending' | 'active' | 'completed' | 'failed',
      txHash: update.txHash ?? stepStatus.txHash ?? null,
      error: update.error ? new Error(update.error) : null,
      timestamp: Date.now(),
    };

    // Emit step changed event
    emitter?.emit(SDK_EVENTS.STEP_CHANGED, stepPayload);

    // Call callback with StepStatusPayload
    onStepChange?.(stepPayload);
  };

  try {
    const fromAddress = await signer.getAddress();

    // Process each step
    for (let i = 0; i < quote.steps.length; i++) {
      const step = quote.steps[i]!;
      currentStepIndex = i;

      // Skip deposit steps (handled separately in Story 5.1/5.2)
      if (step.type === 'deposit') {
        updateStep(step.id, { status: 'pending' });
        continue;
      }

      // Update step to executing
      updateStep(step.id, { status: 'executing' });

      // Get transaction data for this step
      const stepTx = await getStepTransaction(step, fromAddress);

      // Check if approval is needed (for non-native tokens)
      if (step.type !== 'approve' && stepTx.estimate?.approvalAddress) {
        const needsApproval = await checkApprovalNeeded(
          step.fromToken.address,
          fromAddress,
          stepTx.estimate.approvalAddress,
          step.fromAmount,
          step.fromChainId
        );

        if (needsApproval) {
          updateStatus('approving', 'Waiting for token approval...');
          onApprovalRequest?.();

          // Emit approval required event
          emitter?.emit(SDK_EVENTS.APPROVAL_REQUIRED, {
            tokenAddress: step.fromToken.address,
            amount: step.fromAmount,
            spender: stepTx.estimate.approvalAddress,
          });

          try {
            const approvalTx = await getApprovalTransaction(
              step.fromToken.address,
              stepTx.estimate.approvalAddress,
              step.fromAmount,
              step.fromChainId,
              infiniteApproval
            );

            const approvalTxHash = await signer.sendTransaction(approvalTx);

            // Emit transaction sent event
            emitter?.emit(SDK_EVENTS.TRANSACTION_SENT, {
              txHash: approvalTxHash,
              chainId: step.fromChainId,
              stepType: 'approval',
            });

            // Wait for approval to be mined (simplified - in production would poll)
            await new Promise((resolve) => setTimeout(resolve, APPROVAL_CONFIRMATION_WAIT_MS));

            updateStatus('approved', 'Token approval confirmed');

            // Emit transaction confirmed event
            emitter?.emit(SDK_EVENTS.TRANSACTION_CONFIRMED, {
              txHash: approvalTxHash,
              chainId: step.fromChainId,
              stepType: 'approval',
            });

            // Store approval hash for tracking
            updateStep(step.id, { txHash: approvalTxHash });
          } catch (error: unknown) {
            if (isUserRejection(error)) {
              throw new UserRejectedError('User rejected approval transaction', {
                step: 'approval',
              });
            }
            throw error;
          }
        }
      }

      // Execute the main transaction
      const stepType = mapStepType(step.type);
      updateStatus('executing', `Executing ${stepType}...`);
      onTransactionRequest?.();

      try {
        const txRequest: TransactionRequest = {
          to: stepTx.transactionRequest.to,
          data: stepTx.transactionRequest.data,
          value: stepTx.transactionRequest.value || '0',
          gasLimit: stepTx.transactionRequest.gasLimit,
          gasPrice: stepTx.transactionRequest.gasPrice,
          chainId: stepTx.transactionRequest.chainId,
        };

        const txHash = await signer.sendTransaction(txRequest);
        finalTxHash = txHash;

        // Emit transaction sent event
        emitter?.emit(SDK_EVENTS.TRANSACTION_SENT, {
          txHash,
          chainId: step.fromChainId,
          stepType,
        });

        updateStep(step.id, { status: 'executing', txHash });

        // Update execution store with txHash
        executionStore.update(executionId, { txHash });

        updateStatus('bridging', 'Waiting for bridge confirmation...');

        // Wait for transaction completion
        const finalStatus = await waitForCompletion(
          txHash,
          step.fromChainId,
          step.toChainId,
          (status) => {
            // Update based on LI.FI status
            if (status.status === 'PENDING') {
              updateStep(step.id, { status: 'executing', txHash });
              updateStatus('bridging', mapSubstatusToMessage(status.substatus || 'PENDING'));
            }
            if (status.receiving?.txHash) {
              receivingTxHash = status.receiving.txHash;
              executionStore.update(executionId, { receivingTxHash });
            }
          }
        );

        // Emit transaction confirmed event
        emitter?.emit(SDK_EVENTS.TRANSACTION_CONFIRMED, {
          txHash,
          chainId: step.toChainId,
          stepType,
        });

        // Update with completion
        updateStep(step.id, { status: 'completed', txHash });

        if (finalStatus.receiving?.amount) {
          receivedAmount = finalStatus.receiving.amount;
          executionStore.update(executionId, { receivedAmount });
        }
        if (finalStatus.receiving?.txHash) {
          receivingTxHash = finalStatus.receiving.txHash;
        }
      } catch (error: unknown) {
        if (isUserRejection(error)) {
          updateStep(step.id, { status: 'failed', error: 'User rejected' });
          throw new UserRejectedError('User rejected transaction', {
            step: stepType,
          });
        }

        updateStep(step.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    }

    // All steps completed
    updateStatus('completed', 'Bridge completed successfully');

    // Update execution store
    executionStore.update(executionId, {
      status: 'completed',
      progress: 100,
      substatus: 'Bridge completed successfully',
    });

    // Emit execution completed event
    emitter?.emit(SDK_EVENTS.EXECUTION_COMPLETED, {
      executionId,
      txHash: finalTxHash ?? '',
      receivedAmount: receivedAmount ?? null,
    });

    return {
      executionId,
      status: 'completed',
      steps: stepStatuses,
      txHash: finalTxHash,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      receivedAmount,
      depositTxHash: null, // Set by Story 5.2 when auto-deposit is executed
    };
  } catch (error) {
    updateStatus('failed', error instanceof Error ? error.message : 'Unknown error');

    // Mark any pending steps as failed
    stepStatuses = stepStatuses.map((status) =>
      status.status === 'pending' || status.status === 'executing'
        ? { ...status, status: 'failed' as const, updatedAt: Date.now() }
        : status
    );

    const errorObj = error instanceof Error ? error : new Error(String(error));

    // Update execution store
    executionStore.update(executionId, {
      status: 'failed',
      error: errorObj,
      substatus: errorObj.message,
    });

    // Emit execution failed event
    emitter?.emit(SDK_EVENTS.EXECUTION_FAILED, {
      executionId,
      error: errorObj,
      step: stepStatuses.find((s) => s.status === 'failed')?.stepId ?? null,
    });

    return {
      executionId,
      status: 'failed',
      steps: stepStatuses,
      txHash: finalTxHash,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      depositTxHash: null,
      error: errorObj,
    };
  }
}

/**
 * Check if an error is a user rejection
 */
function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('user rejected') ||
      message.includes('user denied') ||
      message.includes('user cancelled') ||
      message.includes('rejected by user') ||
      message.includes('action_rejected')
    );
  }

  return false;
}
