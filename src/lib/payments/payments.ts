import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

/** Webhook signature: HMAC-SHA256 over `${timestamp}.${rawBody}`. Also usable for outgoing developer webhooks. */
export const signWebhook = (rawBody: string, timestamp: number, secret: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

export function verifyWebhook(
  p: { rawBody: string; timestamp: number; signatureHex: string; secret: string; now: Date; toleranceSeconds?: number },
): boolean {
  if (!p.secret || p.secret.length < 16) throw new Error('Webhook secret must be configured (>= 16 chars)');
  const tol = p.toleranceSeconds ?? 300;
  if (!Number.isFinite(p.timestamp) || Math.abs(p.now.getTime() / 1000 - p.timestamp) > tol) return false; // replay window
  if (!/^[0-9a-f]{64}$/.test(p.signatureHex)) return false;
  return timingSafeEqual(Buffer.from(signWebhook(p.rawBody, p.timestamp, p.secret), 'hex'), Buffer.from(p.signatureHex, 'hex'));
}

export type Transition = { action: 'APPLY'; next: PaymentStatus } | { action: 'NOOP_DUPLICATE' } | { action: 'IGNORE_STALE' } | { action: 'REJECT' };

/** Idempotent, order-tolerant state machine for provider events. current=null means unseen externalRef. */
export function decidePaymentTransition(current: PaymentStatus | null, incoming: PaymentStatus): Transition {
  if (current === incoming) return { action: 'NOOP_DUPLICATE' };
  switch (current) {
    case null: case 'PENDING':
      return incoming === 'REFUNDED' ? { action: 'REJECT' } : { action: 'APPLY', next: incoming };
    case 'FAILED':
      return incoming === 'SUCCEEDED' ? { action: 'APPLY', next: 'SUCCEEDED' } : { action: 'IGNORE_STALE' };
    case 'SUCCEEDED':
      return incoming === 'REFUNDED' ? { action: 'APPLY', next: 'REFUNDED' } : { action: 'IGNORE_STALE' }; // late FAILED can't undo a success
    case 'REFUNDED':
      return { action: 'IGNORE_STALE' };
  }
}

/** Amount/currency must match what the SERVER expected for the plan, never what the client or payload claims. */
export const paymentMatchesExpected = (
  paid: { amountCents: number; currency: string }, expected: { amountCents: number; currency: string },
) => paid.amountCents === expected.amountCents && paid.currency.toUpperCase() === expected.currency.toUpperCase();

function addMonthsClamped(d: Date, months: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12), m = total % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), dim), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}
export function addInterval(from: Date, interval: 'DAY' | 'WEEK' | 'MONTH', count: number): Date {
  if (!Number.isInteger(count) || count < 1) throw new Error('intervalCount must be a positive integer');
  if (interval === 'MONTH') return addMonthsClamped(from, count);
  return new Date(from.getTime() + count * (interval === 'WEEK' ? 7 : 1) * 86_400_000);
}
/** Renewal extends from the current period end if still running, otherwise starts at payment time. */
export function nextPeriod(plan: { interval: 'DAY' | 'WEEK' | 'MONTH'; intervalCount: number }, paidAt: Date, currentPeriodEnd: Date | null) {
  const start = currentPeriodEnd && currentPeriodEnd > paidAt ? currentPeriodEnd : paidAt;
  return { start, end: addInterval(start, plan.interval, plan.intervalCount) };
}
