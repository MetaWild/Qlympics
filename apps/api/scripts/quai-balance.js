import { formatQuai, getAddress } from 'quais';
import { createQuaiProvider } from '../src/quai/provider.js';
async function main() {
    const address = process.argv[2];
    if (!address) {
        console.error('Usage: npm run quai:balance -- <address>');
        process.exit(1);
    }
    const normalized = getAddress(address);
    const provider = createQuaiProvider();
    const balanceHex = await provider.send('quai_getBalance', [normalized, 'latest']);
    const formatted = formatQuai(balanceHex);
    console.log(formatted);
}
main().catch((error) => {
    console.error('Balance check failed', error);
    process.exit(1);
});
