/**
 * Deposit services for Hyperliquid integration
 */

export {
  detectUsdcArrival,
  detectUsdcArrivalFromSnapshot,
  snapshotUsdcBalance,
  checkUsdcBalance,
  UsdcArrivalTimeoutError,
  isUsdcArrivalTimeoutError,
  ARRIVAL_DETECTION_TIMEOUT_MS,
  ARRIVAL_POLL_INTERVAL_MS,
} from './detect-arrival';

export type {
  UsdcArrivalResult,
  DetectionOptions,
} from './detect-arrival';
