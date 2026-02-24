import { createQuaiProvider } from '../src/quai/provider.js';

async function main() {
  const provider = createQuaiProvider();
  const blockNumber = await provider.getBlockNumber();
  const network = await provider.getNetwork();

  console.log(`Quai RPC reachable. ChainId: ${network.chainId} Latest block: ${blockNumber}`);
}

main().catch((error) => {
  console.error('Failed to reach Quai RPC:', error);
  process.exit(1);
});
