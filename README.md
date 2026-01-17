# @siphoyawe/mina-sdk

The official SDK for Mina Bridge - cross-chain bridging to Hyperliquid.

[![npm version](https://badge.fury.io/js/@siphoyawe%2Fmina-sdk.svg)](https://www.npmjs.com/package/@siphoyawe/mina-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- Cross-chain bridging from 40+ chains to Hyperliquid
- Automatic deposit to Hyperliquid L1 trading account
- Route discovery via LI.FI aggregation
- Full TypeScript support
- React hooks for easy integration
- Slippage and route preference configuration
- Real-time transaction status tracking

## Installation

```bash
# npm
npm install @siphoyawe/mina-sdk

# yarn
yarn add @siphoyawe/mina-sdk

# pnpm
pnpm add @siphoyawe/mina-sdk
```

### Peer Dependencies

For React hooks, ensure you have React 18+:

```bash
npm install react@^18
```

## Quick Start

### Basic Usage

```typescript
import { Mina } from '@siphoyawe/mina-sdk';

// Initialize the client
const mina = new Mina({
  integrator: 'my-app',
  autoDeposit: true,      // Auto-deposit to Hyperliquid L1 (default: true)
  defaultSlippage: 0.005, // 0.5% slippage tolerance (default)
});

// Get a quote
const quote = await mina.getQuote({
  fromChainId: 1,           // Ethereum
  toChainId: 999,           // HyperEVM
  fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
  toToken: '0x....',        // USDC on HyperEVM
  fromAmount: '1000000000', // 1000 USDC (6 decimals)
  fromAddress: '0x...',     // User's wallet address
});

console.log(`You'll receive: ${quote.toAmountFormatted} USDC`);
console.log(`Estimated time: ${quote.estimatedTime}s`);

// Execute the bridge
const result = await mina.execute({
  quote,
  signer: walletSigner,  // Wallet signer from wagmi/viem
  onStepUpdate: (step, status) => {
    console.log(`Step: ${step.type} - ${status.status}`);
  },
  onStatusChange: (status) => {
    console.log(`Overall status: ${status.status}`);
  },
});

console.log('Bridge complete!', result);
```

### React Integration

```tsx
import { MinaProvider, useMina, useQuote, useTokenBalance } from '@siphoyawe/mina-sdk/react';

// Wrap your app with the provider
function App() {
  return (
    <MinaProvider config={{ integrator: 'my-app' }}>
      <BridgeComponent />
    </MinaProvider>
  );
}

// Use hooks in your components
function BridgeComponent() {
  const { mina, isReady, error } = useMina();

  const { quote, isLoading, error: quoteError } = useQuote({
    fromChain: 1,
    toChain: 999,
    fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    toToken: '0x...',
    amount: '1000000000',
    fromAddress: '0x...',
  });

  const { formattedBalance, symbol } = useTokenBalance({
    chainId: 1,
    tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    walletAddress: '0x...',
  });

  if (!isReady) return <div>Loading SDK...</div>;
  if (isLoading) return <div>Getting quote...</div>;
  if (quoteError) return <div>Error: {quoteError.message}</div>;

  return (
    <div>
      <p>Balance: {formattedBalance} {symbol}</p>
      <p>You'll receive: {quote?.toAmountFormatted}</p>
      <button onClick={() => mina?.execute({ quote, signer })}>
        Bridge
      </button>
    </div>
  );
}
```

## API Reference

### Mina Class

```typescript
new Mina(config: MinaConfig)
```

**MinaConfig Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `integrator` | `string` | Yes | Your app identifier for LI.FI |
| `autoDeposit` | `boolean` | No | Enable auto-deposit to Hyperliquid L1 (default: `true`) |
| `defaultSlippage` | `number` | No | Default slippage tolerance (default: `0.005` = 0.5%) |
| `rpcUrls` | `Record<number, string>` | No | Custom RPC URLs by chain ID |

### Methods

#### `getChains(): Promise<ChainsResponse>`

Get supported source chains for bridging.

```typescript
const { chains, metadata } = await mina.getChains();
chains.forEach(chain => console.log(chain.name, chain.chainId));
```

---

#### `getTokens(chainId: number): Promise<TokensResponse>`

Get available tokens for a specific chain.

```typescript
const { tokens } = await mina.getTokens(1); // Ethereum tokens
tokens.forEach(token => console.log(token.symbol, token.address));
```

---

#### `getQuote(params: QuoteParams): Promise<Quote>`

Get a bridge quote for a token transfer.

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `fromChainId` | `number` | Yes | Source chain ID |
| `toChainId` | `number` | Yes | Destination chain ID (999 for HyperEVM) |
| `fromToken` | `string` | Yes | Source token address |
| `toToken` | `string` | Yes | Destination token address |
| `fromAmount` | `string` | Yes | Amount in smallest unit (wei) |
| `fromAddress` | `string` | Yes | User's wallet address |
| `slippage` | `number` | No | Slippage tolerance (default: 0.005) |
| `routePreference` | `RoutePreference` | No | `'recommended'`, `'fastest'`, or `'cheapest'` |

**Returns:** `Quote` object with route details, fees, and estimated time.

```typescript
const quote = await mina.getQuote({
  fromChainId: 1,
  toChainId: 999,
  fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  toToken: '0x...',
  fromAmount: '1000000000',
  fromAddress: '0x...',
  slippage: 0.01, // 1%
  routePreference: 'fastest',
});
```

---

#### `execute(options: ExecuteOptions): Promise<ExecutionResult>`

Execute a bridge transaction.

**ExecuteOptions:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `quote` | `Quote` | Yes | Quote object from `getQuote()` |
| `signer` | `TransactionSigner` | Yes | Wallet signer from wagmi/viem |
| `onStepUpdate` | `OnStepChange` | No | Callback for step progress updates |
| `onStatusChange` | `OnStatusChange` | No | Callback for overall status changes |
| `infiniteApproval` | `boolean` | No | Approve max amount (default: `false`) |

```typescript
const result = await mina.execute({
  quote,
  signer: walletClient,
  onStepUpdate: (step, status) => {
    console.log(`${step.type}: ${status.status} (${status.progress}%)`);
  },
  onStatusChange: (status) => {
    console.log(`Bridge status: ${status.status}`);
  },
});
```

---

#### `getBalance(chainId, tokenAddress, walletAddress): Promise<Balance>`

Get token balance for a wallet.

```typescript
const balance = await mina.getBalance(1, tokenAddress, walletAddress);
console.log(`Balance: ${balance.formatted} ${balance.symbol}`);
```

---

#### `getStatus(txHash: string): Promise<TransactionStatus>`

Check the status of a bridge transaction.

```typescript
const status = await mina.getStatus(txHash);
console.log(`Status: ${status.status}`);
```

## React Hooks

### `MinaProvider`

Context provider for the Mina SDK. Wrap your app with this provider.

```tsx
import { MinaProvider } from '@siphoyawe/mina-sdk/react';

<MinaProvider config={{ integrator: 'my-app', autoDeposit: true }}>
  {children}
</MinaProvider>
```

### `useMina()`

Access the Mina SDK instance and connection state.

```tsx
const { mina, isReady, error } = useMina();

// mina: Mina | null - SDK instance (null until ready)
// isReady: boolean - Whether SDK is initialized
// error: Error | null - Initialization error if any
```

### `useQuote(params)`

Fetch bridge quotes with automatic debounced refetching.

```tsx
const {
  quote,      // Quote | null
  isLoading,  // boolean
  error,      // Error | null
  refetch,    // () => void
} = useQuote({
  fromChain: 1,
  toChain: 999,
  fromToken: '0x...',
  toToken: '0x...',
  amount: '1000000000',
  fromAddress: '0x...',
  slippage: 0.005,           // Optional
  routePreference: 'fastest', // Optional
  enabled: true,              // Optional: disable auto-fetching
});
```

### `useTransactionStatus(txHash)`

Track transaction status with automatic polling.

```tsx
const {
  status,     // TransactionStatus | null
  isLoading,  // boolean
  error,      // Error | null
  isComplete, // boolean
  isFailed,   // boolean
} = useTransactionStatus(txHash, {
  pollInterval: 5000, // Optional: polling interval in ms
});
```

### `useTokenBalance(params)`

Fetch token balances with optional auto-refresh.

```tsx
const {
  balance,          // string - Raw balance in smallest unit
  formattedBalance, // string - Human-readable balance
  symbol,           // string - Token symbol
  decimals,         // number - Token decimals
  isLoading,        // boolean
  error,            // Error | null
  refetch,          // () => void
} = useTokenBalance({
  chainId: 1,
  tokenAddress: '0x...',
  walletAddress: '0x...',
  refetchInterval: 10000, // Optional: auto-refresh every 10s
  enabled: true,          // Optional: disable auto-fetching
});
```

## Types

Full TypeScript definitions are included. Key types:

```typescript
import type {
  // Configuration
  MinaConfig,

  // Chain and Token
  Chain,
  Token,

  // Quote
  QuoteParams,
  Quote,
  RoutePreference,

  // Execution
  ExecuteOptions,
  ExecutionResult,
  TransactionSigner,
  OnStepChange,
  OnStatusChange,

  // Status
  TransactionStatus,
  StepStatus,
  Step,

  // Balance
  Balance,
  BalanceParams,

  // Fees
  Fees,
  FeeItem,
  GasEstimate,
} from '@siphoyawe/mina-sdk';

// React-specific types
import type {
  MinaProviderProps,
  MinaContextValue,
  UseQuoteParams,
  UseQuoteReturn,
  UseTokenBalanceParams,
  UseTokenBalanceReturn,
  UseTransactionStatusReturn,
} from '@siphoyawe/mina-sdk/react';
```

## Constants

```typescript
import {
  HYPEREVM_CHAIN_ID,        // 999 - HyperEVM chain ID
  HYPERLIQUID_CHAIN_ID,     // 1337 - Hyperliquid L1 chain ID
  NATIVE_TOKEN_ADDRESS,     // Native token placeholder address
  DEFAULT_SLIPPAGE,         // 0.005 (0.5%)
  HYPEREVM_USDC_ADDRESS,    // USDC address on HyperEVM
  LIFI_API_URL,             // LI.FI API endpoint
} from '@siphoyawe/mina-sdk';
```

## Error Handling

The SDK provides typed error classes for precise error handling:

```typescript
import {
  MinaError,              // Base error class
  NoRouteFoundError,      // No bridge route available
  InsufficientBalanceError,
  SlippageExceededError,
  InvalidSlippageError,
  TransactionFailedError,
  UserRejectedError,
  NetworkError,
  DepositFailedError,
  QuoteExpiredError,
  // Type guards
  isMinaError,
  isNoRouteFoundError,
  isRecoverableError,
} from '@siphoyawe/mina-sdk';

try {
  const result = await mina.execute({ quote, signer });
} catch (error) {
  if (isNoRouteFoundError(error)) {
    console.log('No route found - try a different token pair');
  } else if (isRecoverableError(error)) {
    console.log('Temporary error - please retry');
  }
}
```

## Supported Chains

The SDK supports 40+ origin chains including:

| Chain | Chain ID |
|-------|----------|
| Ethereum | 1 |
| Arbitrum | 42161 |
| Optimism | 10 |
| Base | 8453 |
| Polygon | 137 |
| BSC | 56 |
| Avalanche | 43114 |
| Fantom | 250 |
| zkSync Era | 324 |
| Linea | 59144 |
| Scroll | 534352 |
| And many more... | |

**Destination:** HyperEVM (Chain ID: 999)

## Advanced Usage

### Standalone Functions

For advanced use cases, you can use standalone functions without creating a Mina instance:

```typescript
import {
  getChains,
  getTokens,
  getQuote,
  getBalance,
  execute,
} from '@siphoyawe/mina-sdk';

// Use directly without Mina client
const chains = await getChains();
const quote = await getQuote({ ... });
```

### Custom Caching

```typescript
import { ChainCache, TokenCache, BalanceCache } from '@siphoyawe/mina-sdk';

// Create custom cache instances
const chainCache = new ChainCache({ ttl: 60000 });
const tokenCache = new TokenCache({ ttl: 30000 });
```

### Event System

```typescript
import { SDKEventEmitter, SDK_EVENTS } from '@siphoyawe/mina-sdk';

const emitter = new SDKEventEmitter();
emitter.on(SDK_EVENTS.STEP_UPDATE, (step, status) => {
  console.log(`Step ${step.type}: ${status.status}`);
});
```

## License

MIT
