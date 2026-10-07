import { badRequest } from '../errors.ts';

export function assertTimeZone(tz: string): void {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw badRequest(`Invalid time zone "${tz}"`); }
}
/** Learner's local calendar day (YYYY-MM-DD) for streaks. Derived server-side from the profile time zone. */
export function localDay(instant: Date, timeZone: string): string {
  assertTimeZone(timeZone);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}
/** AI usage is bucketed per UTC day (ai_usage.day). */
export const utcDay = (instant: Date): string => instant.toISOString().slice(0, 10);
export const secondsUntilUtcReset = (now: Date): number =>
  Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
