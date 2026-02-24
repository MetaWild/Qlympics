export function parseDecimalToBigInt(value: string, scale = 18): bigint {
  const [whole, frac = ''] = value.split('.');
  const cleanWhole = whole.replace(/[^0-9-]/g, '');
  const cleanFrac = frac.replace(/[^0-9]/g, '');
  const paddedFrac = (cleanFrac + '0'.repeat(scale)).slice(0, scale);
  const sign = cleanWhole.startsWith('-') ? -1n : 1n;
  const absWhole = cleanWhole.replace('-', '') || '0';
  const wholePart = BigInt(absWhole);
  const fracPart = BigInt(paddedFrac || '0');
  return sign * (wholePart * 10n ** BigInt(scale) + fracPart);
}

export function formatBigIntDecimal(value: bigint, scale = 18): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(scale, '0').replace(/0+$/, '');
  return fracStr.length ? `${sign}${whole.toString()}.${fracStr}` : `${sign}${whole.toString()}`;
}

export function computePayouts(
  rewardPoolQuai: string,
  coinsPerMatch: number,
  scores: Record<string, number>
): { totalQuai: string; breakdown: Record<string, string> } {
  const totalCoins = Object.values(scores).reduce((sum, val) => sum + val, 0);
  if (totalCoins <= 0) {
    return { totalQuai: '0', breakdown: {} };
  }

  const rewardBig = parseDecimalToBigInt(rewardPoolQuai, 18);
  const denom = coinsPerMatch > 0 ? BigInt(coinsPerMatch) : BigInt(totalCoins);
  const breakdown: Record<string, string> = {};
  let distributed = 0n;

  for (const [agentId, score] of Object.entries(scores)) {
    if (score <= 0) {
      continue;
    }
    // Each in-game coin has a fixed value: rewardPool / coinsPerMatch.
    // Uncollected coins are not distributed.
    const amount = (rewardBig * BigInt(score)) / denom;
    distributed += amount;
    breakdown[agentId] = formatBigIntDecimal(amount, 18);
  }

  return { totalQuai: formatBigIntDecimal(distributed, 18), breakdown };
}
