/**
 * Execution store for tracking bridge executions
 * Allows polling execution status via getExecutionStatus()
 */

import type { StepType, StepStatusPayload, TransactionStatusPayload } from './types';

/**
 * Stored execution state
 */
export interface ExecutionState {
  /** Unique execution ID */
  executionId: string;
  /** Associated quote ID */
  quoteId: string;
  /** Overall status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Current step index (0-based) */
  currentStepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Step statuses */
  steps: StepStatusPayload[];
  /** Bridge transaction hash */
  txHash: string | null;
  /** Receiving transaction hash */
  receivingTxHash: string | null;
  /** Input amount */
  fromAmount: string;
  /** Output amount */
  toAmount: string | null;
  /** Received amount after completion */
  receivedAmount: string | null;
  /** Source chain ID */
  fromChainId: number;
  /** Destination chain ID */
  toChainId: number;
  /** Progress percentage (0-100) */
  progress: number;
  /** Estimated time remaining in seconds */
  estimatedTime: number;
  /** Substatus message */
  substatus: string;
  /** Error (if failed) */
  error: Error | null;
  /** Number of retry attempts */
  retryCount: number;
  /** Previous errors from retry attempts */
  previousErrors: Error[];
  /** Step that failed (for retry) */
  failedStepIndex: number | null;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

/**
 * Execution status result returned by getExecutionStatus
 */
export interface ExecutionStatusResult {
  /** Execution ID */
  executionId: string;
  /** Whether execution exists */
  found: boolean;
  /** Overall status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** Current step info */
  currentStep: {
    index: number;
    type: StepType;
    status: 'pending' | 'active' | 'completed' | 'failed';
  } | null;
  /** All step statuses */
  steps: StepStatusPayload[];
  /** Progress percentage (0-100) */
  progress: number;
  /** Transaction hash */
  txHash: string | null;
  /** Receiving transaction hash */
  receivingTxHash: string | null;
  /** Error details (if failed) */
  error: {
    message: string;
    step: string | null;
    recoverable: boolean;
  } | null;
  /** Timestamps */
  timestamps: {
    created: number;
    updated: number;
  };
}

/**
 * Generate a unique execution ID
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `exec_${timestamp}_${random}`;
}

/**
 * In-memory execution store
 * In production, this could be persisted to localStorage or IndexedDB
 */
class ExecutionStore {
  private executions: Map<string, ExecutionState> = new Map();
  private maxExecutions = 100; // Limit to prevent memory issues

  /**
   * Create a new execution
   */
  create(params: {
    executionId: string;
    quoteId: string;
    steps: Array<{ id: string; type: StepType }>;
    fromAmount: string;
    toAmount: string;
    fromChainId: number;
    toChainId: number;
    estimatedTime: number;
  }): ExecutionState {
    // Clean up old executions if at limit
    if (this.executions.size >= this.maxExecutions) {
      this.cleanup();
    }

    const now = Date.now();
    const state: ExecutionState = {
      executionId: params.executionId,
      quoteId: params.quoteId,
      status: 'pending',
      currentStepIndex: 0,
      totalSteps: params.steps.length,
      steps: params.steps.map((step) => ({
        stepId: step.id,
        step: step.type,
        status: 'pending',
        txHash: null,
        error: null,
        timestamp: now,
      })),
      txHash: null,
      receivingTxHash: null,
      fromAmount: params.fromAmount,
      toAmount: params.toAmount,
      receivedAmount: null,
      fromChainId: params.fromChainId,
      toChainId: params.toChainId,
      progress: 0,
      estimatedTime: params.estimatedTime,
      substatus: 'Initializing...',
      error: null,
      retryCount: 0,
      previousErrors: [],
      failedStepIndex: null,
      createdAt: now,
      updatedAt: now,
    };

    this.executions.set(params.executionId, state);
    return state;
  }

  /**
   * Get an execution by ID
   */
  get(executionId: string): ExecutionState | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Update execution state
   */
  update(
    executionId: string,
    updates: Partial<Omit<ExecutionState, 'executionId' | 'quoteId' | 'createdAt'>>
  ): ExecutionState | undefined {
    const state = this.executions.get(executionId);
    if (!state) return undefined;

    const updated: ExecutionState = {
      ...state,
      ...updates,
      updatedAt: Date.now(),
    };

    this.executions.set(executionId, updated);
    return updated;
  }

  /**
   * Update a specific step status
   */
  updateStep(
    executionId: string,
    stepId: string,
    updates: Partial<Omit<StepStatusPayload, 'stepId' | 'timestamp'>>
  ): ExecutionState | undefined {
    const state = this.executions.get(executionId);
    if (!state) return undefined;

    const stepIndex = state.steps.findIndex((s) => s.stepId === stepId);
    if (stepIndex === -1) return undefined;

    const currentStep = state.steps[stepIndex]!;
    const updatedSteps = [...state.steps];
    updatedSteps[stepIndex] = {
      stepId: currentStep.stepId,
      step: updates.step ?? currentStep.step,
      status: updates.status ?? currentStep.status,
      txHash: updates.txHash !== undefined ? updates.txHash : currentStep.txHash,
      error: updates.error !== undefined ? updates.error : currentStep.error,
      timestamp: Date.now(),
    };

    return this.update(executionId, { steps: updatedSteps });
  }

  /**
   * Get execution status in standardized format
   */
  getStatus(executionId: string): ExecutionStatusResult {
    const state = this.executions.get(executionId);

    if (!state) {
      return {
        executionId,
        found: false,
        status: 'pending',
        currentStep: null,
        steps: [],
        progress: 0,
        txHash: null,
        receivingTxHash: null,
        error: null,
        timestamps: { created: 0, updated: 0 },
      };
    }

    const currentStep = state.steps[state.currentStepIndex];

    return {
      executionId,
      found: true,
      status: state.status,
      currentStep: currentStep
        ? {
            index: state.currentStepIndex,
            type: currentStep.step,
            status: currentStep.status,
          }
        : null,
      steps: state.steps,
      progress: state.progress,
      txHash: state.txHash,
      receivingTxHash: state.receivingTxHash,
      error: state.error
        ? {
            message: state.error.message,
            step: state.steps.find((s) => s.status === 'failed')?.stepId ?? null,
            recoverable: this.isRecoverableError(state.error),
          }
        : null,
      timestamps: {
        created: state.createdAt,
        updated: state.updatedAt,
      },
    };
  }

  /**
   * Check if an error is recoverable
   */
  private isRecoverableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    const nonRecoverablePatterns = [
      'user rejected',
      'user denied',
      'insufficient balance',
      'insufficient funds',
      'nonce too low',
    ];
    return !nonRecoverablePatterns.some((pattern) => message.includes(pattern));
  }

  /**
   * Get transaction status payload for callbacks
   */
  getTransactionStatus(executionId: string): TransactionStatusPayload | null {
    const state = this.executions.get(executionId);
    if (!state) return null;

    return {
      status: state.status,
      substatus: state.substatus,
      currentStep: state.currentStepIndex + 1, // 1-based for UI
      totalSteps: state.totalSteps,
      fromAmount: state.fromAmount,
      toAmount: state.toAmount,
      txHash: state.txHash ?? '',
      receivingTxHash: state.receivingTxHash,
      progress: state.progress,
      estimatedTime: state.estimatedTime,
    };
  }

  /**
   * Delete an execution
   */
  delete(executionId: string): boolean {
    return this.executions.delete(executionId);
  }

  /**
   * Clean up old completed/failed executions
   */
  private cleanup(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const [id, state] of this.executions) {
      // Remove completed/failed executions older than 1 hour
      if (
        (state.status === 'completed' || state.status === 'failed') &&
        now - state.updatedAt > oneHour
      ) {
        this.executions.delete(id);
      }
    }

    // If still over limit, remove oldest
    if (this.executions.size >= this.maxExecutions) {
      const sorted = Array.from(this.executions.entries()).sort(
        ([, a], [, b]) => a.createdAt - b.createdAt
      );
      const toRemove = sorted.slice(0, Math.floor(this.maxExecutions / 4));
      for (const [id] of toRemove) {
        this.executions.delete(id);
      }
    }
  }

  /**
   * Get all executions (for debugging/testing)
   */
  getAll(): ExecutionState[] {
    return Array.from(this.executions.values());
  }

  /**
   * Clear all executions
   */
  clear(): void {
    this.executions.clear();
  }
}

// Singleton instance
export const executionStore = new ExecutionStore();
