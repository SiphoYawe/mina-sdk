/**
 * Event system for the Mina SDK
 * Provides typed event emitter with on/off/once methods
 */

import type {
  StepType,
  StepStatusPayload,
  TransactionStatusPayload,
} from './types';

// Re-export types from types.ts for convenience
export type {
  StepType,
  StepStatusPayload,
  TransactionStatusPayload,
  OnStepChange,
  OnStatusChange,
} from './types';

/**
 * SDK event names
 */
export const SDK_EVENTS = {
  /** Emitted when a quote is updated/refreshed */
  QUOTE_UPDATED: 'quoteUpdated',
  /** Emitted when execution starts */
  EXECUTION_STARTED: 'executionStarted',
  /** Emitted when current step changes */
  STEP_CHANGED: 'stepChanged',
  /** Emitted when token approval is required */
  APPROVAL_REQUIRED: 'approvalRequired',
  /** Emitted when a transaction is sent */
  TRANSACTION_SENT: 'transactionSent',
  /** Emitted when a transaction is confirmed */
  TRANSACTION_CONFIRMED: 'transactionConfirmed',
  /** Emitted when deposit to Hyperliquid L1 starts */
  DEPOSIT_STARTED: 'depositStarted',
  /** Emitted when deposit to Hyperliquid L1 completes */
  DEPOSIT_COMPLETED: 'depositCompleted',
  /** Emitted when full execution completes */
  EXECUTION_COMPLETED: 'executionCompleted',
  /** Emitted when execution fails */
  EXECUTION_FAILED: 'executionFailed',
  /** Emitted when overall status changes */
  STATUS_CHANGED: 'statusChanged',
} as const;

export type SDKEventName = typeof SDK_EVENTS[keyof typeof SDK_EVENTS];

/**
 * Event payload types for each event
 */
export interface SDKEventPayloads {
  [SDK_EVENTS.QUOTE_UPDATED]: { quoteId: string; timestamp: number };
  [SDK_EVENTS.EXECUTION_STARTED]: { executionId: string; quoteId: string; timestamp: number };
  [SDK_EVENTS.STEP_CHANGED]: StepStatusPayload;
  [SDK_EVENTS.APPROVAL_REQUIRED]: { tokenAddress: string; amount: string; spender: string };
  [SDK_EVENTS.TRANSACTION_SENT]: { txHash: string; chainId: number; stepType: StepType };
  [SDK_EVENTS.TRANSACTION_CONFIRMED]: { txHash: string; chainId: number; stepType: StepType };
  [SDK_EVENTS.DEPOSIT_STARTED]: { amount: string; walletAddress: string };
  [SDK_EVENTS.DEPOSIT_COMPLETED]: { txHash: string; amount: string };
  [SDK_EVENTS.EXECUTION_COMPLETED]: { executionId: string; txHash: string; receivedAmount: string | null };
  [SDK_EVENTS.EXECUTION_FAILED]: { executionId: string; error: Error; step: string | null };
  [SDK_EVENTS.STATUS_CHANGED]: TransactionStatusPayload;
}

type EventCallback<T = unknown> = (data: T) => void;

/**
 * Typed event emitter for SDK events
 */
export class SDKEventEmitter {
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private onceListeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param callback - Callback function
   */
  on<K extends SDKEventName>(event: K, callback: EventCallback<SDKEventPayloads[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name
   * @param callback - Callback function to remove
   */
  off<K extends SDKEventName>(event: K, callback: EventCallback<SDKEventPayloads[K]>): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback as EventCallback);
    }
    const onceEventListeners = this.onceListeners.get(event);
    if (onceEventListeners) {
      onceEventListeners.delete(callback as EventCallback);
    }
  }

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   * @param event - Event name
   * @param callback - Callback function
   */
  once<K extends SDKEventName>(event: K, callback: EventCallback<SDKEventPayloads[K]>): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(callback as EventCallback);
  }

  /**
   * Emit an event
   * @param event - Event name
   * @param data - Event data
   */
  emit<K extends SDKEventName>(event: K, data: SDKEventPayloads[K]): void {
    // Call regular listeners
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      for (const listener of eventListeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      }
    }

    // Call and remove once listeners
    const onceEventListeners = this.onceListeners.get(event);
    if (onceEventListeners) {
      for (const listener of onceEventListeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in once listener for ${event}:`, error);
        }
      }
      this.onceListeners.delete(event);
    }
  }

  /**
   * Remove all listeners for an event (or all events)
   * @param event - Optional event name (clears all if not provided)
   */
  removeAllListeners(event?: SDKEventName): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /**
   * Get listener count for an event
   * @param event - Event name
   */
  listenerCount(event: SDKEventName): number {
    const regular = this.listeners.get(event)?.size ?? 0;
    const once = this.onceListeners.get(event)?.size ?? 0;
    return regular + once;
  }
}

/**
 * Calculate progress percentage
 * @param currentStep - Current step index (0-based)
 * @param totalSteps - Total number of steps
 * @param stepProgress - Progress within current step (0-1, optional)
 */
export function calculateProgress(
  currentStep: number,
  totalSteps: number,
  stepProgress: number = 0
): number {
  if (totalSteps === 0) return 0;
  const baseProgress = (currentStep / totalSteps) * 100;
  const stepContribution = (stepProgress / totalSteps) * 100;
  return Math.min(100, Math.round(baseProgress + stepContribution));
}

/**
 * Map LI.FI substatus to user-friendly message
 */
export function mapSubstatusToMessage(substatus: string): string {
  const statusMessages: Record<string, string> = {
    // Pending states
    'PENDING': 'Transaction pending...',
    'NOT_PROCESSABLE_REFUND_NEEDED': 'Refund needed',
    'UNKNOWN': 'Processing transaction...',

    // Bridge states
    'BRIDGE_NOT_AVAILABLE': 'Bridge temporarily unavailable',
    'CHAIN_NOT_AVAILABLE': 'Chain temporarily unavailable',
    'REFUND_IN_PROGRESS': 'Refund in progress',
    'COMPLETED': 'Transaction completed',

    // Swap states
    'WAIT_SOURCE_CONFIRMATIONS': 'Waiting for source chain confirmations...',
    'WAIT_DESTINATION_TRANSACTION': 'Waiting for destination transaction...',

    // Transfer states
    'PARTIAL': 'Partial transfer completed',
    'REFUNDED': 'Transaction refunded',
    'NOT_FOUND': 'Transaction not found',
  };

  return statusMessages[substatus] || `Status: ${substatus}`;
}
