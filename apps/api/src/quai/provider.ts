import { JsonRpcProvider, Wallet } from 'quais';
import { config } from '../config.js';

type QuaiRpcResolved = { rpcUrl: string; usePathing: boolean };

function resolveQuaiRpcConfig(): QuaiRpcResolved {
  const usePathing = (process.env.QUAI_USE_PATHING ?? '1') === '1';
  const raw = String(config.quaiRpcUrl || '').trim();
  if (!raw) return { rpcUrl: raw, usePathing };

  // If we're using Quai's public RPC and pathing, the rpc URL should be the base URL (no shard path).
  // The SDK's `usePathing: true` will route requests to the right shard; a pre-suffixed shard path
  // can lead to URLs like ".../cyprus1/cyprus1" that hang until timeout.
  if (usePathing) {
    try {
      const u = new URL(raw);
      const isQuaiPublic = u.hostname.endsWith('rpc.quai.network');
      const pathSegs = u.pathname.split('/').filter(Boolean);
      if (isQuaiPublic && pathSegs.length === 1) {
        return { rpcUrl: `${u.protocol}//${u.host}`, usePathing };
      }
    } catch {
      // Ignore parsing failures; the provider will throw if the URL is invalid.
    }
  }

  return { rpcUrl: raw, usePathing };
}

export function getQuaiProviderDebugInfo(): QuaiRpcResolved {
  return resolveQuaiRpcConfig();
}

function resolveTreasuryRpcUrl(): string {
  const raw = String(process.env.QUAI_TREASURY_RPC_URL ?? config.quaiRpcUrl ?? '').trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const isQuaiPublic = u.hostname.endsWith('rpc.quai.network');
    const pathSegs = u.pathname.split('/').filter(Boolean);
    // Gas/fee RPC calls need a specific zone chain; default treasury ops to cyprus1.
    if (isQuaiPublic && pathSegs.length === 0) {
      return `${u.protocol}//${u.host}/cyprus1`;
    }
  } catch {
    // If it's not a URL (e.g. localhost), keep as-is.
  }
  return raw;
}

function applyFeeDataFallback(provider: JsonRpcProvider): JsonRpcProvider {
  const originalGetFeeData =
    typeof provider.getFeeData === 'function' ? provider.getFeeData.bind(provider) : null;
  const originalGetMaxPriorityFeePerGas =
    typeof (provider as any).getMaxPriorityFeePerGas === 'function'
      ? (provider as any).getMaxPriorityFeePerGas.bind(provider)
      : null;

  (provider as any).getMaxPriorityFeePerGas = async () => {
    if (originalGetMaxPriorityFeePerGas) {
      try {
        return await originalGetMaxPriorityFeePerGas();
      } catch {
        // fall through to gas price fallback
      }
    }
    // Prefer standard `eth_gasPrice` for compatibility across RPC providers.
    const gasPriceHex = await provider.send('eth_gasPrice', []);
    return BigInt(gasPriceHex as string);
  };

  provider.getFeeData = async () => {
    if (originalGetFeeData) {
      try {
        return await originalGetFeeData();
      } catch {
        // fall through to gas price fallback
      }
    }
    // Prefer standard `eth_gasPrice` for compatibility across RPC providers.
    const gasPriceHex = await provider.send('eth_gasPrice', []);
    const gasPrice = BigInt(gasPriceHex as string);
    return {
      gasPrice,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice
    } as any;
  };

  return provider;
}

export function createQuaiProvider(): JsonRpcProvider {
  const { rpcUrl, usePathing } = resolveQuaiRpcConfig();
  // Match Quai docs/examples: leave the "network"/chain arg undefined so the SDK can manage
  // shard-aware routing when `usePathing: true` is enabled.
  const provider = new JsonRpcProvider(rpcUrl, undefined as any, { usePathing });
  return applyFeeDataFallback(provider);
}

export function createTreasuryProvider(): JsonRpcProvider {
  const rpcUrl = resolveTreasuryRpcUrl();
  const provider = new JsonRpcProvider(rpcUrl, undefined as any, { usePathing: false });
  return applyFeeDataFallback(provider);
}

export function getTreasuryWallet(): Wallet {
  if (!config.quaiTreasuryPrivateKey) {
    throw new Error('QUAI_TREASURY_PRIVATE_KEY is not set');
  }
  return new Wallet(config.quaiTreasuryPrivateKey, createTreasuryProvider());
}
