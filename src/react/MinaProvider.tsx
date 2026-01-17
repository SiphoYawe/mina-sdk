'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { Mina } from '../client';
import type { MinaConfig } from '../types';

/**
 * Context value provided by MinaProvider
 */
export interface MinaContextValue {
  /** The configured Mina SDK instance */
  mina: Mina | null;
  /** Whether the SDK has completed initialization */
  isReady: boolean;
  /** Any initialization error that occurred */
  error: Error | null;
}

const MinaContext = createContext<MinaContextValue | null>(null);
MinaContext.displayName = 'MinaContext';

/**
 * Props for the MinaProvider component
 */
export interface MinaProviderProps {
  /**
   * Configuration for the Mina SDK instance
   * @example
   * ```tsx
   * <MinaProvider config={{ integrator: 'my-app', autoDeposit: true }}>
   *   <App />
   * </MinaProvider>
   * ```
   */
  config: MinaConfig;
  /** Child components that will have access to the Mina context */
  children: ReactNode;
}

/**
 * React context provider that initializes and shares a Mina SDK instance
 *
 * Wrap your application (or the part that needs bridge functionality) with
 * MinaProvider to make the SDK available to all child components via the
 * useMina hook.
 *
 * @example
 * ```tsx
 * // In your app's root or layout
 * import { MinaProvider } from '@siphoyawe/mina-sdk/react';
 *
 * function App() {
 *   return (
 *     <MinaProvider config={{ integrator: 'my-app' }}>
 *       <BridgeWidget />
 *     </MinaProvider>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With full configuration
 * <MinaProvider
 *   config={{
 *     integrator: 'my-dapp',
 *     autoDeposit: true,
 *     defaultSlippage: 0.005, // 0.5%
 *   }}
 * >
 *   <App />
 * </MinaProvider>
 * ```
 */
export function MinaProvider({ config, children }: MinaProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track initialization error without triggering render during useMemo
  const initErrorRef = useRef<Error | null>(null);

  // Use JSON.stringify for stable dependency comparison to prevent
  // unnecessary re-initialization when config object reference changes
  // but values remain the same
  const configString = JSON.stringify(config);

  const mina = useMemo(() => {
    // Reset error ref for new initialization attempt
    initErrorRef.current = null;
    try {
      return new Mina(JSON.parse(configString) as MinaConfig);
    } catch (e) {
      initErrorRef.current = e instanceof Error ? e : new Error(String(e));
      return null;
    }
  }, [configString]);

  // Handle initialization state changes in useEffect (not during render)
  useEffect(() => {
    // Reset ready state when config changes
    setIsReady(false);

    if (initErrorRef.current) {
      setError(initErrorRef.current);
      return;
    }

    if (mina) {
      setError(null);
      setIsReady(true);
    }
  }, [mina, configString]);

  const contextValue = useMemo<MinaContextValue>(
    () => ({ mina, isReady, error }),
    [mina, isReady, error]
  );

  return (
    <MinaContext.Provider value={contextValue}>
      {children}
    </MinaContext.Provider>
  );
}

/**
 * React hook to access the Mina SDK instance from context
 *
 * Must be used within a MinaProvider. Returns the SDK instance,
 * initialization status, and any error that occurred during setup.
 *
 * @returns Object containing `mina` (SDK instance), `isReady` (boolean), and `error` (Error | null)
 * @throws Error if used outside of a MinaProvider
 *
 * @example
 * ```tsx
 * import { useMina } from '@siphoyawe/mina-sdk/react';
 *
 * function BridgeWidget() {
 *   const { mina, isReady, error } = useMina();
 *
 *   if (error) {
 *     return <div>Error initializing SDK: {error.message}</div>;
 *   }
 *
 *   if (!isReady || !mina) {
 *     return <div>Loading...</div>;
 *   }
 *
 *   // Now you can use the mina instance
 *   const handleGetChains = async () => {
 *     const chains = await mina.getChains();
 *     console.log(`${chains.length} chains supported`);
 *   };
 *
 *   return <button onClick={handleGetChains}>Get Chains</button>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Using with async operations
 * function QuoteForm() {
 *   const { mina, isReady } = useMina();
 *   const [quote, setQuote] = useState(null);
 *
 *   useEffect(() => {
 *     if (!isReady || !mina) return;
 *
 *     const fetchQuote = async () => {
 *       const result = await mina.getQuote({
 *         fromChainId: 1,
 *         toChainId: 999,
 *         fromToken: '0x...',
 *         toToken: '0x...',
 *         fromAmount: '1000000000',
 *         fromAddress: '0x...',
 *       });
 *       setQuote(result);
 *     };
 *
 *     fetchQuote();
 *   }, [mina, isReady]);
 *
 *   return <div>{quote ? `Receive: ${quote.toAmount}` : 'Loading quote...'}</div>;
 * }
 * ```
 */
export function useMina(): MinaContextValue {
  const context = useContext(MinaContext);

  if (!context) {
    throw new Error('useMina must be used within a MinaProvider');
  }

  return context;
}
