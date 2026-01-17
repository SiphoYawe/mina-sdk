/**
 * @siphoyawe/mina-sdk/react
 * React hooks and components for the Mina Bridge SDK
 *
 * @example
 * ```tsx
 * import {
 *   MinaProvider,
 *   useMina,
 *   useQuote,
 *   useTransactionStatus,
 *   useTokenBalance,
 * } from '@siphoyawe/mina-sdk/react';
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
 * // Use hooks in child components
 * function BridgeWidget() {
 *   const { mina, isReady, error } = useMina();
 *
 *   // Fetch token balances with automatic refetching
 *   const { formattedBalance, symbol } = useTokenBalance({
 *     chainId: 1,
 *     tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 *     walletAddress: '0x...',
 *     refetchInterval: 10000, // Refresh every 10 seconds
 *   });
 *
 *   // Fetch quotes with automatic debounced refetching
 *   const { quote, isLoading } = useQuote({
 *     fromChain: 1,
 *     toChain: 999,
 *     fromToken: '0x...',
 *     toToken: '0x...',
 *     amount: '1000000000',
 *     fromAddress: '0x...',
 *   });
 *
 *   // Track transaction status with polling
 *   const { status } = useTransactionStatus(txHash);
 *
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

// Quote hook with debounced fetching
export { useQuote, type UseQuoteParams, type UseQuoteReturn } from './use-quote';

// Transaction status hook with polling
export {
  useTransactionStatus,
  type UseTransactionStatusReturn,
} from './use-transaction-status';

// Token balance hook with automatic refetching
export {
  useTokenBalance,
  type UseTokenBalanceParams,
  type UseTokenBalanceReturn,
} from './use-token-balance';

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
