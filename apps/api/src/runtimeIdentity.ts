import { randomBytes } from 'crypto';

const RUNTIME_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{1,10}$/;
const RESERVED_RUNTIME_IDENTITIES = new Set([
  'admin',
  'api',
  'null',
  'owner',
  'qlympics',
  'root',
  'system'
]);

export function generateRuntimeIdentity(): string {
  return randomBytes(5).toString('hex').slice(0, 10);
}

export function validateRuntimeIdentity(value: string): string | null {
  const runtimeIdentity = value.trim();
  if (!runtimeIdentity) {
    return 'runtime_identity is required';
  }
  if (runtimeIdentity.length > 10) {
    return 'runtime_identity must be 1-10 characters';
  }
  if (!RUNTIME_IDENTITY_PATTERN.test(runtimeIdentity)) {
    return 'runtime_identity may only use letters, numbers, "_" or "-"';
  }
  if (RESERVED_RUNTIME_IDENTITIES.has(runtimeIdentity.toLowerCase())) {
    return 'runtime_identity is reserved';
  }
  return null;
}
