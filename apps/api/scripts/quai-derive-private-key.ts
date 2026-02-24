import { quai } from 'quais';

type ZoneKey = keyof typeof quai.Zone;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function getZone(zoneName: string) {
  const key = zoneName as ZoneKey;
  const zone = quai.Zone?.[key];
  if (!zone) {
    throw new Error(`Unknown zone "${zoneName}". Expected one of: ${Object.keys(quai.Zone ?? {}).join(', ')}`);
  }
  return zone;
}

async function main() {
  if (!quai.Mnemonic || !quai.QuaiHDWallet) {
    throw new Error(
      'Installed quais SDK does not expose Mnemonic/QuaiHDWallet. ' +
      'Install a Quai SDK version that includes QuaiHDWallet to use this script.'
    );
  }

  const mnemonicPhrase = requireEnv('QUAI_MNEMONIC');
  const targetAddress = requireEnv('QUAI_TARGET_ADDRESS');
  const zoneName = (process.env.QUAI_ZONE ?? 'Cyprus1').trim();
  const account = Number(process.env.QUAI_ACCOUNT ?? '0');
  const scanLimit = Number(process.env.QUAI_SCAN_LIMIT ?? '50');

  if (Number.isNaN(account) || account < 0) {
    throw new Error('QUAI_ACCOUNT must be a non-negative number');
  }
  if (Number.isNaN(scanLimit) || scanLimit <= 0) {
    throw new Error('QUAI_SCAN_LIMIT must be a positive number');
  }

  const mnemonic = quai.Mnemonic.fromPhrase(mnemonicPhrase);
  const wallet = quai.QuaiHDWallet.fromMnemonic(mnemonic);
  const zone = getZone(zoneName);

  let matchedAddress: string | null = null;

  for (let i = 0; i < scanLimit; i += 1) {
    const info = await wallet.getNextAddress(account, zone);
    if (info.address.toLowerCase() === targetAddress.toLowerCase()) {
      matchedAddress = info.address;
      break;
    }
  }

  if (!matchedAddress) {
    throw new Error(
      `Address not found in first ${scanLimit} derived addresses. ` +
      'Increase QUAI_SCAN_LIMIT, or verify QUAI_ACCOUNT/QUAI_ZONE.'
    );
  }

  const privateKey = wallet.getPrivateKey(matchedAddress);
  console.log(privateKey);
}

main().catch((error) => {
  console.error('Failed to derive private key:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
