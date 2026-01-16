# @siphoyawe/mina-sdk

Cross-chain bridge SDK for Hyperliquid. Bridge assets from any EVM chain to HyperEVM with optional auto-deposit to Hyperliquid L1.

## Installation

```bash
npm install @siphoyawe/mina-sdk
```

## Quick Start

```typescript
import { Mina } from '@siphoyawe/mina-sdk';

// Initialize the client
const mina = new Mina({
  integrator: 'my-app',
  autoDeposit: true, // Auto-deposit to Hyperliquid L1 after bridge
  defaultSlippage: 0.005, // 0.5% slippage tolerance
});

// Get supported chains
const chains = await mina.getChains();

// Get a bridge quote
const quote = await mina.getQuote({
  fromChainId: 1, // Ethereum
  toChainId: 999, // HyperEVM
  fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
  toToken: '0x...', // USDC on HyperEVM
  fromAmount: '1000000000', // 1000 USDC (6 decimals)
  fromAddress: '0xYourWalletAddress',
});

// Execute the bridge transaction
const result = await mina.execute({
  quote,
  signer: yourWalletSigner,
  onStepUpdate: (step, status) => {
    console.log(`Step ${step.type}: ${status.status}`);
  },
});
```

## Exports

### Main Client

- `Mina` - Main SDK client class

### Types

```typescript
import type {
  MinaConfig,
  Chain,
  Token,
  Quote,
  QuoteParams,
  Step,
  StepStatus,
  Fees,
  GasEstimate,
  ExecuteOptions,
  ExecutionResult,
  TransactionStatus,
  Balance,
} from '@siphoyawe/mina-sdk';
```

### Constants

```typescript
import {
  HYPEREVM_CHAIN_ID, // 999
  HYPERLIQUID_CHAIN_ID, // 1337
  NATIVE_TOKEN_ADDRESS,
  DEFAULT_SLIPPAGE,
  LIFI_API_URL,
  HYPEREVM_USDC_ADDRESS,
} from '@siphoyawe/mina-sdk';
```

## API Reference

### `new Mina(config)`

Create a new Mina client instance.

| Option | Type | Description |
|--------|------|-------------|
| `integrator` | `string` | Required. Unique identifier for your app |
| `autoDeposit` | `boolean` | Enable auto-deposit to Hyperliquid L1 (default: `true`) |
| `defaultSlippage` | `number` | Default slippage tolerance (default: `0.005`) |
| `rpcUrls` | `Record<number, string>` | Custom RPC URLs by chain ID |

### Methods

| Method | Description |
|--------|-------------|
| `getChains()` | Get supported source chains |
| `getTokens(chainId)` | Get available tokens for a chain |
| `getBalance(chainId, tokenAddress, walletAddress)` | Get token balance |
| `getQuote(params)` | Get a bridge quote |
| `execute(options)` | Execute a bridge transaction |
| `getStatus(txHash)` | Get transaction status |

## TypeScript Support

This package is written in TypeScript and includes full type definitions. No additional `@types` packages are required.

## Part of Mina Bridge

This SDK is part of the Mina Bridge project - a unified bridge interface for Hyperliquid that aggregates the best routes across multiple bridge protocols.

## License

MIT
