<p align="center">
  <img src="mina-sdk-logo.svg" alt="Mina SDK" width="400" />
</p>

<h1 align="center">@siphoyawe/mina-sdk</h1>

<p align="center">
  <strong>The Official Cross-Chain Bridge SDK for Hyperliquid</strong>
</p>

<p align="center">
  Bridge assets from 40+ chains with automatic deposit to your Hyperliquid trading account
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@siphoyawe/mina-sdk">
    <img src="https://img.shields.io/npm/v/@siphoyawe/mina-sdk?style=flat-square&color=blue" alt="npm version" />
  </a>
  <a href="https://www.npmjs.com/package/@siphoyawe/mina-sdk">
    <img src="https://img.shields.io/npm/dm/@siphoyawe/mina-sdk?style=flat-square&color=green" alt="npm downloads" />
  </a>
  <a href="https://github.com/siphoyawe/mina-sdk/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/@siphoyawe/mina-sdk?style=flat-square" alt="license" />
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square&logo=typescript" alt="TypeScript" />
  </a>
  <a href="https://react.dev/">
    <img src="https://img.shields.io/badge/React-18+-61DAFB?style=flat-square&logo=react" alt="React" />
  </a>
</p>

<p align="center">
  <a href="https://mina-169e3f09.mintlify.app/">Full Documentation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#react-hooks">React Hooks</a> •
  <a href="#examples">Examples</a>
</p>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
  - [Basic Usage](#basic-usage)
  - [React Integration](#react-integration)
- [Architecture](#architecture)
- [API Reference](#api-reference)
  - [Mina Class](#mina-class)
  - [Configuration](#configuration)
  - [Methods](#methods)
- [React Hooks](#react-hooks)
  - [MinaProvider](#minaprovider)
  - [useMina](#usemina)
  - [useQuote](#usequote)
  - [useTokenBalance](#usetokenbalance)
  - [useTransactionStatus](#usetransactionstatus)
- [Types](#types)
- [Constants](#constants)
- [Error Handling](#error-handling)
- [Supported Chains](#supported-chains)
- [Advanced Usage](#advanced-usage)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Mina SDK** is a TypeScript SDK that enables seamless cross-chain bridging to Hyperliquid. Built on top of [LI.FI](https://li.fi/) route aggregation, it provides:

- **40+ Source Chains** — Bridge from Ethereum, Arbitrum, Optimism, Base, Polygon, and many more
- **Automatic L1 Deposit** — Funds are automatically deposited to your Hyperliquid trading account
- **React-First Design** — Production-ready hooks for React applications
- **Full TypeScript Support** — Complete type definitions for type-safe development

```
┌─────────────────┐     ┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Source Chain  │────▶│   LI.FI     │────▶│   HyperEVM      │────▶│  Hyperliquid L1 │
│   (40+ chains)  │     │   Router    │     │   (Chain 999)   │     │   (Trading)     │
└─────────────────┘     └─────────────┘     └─────────────────┘     └─────────────────┘
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Cross-Chain Bridging** | Bridge from 40+ EVM chains to Hyperliquid |
| **Auto-Deposit** | Automatic deposit to Hyperliquid L1 trading account |
| **Route Optimization** | Find the fastest, cheapest, or recommended route |
| **React Hooks** | Production-ready hooks with automatic state management |
| **Real-time Tracking** | Track transaction status with callbacks and events |
| **TypeScript Native** | Full type definitions and IntelliSense support |
| **Smart Caching** | Built-in caching for optimal performance |
| **Error Recovery** | Typed errors with recovery suggestions |

---

## Installation

```bash
# npm
npm install @siphoyawe/mina-sdk

# yarn
yarn add @siphoyawe/mina-sdk

# pnpm
pnpm add @siphoyawe/mina-sdk

# bun
bun add @siphoyawe/mina-sdk
```

### Peer Dependencies

React hooks require React 18+:

```bash
npm install react@^18
```

### Requirements

- **Node.js** >= 18
- **React** >= 18 (optional, only for hooks)

---

## Quick Start

### Basic Usage

```typescript
import { Mina } from '@siphoyawe/mina-sdk';

// 1. Initialize the SDK
const mina = new Mina({
  integrator: 'my-app',       // Your app identifier
  autoDeposit: true,          // Auto-deposit to Hyperliquid L1 (default)
  defaultSlippage: 0.005,     // 0.5% slippage tolerance
});

// 2. Get supported chains
const { chains } = await mina.getChains();
console.log('Supported chains:', chains.map(c => c.name));

// 3. Get a bridge quote
const quote = await mina.getQuote({
  fromChainId: 1,              // Ethereum
  toChainId: 999,              // HyperEVM
  fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f',   // USDC on HyperEVM
  fromAmount: '1000000000',    // 1000 USDC (6 decimals)
  fromAddress: '0xYourWallet',
});

console.log(`Bridge ${quote.fromAmountFormatted} USDC`);
console.log(`Receive ~${quote.toAmountFormatted} USDC`);
console.log(`Estimated time: ${quote.estimatedTime}s`);
console.log(`Total fees: $${quote.fees.totalUsd}`);

// 4. Execute the bridge
const result = await mina.execute({
  quote,
  signer: walletClient,  // From wagmi/viem
  onStepUpdate: (step, status) => {
    console.log(`Step: ${step.type} - ${status.status}`);
  },
  onStatusChange: (status) => {
    console.log(`Status: ${status.status}`);
  },
});

console.log('Bridge complete!');
console.log('Execution ID:', result.executionId);
```

### React Integration

```tsx
import { MinaProvider, useMina, useQuote, useTokenBalance } from '@siphoyawe/mina-sdk/react';

// 1. Wrap your app with MinaProvider
function App() {
  return (
    <MinaProvider config={{ integrator: 'my-app', autoDeposit: true }}>
      <BridgeWidget />
    </MinaProvider>
  );
}

// 2. Use hooks in your components
function BridgeWidget() {
  const { mina, isReady } = useMina();

  // Fetch quote with automatic debouncing
  const { quote, isLoading: quoteLoading } = useQuote({
    fromChain: 1,
    toChain: 999,
    fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f',
    amount: '1000000000',
    fromAddress: walletAddress,
  });

  // Fetch token balance with auto-refresh
  const { formattedBalance, symbol } = useTokenBalance({
    chainId: 1,
    tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    walletAddress,
    refetchInterval: 10000, // Refresh every 10s
  });

  const handleBridge = async () => {
    if (!mina || !quote) return;

    await mina.execute({
      quote,
      signer: walletClient,
    });
  };

  if (!isReady) return <div>Initializing...</div>;

  return (
    <div>
      <p>Balance: {formattedBalance} {symbol}</p>
      <p>You'll receive: {quote?.toAmountFormatted ?? '—'}</p>
      <button onClick={handleBridge} disabled={quoteLoading || !quote}>
        Bridge to Hyperliquid
      </button>
    </div>
  );
}
```

---

## Architecture

The SDK is organized into several layers:

```
@siphoyawe/mina-sdk
├── Mina (Client)           # Main SDK entry point
│   ├── getChains()         # Chain discovery
│   ├── getTokens()         # Token discovery
│   ├── getQuote()          # Route & quote generation
│   ├── execute()           # Transaction execution
│   └── getStatus()         # Transaction tracking
│
├── Services                # Core business logic
│   ├── chain.ts            # Chain data from LI.FI
│   ├── token.ts            # Token data from LI.FI
│   ├── balance.ts          # Balance fetching
│   ├── quote.ts            # Quote generation
│   ├── execute.ts          # Transaction execution
│   └── deposit/            # Hyperliquid L1 deposit
│       ├── detect-arrival  # USDC arrival detection
│       ├── execute-deposit # L1 deposit execution
│       └── monitor-l1      # L1 confirmation
│
├── React                   # React integration
│   ├── MinaProvider        # Context provider
│   ├── useQuote            # Quote hook
│   ├── useTokenBalance     # Balance hook
│   └── useTransactionStatus# Status hook
│
└── Utilities
    ├── types.ts            # TypeScript definitions
    ├── errors.ts           # Error classes
    ├── events.ts           # Event system
    └── constants.ts        # SDK constants
```

### Bridge Flow

```
1. User selects source chain & token
                │
                ▼
2. SDK fetches quote via LI.FI
                │
                ▼
3. User approves token (if needed)
                │
                ▼
4. SDK executes bridge transaction
                │
                ▼
5. Funds arrive on HyperEVM (999)
                │
                ▼
6. SDK detects USDC arrival [if autoDeposit]
                │
                ▼
7. SDK deposits to Hyperliquid L1 [if autoDeposit]
                │
                ▼
8. Funds available in trading account
```

---

## API Reference

### Mina Class

The main SDK client.

```typescript
import { Mina } from '@siphoyawe/mina-sdk';

const mina = new Mina(config);
```

### Configuration

```typescript
interface MinaConfig {
  /** Your app identifier for LI.FI (required) */
  integrator: string;

  /** Auto-deposit to Hyperliquid L1 trading account (default: true) */
  autoDeposit?: boolean;

  /** Default slippage tolerance as decimal (default: 0.005 = 0.5%) */
  defaultSlippage?: number;

  /** Custom RPC URLs by chain ID */
  rpcUrls?: Record<number, string>;

  /** LI.FI API key for higher rate limits */
  lifiApiKey?: string;
}
```

### Methods

#### `getChains(): Promise<ChainsResponse>`

Fetch all supported source chains.

```typescript
const { chains, metadata } = await mina.getChains();

// chains: Chain[] - Array of supported chains
// metadata: { total, lastUpdated }

chains.forEach(chain => {
  console.log(`${chain.name} (${chain.chainId})`);
  console.log(`  Logo: ${chain.logoURI}`);
  console.log(`  Native: ${chain.nativeToken.symbol}`);
});
```

---

#### `getTokens(chainId: number): Promise<TokensResponse>`

Get bridgeable tokens for a specific chain.

```typescript
const { tokens } = await mina.getTokens(1); // Ethereum

tokens.forEach(token => {
  console.log(`${token.symbol}: ${token.address}`);
  console.log(`  Decimals: ${token.decimals}`);
  console.log(`  Price: $${token.priceUSD}`);
});
```

---

#### `getQuote(params: QuoteParams): Promise<Quote>`

Get a bridge quote with optimal routing.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromChainId` | `number` | Yes | Source chain ID |
| `toChainId` | `number` | Yes | Destination chain ID (999 for HyperEVM) |
| `fromToken` | `string` | Yes | Source token address |
| `toToken` | `string` | Yes | Destination token address |
| `fromAmount` | `string` | Yes | Amount in smallest unit (wei) |
| `fromAddress` | `string` | Yes | User's wallet address |
| `slippage` | `number` | No | Slippage tolerance (default: 0.005) |
| `routePreference` | `RoutePreference` | No | `'recommended'` \| `'fastest'` \| `'cheapest'` |

**Returns:**

```typescript
interface Quote {
  id: string;
  fromChainId: number;
  toChainId: number;
  fromToken: Token;
  toToken: Token;
  fromAmount: string;
  fromAmountFormatted: string;
  toAmount: string;
  toAmountFormatted: string;
  estimatedTime: number;      // Seconds
  priceImpact: number;        // Decimal (0.01 = 1%)
  fees: {
    total: string;
    totalUsd: string;
    gas: FeeItem;
    bridge: FeeItem;
    protocol: FeeItem;
  };
  steps: Step[];
  alternativeRoutes?: Quote[];
}
```

**Example:**

```typescript
const quote = await mina.getQuote({
  fromChainId: 42161,          // Arbitrum
  toChainId: 999,              // HyperEVM
  fromToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arb
  toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f',   // USDC on HyperEVM
  fromAmount: '500000000',     // 500 USDC
  fromAddress: '0xYourWallet',
  routePreference: 'fastest',
  slippage: 0.01,              // 1%
});

console.log(`Route: ${quote.steps.map(s => s.tool).join(' → ')}`);
console.log(`ETA: ${quote.estimatedTime}s`);
console.log(`Price Impact: ${(quote.priceImpact * 100).toFixed(2)}%`);
```

---

#### `execute(options: ExecuteOptions): Promise<ExecutionResult>`

Execute a bridge transaction.

**Options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `quote` | `Quote` | Yes | Quote from `getQuote()` |
| `signer` | `TransactionSigner` | Yes | Wallet signer (viem/wagmi) |
| `onStepUpdate` | `OnStepChange` | No | Step progress callback |
| `onStatusChange` | `OnStatusChange` | No | Status change callback |
| `infiniteApproval` | `boolean` | No | Approve max amount (default: false) |

**Callbacks:**

```typescript
// Step update callback
type OnStepChange = (step: Step, status: StepStatus) => void;

interface StepStatus {
  status: 'pending' | 'executing' | 'completed' | 'failed';
  progress: number;       // 0-100
  txHash?: string;
  error?: Error;
}

// Status change callback
type OnStatusChange = (status: ExecutionStatus) => void;

interface ExecutionStatus {
  status: 'idle' | 'approving' | 'approved' | 'executing' | 'bridging' | 'depositing' | 'completed' | 'failed';
  currentStep?: number;
  totalSteps?: number;
  txHash?: string;
  error?: Error;
}
```

**Example:**

```typescript
const result = await mina.execute({
  quote,
  signer: walletClient,
  infiniteApproval: false,
  onStepUpdate: (step, status) => {
    console.log(`[${step.type}] ${status.status} (${status.progress}%)`);
    if (status.txHash) {
      console.log(`  TX: ${status.txHash}`);
    }
  },
  onStatusChange: (status) => {
    console.log(`Bridge: ${status.status}`);
  },
});

console.log('Execution ID:', result.executionId);
console.log('Final TX:', result.txHash);
```

---

#### `getBalance(chainId, tokenAddress, walletAddress): Promise<Balance>`

Get token balance for a wallet.

```typescript
const balance = await mina.getBalance(
  1,                                                      // Ethereum
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',          // USDC
  '0xYourWallet'
);

console.log(`Raw: ${balance.amount}`);           // "1000000000"
console.log(`Formatted: ${balance.formatted}`);  // "1000.00"
console.log(`Symbol: ${balance.symbol}`);        // "USDC"
console.log(`USD: $${balance.amountUsd}`);       // "$1000.00"
```

---

#### `getStatus(txHash: string): Promise<TransactionStatus>`

Check bridge transaction status.

```typescript
const status = await mina.getStatus(txHash);

console.log(`Status: ${status.status}`);
console.log(`Source TX: ${status.sending?.txHash}`);
console.log(`Destination TX: ${status.receiving?.txHash}`);

// Poll until complete
while (status.status !== 'DONE' && status.status !== 'FAILED') {
  await sleep(5000);
  status = await mina.getStatus(txHash);
}
```

---

#### `getExecutionStatus(executionId: string): Promise<ExecutionStatus>`

Get detailed execution status by ID.

```typescript
const execStatus = await mina.getExecutionStatus(result.executionId);
console.log(`Current step: ${execStatus.currentStep}/${execStatus.totalSteps}`);
```

---

#### `retryExecution(executionId: string, options): Promise<ExecutionResult>`

Retry a failed execution.

```typescript
try {
  await mina.execute({ quote, signer });
} catch (error) {
  if (isRecoverableError(error)) {
    // Wait and retry
    await sleep(5000);
    const retryResult = await mina.retryExecution(executionId, { signer });
  }
}
```

---

## React Hooks

### MinaProvider

Context provider that initializes the SDK.

```tsx
import { MinaProvider } from '@siphoyawe/mina-sdk/react';

function App() {
  return (
    <MinaProvider
      config={{
        integrator: 'my-app',
        autoDeposit: true,
        defaultSlippage: 0.005,
      }}
    >
      <YourApp />
    </MinaProvider>
  );
}
```

---

### useMina

Access the SDK instance and initialization state.

```tsx
const { mina, isReady, error } = useMina();

// mina: Mina | null       - SDK instance (null until ready)
// isReady: boolean        - Whether SDK is initialized
// error: Error | null     - Initialization error

if (error) return <div>Failed to initialize: {error.message}</div>;
if (!isReady) return <div>Loading SDK...</div>;

// Safe to use mina
await mina.getChains();
```

---

### useQuote

Fetch quotes with automatic debouncing and refetching.

```tsx
interface UseQuoteParams {
  fromChain?: number;           // Default: undefined
  toChain?: number;             // Default: 999 (HyperEVM)
  fromToken?: string;
  toToken?: string;
  amount?: string;              // In smallest unit
  fromAddress?: string;
  slippageTolerance?: number;   // Default: 0.005
  routePreference?: RoutePreference;
  enabled?: boolean;            // Default: true
}

const {
  quote,      // Quote | null
  isLoading,  // boolean
  error,      // Error | null
  refetch,    // () => Promise<void>
} = useQuote({
  fromChain: 1,
  toChain: 999,
  fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  toToken: '0xb88339cb7199b77e23db6e890353e22632ba630f',
  amount: '1000000000',
  fromAddress: walletAddress,
  routePreference: 'recommended',
  enabled: !!walletAddress,  // Only fetch when wallet connected
});
```

**Features:**
- 500ms debounce to prevent excessive API calls
- Automatic refetch when params change
- Returns `null` when required params are missing

---

### useTokenBalance

Fetch token balances with optional auto-refresh.

```tsx
interface UseTokenBalanceParams {
  chainId?: number;
  tokenAddress?: string;         // Use 'native' or 0x0 for native token
  walletAddress?: string;
  refetchInterval?: number;      // Auto-refresh interval in ms
  enabled?: boolean;             // Default: true
}

const {
  balance,          // string | null - Raw balance
  formattedBalance, // string | null - Human-readable
  decimals,         // number | null
  symbol,           // string | null
  balanceUsd,       // number | null
  isLoading,        // boolean
  error,            // Error | null
  refetch,          // () => Promise<void>
} = useTokenBalance({
  chainId: 1,
  tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  walletAddress: '0xYourWallet',
  refetchInterval: 10000,  // Refresh every 10s
});
```

---

### useTransactionStatus

Track transaction status with automatic polling.

```tsx
const {
  status,     // TransactionStatus | null
  isLoading,  // boolean
  error,      // Error | null
  isComplete, // boolean - true when status is 'DONE'
  isFailed,   // boolean - true when status is 'FAILED'
  refetch,    // () => Promise<void>
} = useTransactionStatus(txHash, {
  pollInterval: 5000,  // Poll every 5s (default)
  enabled: !!txHash,   // Only poll when we have a hash
});

useEffect(() => {
  if (isComplete) {
    toast.success('Bridge complete!');
  } else if (isFailed) {
    toast.error('Bridge failed');
  }
}, [isComplete, isFailed]);
```

---

## Types

Full TypeScript definitions are included. Import types directly:

```typescript
import type {
  // Configuration
  MinaConfig,

  // Chain & Token
  Chain,
  Token,

  // Quote
  QuoteParams,
  Quote,
  RoutePreference,  // 'recommended' | 'fastest' | 'cheapest'
  Step,
  StepType,         // 'approval' | 'swap' | 'bridge' | 'deposit'

  // Execution
  ExecuteOptions,
  ExecutionResult,
  ExecutionStatus,
  ExecutionStatusType,
  TransactionSigner,
  OnStepChange,
  OnStatusChange,

  // Status
  TransactionStatus,
  StepStatus,

  // Balance
  Balance,
  BalanceParams,

  // Fees
  Fees,
  FeeItem,
  GasEstimate,
} from '@siphoyawe/mina-sdk';

// React types
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

---

## Constants

Common constants are exported for convenience:

```typescript
import {
  // Chain IDs
  HYPEREVM_CHAIN_ID,         // 999 - HyperEVM destination chain
  HYPERLIQUID_CHAIN_ID,      // 1337 - Hyperliquid L1 (trading)

  // Token Addresses
  HYPEREVM_USDC_ADDRESS,     // USDC on HyperEVM
  NATIVE_TOKEN_ADDRESS,      // 0x0...0 - Native token placeholder

  // Slippage
  DEFAULT_SLIPPAGE,          // 0.005 (0.5%)
  MIN_SLIPPAGE,              // 0.0001 (0.01%)
  MAX_SLIPPAGE,              // 0.05 (5%)
  SLIPPAGE_PRESETS,          // [0.001, 0.005, 0.01] - 0.1%, 0.5%, 1%

  // API
  LIFI_API_URL,              // LI.FI API endpoint

  // Timeouts (ms)
  QUOTE_TIMEOUT,             // 30000 (30s)
  CHAIN_TIMEOUT,             // 10000 (10s)
  TOKEN_TIMEOUT,             // 15000 (15s)
  BALANCE_TIMEOUT,           // 10000 (10s)
} from '@siphoyawe/mina-sdk';
```

---

## Error Handling

The SDK provides typed error classes for precise error handling:

```typescript
import {
  // Base error
  MinaError,

  // Specific errors
  NoRouteFoundError,
  InsufficientBalanceError,
  SlippageExceededError,
  InvalidSlippageError,
  TransactionFailedError,
  UserRejectedError,
  NetworkError,
  DepositFailedError,
  QuoteExpiredError,
  ChainFetchError,
  TokenFetchError,
  BalanceFetchError,
  MaxRetriesExceededError,
  InvalidAddressError,

  // Type guards
  isMinaError,
  isNoRouteFoundError,
  isInsufficientBalanceError,
  isSlippageExceededError,
  isUserRejectedError,
  isNetworkError,
  isRecoverableError,
} from '@siphoyawe/mina-sdk';
```

**Error Properties:**

```typescript
interface MinaError {
  code: string;           // Unique error code
  message: string;        // Technical description
  userMessage: string;    // User-friendly message
  recoverable: boolean;   // Can be retried?
  recoveryAction?: string; // Suggested action
  details?: unknown;      // Additional context
}
```

**Example Usage:**

```typescript
try {
  await mina.execute({ quote, signer });
} catch (error) {
  if (isUserRejectedError(error)) {
    // User cancelled - show nothing or subtle message
    return;
  }

  if (isInsufficientBalanceError(error)) {
    toast.error(`Insufficient ${error.details.symbol} balance`);
    return;
  }

  if (isNoRouteFoundError(error)) {
    toast.error('No bridge route available for this pair');
    return;
  }

  if (isSlippageExceededError(error)) {
    toast.error('Price moved too much. Try increasing slippage.');
    return;
  }

  if (isRecoverableError(error)) {
    toast.error('Temporary error. Please try again.');
    return;
  }

  // Unknown error
  toast.error('Bridge failed. Please try again.');
  console.error(error);
}
```

---

## Supported Chains

### Source Chains (40+)

| Chain | Chain ID | Native Token |
|-------|----------|--------------|
| Ethereum | 1 | ETH |
| Arbitrum One | 42161 | ETH |
| Optimism | 10 | ETH |
| Base | 8453 | ETH |
| Polygon | 137 | MATIC |
| BNB Smart Chain | 56 | BNB |
| Avalanche C-Chain | 43114 | AVAX |
| Fantom | 250 | FTM |
| zkSync Era | 324 | ETH |
| Linea | 59144 | ETH |
| Scroll | 534352 | ETH |
| Mantle | 5000 | MNT |
| Gnosis | 100 | xDAI |
| Moonbeam | 1284 | GLMR |
| Celo | 42220 | CELO |
| Aurora | 1313161554 | ETH |
| Metis | 1088 | METIS |
| Boba | 288 | ETH |
| And 20+ more... | | |

### Destination Chain

| Chain | Chain ID | Description |
|-------|----------|-------------|
| **HyperEVM** | 999 | Hyperliquid's EVM chain |
| **Hyperliquid L1** | 1337 | Trading account (auto-deposit) |

---

## Advanced Usage

### Standalone Functions

Use SDK functions without instantiating the Mina class:

```typescript
import {
  getChains,
  getTokens,
  getQuote,
  getBalance,
  execute,
} from '@siphoyawe/mina-sdk';

// Configure globally (optional)
import { configure } from '@siphoyawe/mina-sdk';
configure({ integrator: 'my-app' });

// Use functions directly
const chains = await getChains();
const quote = await getQuote({ ... });
const result = await execute({ quote, signer });
```

---

### Custom Caching

Create custom cache instances for advanced control:

```typescript
import {
  ChainCache,
  TokenCache,
  BalanceCache,
  QuoteCache,
} from '@siphoyawe/mina-sdk';

// Custom TTL (time-to-live)
const chainCache = new ChainCache({ ttl: 60000 });   // 1 minute
const tokenCache = new TokenCache({ ttl: 30000 });   // 30 seconds
const balanceCache = new BalanceCache({ ttl: 5000 }); // 5 seconds

// Manual invalidation
chainCache.invalidate();
tokenCache.invalidate(chainId);
balanceCache.invalidate(chainId, tokenAddress, walletAddress);
```

---

### Event System

Subscribe to SDK events for fine-grained control:

```typescript
import { SDK_EVENTS } from '@siphoyawe/mina-sdk';

const mina = new Mina({ integrator: 'my-app' });

// Subscribe to events
mina.on(SDK_EVENTS.QUOTE_UPDATED, (quote) => {
  console.log('Quote updated:', quote.toAmountFormatted);
});

mina.on(SDK_EVENTS.EXECUTION_STARTED, (executionId) => {
  console.log('Execution started:', executionId);
});

mina.on(SDK_EVENTS.STEP_CHANGED, (step, status) => {
  console.log(`Step ${step.type}: ${status.status}`);
});

mina.on(SDK_EVENTS.TRANSACTION_SENT, (txHash, chainId) => {
  console.log(`TX sent on chain ${chainId}: ${txHash}`);
});

mina.on(SDK_EVENTS.DEPOSIT_COMPLETED, (summary) => {
  console.log('Deposit complete:', summary);
});

mina.on(SDK_EVENTS.EXECUTION_COMPLETED, (result) => {
  console.log('Bridge complete!', result);
});

mina.on(SDK_EVENTS.EXECUTION_FAILED, (error) => {
  console.error('Bridge failed:', error);
});

// Unsubscribe
const handler = (quote) => console.log(quote);
mina.on(SDK_EVENTS.QUOTE_UPDATED, handler);
mina.off(SDK_EVENTS.QUOTE_UPDATED, handler);

// One-time subscription
mina.once(SDK_EVENTS.EXECUTION_COMPLETED, (result) => {
  console.log('First execution complete!');
});
```

---

### Custom RPC URLs

Override default RPC URLs for specific chains:

```typescript
const mina = new Mina({
  integrator: 'my-app',
  rpcUrls: {
    1: 'https://my-eth-rpc.com',
    42161: 'https://my-arb-rpc.com',
    999: 'https://my-hyperevm-rpc.com',
  },
});
```

---

## FAQ

### What chains are supported?

The SDK supports 40+ EVM chains as source chains. The destination is always HyperEVM (Chain ID: 999). Use `mina.getChains()` to get the full list.

### What tokens can I bridge?

Any token with a valid bridge route through LI.FI can be bridged. Use `mina.getTokens(chainId)` to see available tokens for a specific chain. The most common tokens (USDC, USDT, ETH, etc.) are widely supported.

### What happens after bridging?

By default (`autoDeposit: true`), the SDK will:
1. Bridge your tokens to HyperEVM
2. Detect when USDC arrives on HyperEVM
3. Automatically deposit USDC to your Hyperliquid L1 trading account

If you set `autoDeposit: false`, funds will remain on HyperEVM and you'll need to deposit manually.

### How long do bridges take?

Bridge times vary by route:
- Same-chain swaps: ~30 seconds
- Fast bridges (Stargate, etc.): 1-5 minutes
- Slower bridges: 10-30 minutes
- L1 deposit: Additional 1-2 minutes

The quote includes an `estimatedTime` field with the expected duration.

### What are the fees?

Fees depend on the route and include:
- **Gas fees**: Network transaction costs
- **Bridge fees**: Protocol fees for bridging
- **Protocol fees**: LI.FI aggregation fee

The quote includes a detailed `fees` breakdown.

### Is there a minimum/maximum amount?

- **Minimum**: Generally $10-$20 USD depending on gas costs
- **Maximum**: No hard limit, but large amounts may have limited liquidity

### How do I handle errors?

Use the typed error classes and type guards:

```typescript
import { isNoRouteFoundError, isRecoverableError } from '@siphoyawe/mina-sdk';

try {
  await mina.execute({ quote, signer });
} catch (error) {
  if (isRecoverableError(error)) {
    // Retry the operation
  }
}
```

### Can I use this without React?

Yes! The core SDK has no React dependency. Only the `/react` export requires React 18+.

```typescript
// Works without React
import { Mina } from '@siphoyawe/mina-sdk';
```

---

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

```bash
# Clone the repo
git clone https://github.com/siphoyawe/mina-sdk.git
cd mina-sdk

# Install dependencies
pnpm install

# Build
pnpm build

# Run type checking
pnpm typecheck

# Watch mode for development
pnpm dev
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with care for the Hyperliquid community
</p>

<p align="center">
  <a href="https://hyperliquid.xyz">Hyperliquid</a> •
  <a href="https://li.fi">LI.FI</a> •
  <a href="https://mina-169e3f09.mintlify.app/">Documentation</a>
</p>

