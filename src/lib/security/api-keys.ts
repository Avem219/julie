import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_RE = /^julie_([0-9a-f]{12})_([0-9a-f]{64})$/;

function assertPepper(p: string) {
  if (!p || p.length < 16) throw new Error('API_KEY_HASH_PEPPER must be set (>= 16 chars)');
}
export const hashApiKey = (plaintext: string, pepper: string) => {
  assertPepper(pepper);
  return createHmac('sha256', pepper).update(plaintext).digest('hex');
};

/** Plaintext is returned once for display; only prefix + keyHash are persisted. */
export function generateApiKey(pepper: string) {
  const prefix = randomBytes(6).toString('hex');
  const plaintext = `julie_${prefix}_${randomBytes(32).toString('hex')}`;
  return { plaintext, prefix, keyHash: hashApiKey(plaintext, pepper) };
}

export const parseApiKey = (presented: string) => {
  const m = KEY_RE.exec(presented);
  return m ? { prefix: m[1] } : null;
};

/** Look up by prefix, then compare hashes in constant time. */
export function verifyApiKey(presented: string, storedHash: string, pepper: string): boolean {
  if (!parseApiKey(presented)) return false;
  const a = Buffer.from(hashApiKey(presented, pepper), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const maskApiKey = (prefix: string) => `julie_${prefix}_${'•'.repeat(8)}`;
