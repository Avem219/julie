import { conflict } from '../errors.ts';

export type XpLedgerRow = { amount: number; source: string; userId: string };
export type XpRequest = { amount: number; source: string; userId: string };

/**
 * Decide what to do for an XP award whose idempotency key may already exist.
 * Same key + same meaning => harmless retry (no second award).
 * Same key + different amount/source/user => conflict (rejected, never silently applied).
 */
export function resolveXpAward(existing: XpLedgerRow | null, req: XpRequest): 'CREATE' | 'DUPLICATE' {
  if (!existing) return 'CREATE';
  if (existing.amount === req.amount && existing.source === req.source && existing.userId === req.userId) return 'DUPLICATE';
  throw conflict('Idempotency key was already used for a different XP award');
}
