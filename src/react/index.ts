/**
 * @siphoyawe/mina-sdk/react
 * React hooks and components for the Mina Bridge SDK
 *
 * @example
 * ```tsx
 * import { MinaProvider, useMina } from '@siphoyawe/mina-sdk/react';
 *
 * // Wrap your app with MinaProvider
 * function App() {
 *   return (
 *     <MinaProvider config={{ integrator: 'my-app' }}>
 *       <BridgeWidget />
 *     </MinaProvider>
 *   );
 * }
 *
 * // Use the hook in child components
 * function BridgeWidget() {
 *   const { mina, isReady, error } = useMina();
 *   // ...
 * }
 * ```
 */

// Provider and context hook
export {
  MinaProvider,
  useMina,
  type MinaContextValue,
  type MinaProviderProps,
} from './MinaProvider';

// Re-export types commonly needed with React hooks
export type {
  MinaConfig,
  Chain,
  Token,
  Quote,
  QuoteParams,
  Balance,
  ExecutionResult,
  TransactionStatus,
  StepStatusPayload,
  TransactionStatusPayload,
  OnStepChange,
  OnStatusChange,
  SlippagePreset,
  RoutePreference,
} from '../types';

// Re-export the Mina class for type hints
export { Mina } from '../client';
