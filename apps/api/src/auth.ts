import { createHash } from 'crypto';
import { query } from './db.js';

export type AuthenticatedAgent = {
  id: string;
  runtime_identity: string;
  payout_address: string | null;
  name: string | null;
  version: string | null;
  status: string;
  last_seen_at: string | null;
};

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function getApiKeyFromHeaders(headers: Record<string, unknown>): string | null {
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return apiKey;
  }
  return null;
}

export async function getAgentByApiKey(apiKey: string): Promise<AuthenticatedAgent | null> {
  const keyHash = hashApiKey(apiKey);
  const rows = await query<AuthenticatedAgent>(
    `
    SELECT a.id, a.runtime_identity, a.payout_address, a.name, a.version, a.status, a.last_seen_at
    FROM agent_api_keys k
    JOIN agents a ON a.id = k.agent_id
    WHERE k.key_hash = $1 AND k.revoked_at IS NULL
    `,
    [keyHash]
  );
  return rows[0] ?? null;
}
