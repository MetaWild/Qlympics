import { createHash } from 'crypto';

export function computePowHash(nonce: string, solution: string): string {
  return createHash('sha256').update(`${nonce}:${solution}`).digest('hex');
}

export function meetsDifficulty(hashHex: string, difficulty: number): boolean {
  if (difficulty <= 0) {
    return false;
  }
  const prefix = '0'.repeat(difficulty);
  return hashHex.startsWith(prefix);
}

export function verifyPow(nonce: string, solution: string, difficulty: number): boolean {
  const hash = computePowHash(nonce, solution);
  return meetsDifficulty(hash, difficulty);
}
