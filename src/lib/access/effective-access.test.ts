import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEffectiveAccess, canUseAi, type PlanInfo, type SubscriptionInfo, type GrantInfo } from './effective-access.ts';

const now = new Date('2026-09-19T12:00:00Z');
const d = (s: string) => new Date(s);
const FREE: PlanInfo = { code: 'FREE', grantsPremiumAccess: false, aiDailyMessageLimit: 5 };
const MONTHLY: PlanInfo = { code: 'MONTHLY', grantsPremiumAccess: true, aiDailyMessageLimit: 100 };
const WEEKLY: PlanInfo = { code: 'WEEKLY', grantsPremiumAccess: true, aiDailyMessageLimit: 50 };
const sub = (o: Partial<SubscriptionInfo> = {}): SubscriptionInfo => ({
  id: 's1', status: 'ACTIVE', currentPeriodStart: d('2026-09-01T00:00:00Z'), currentPeriodEnd: d('2026-10-01T00:00:00Z'),
  trialEndsAt: null, plan: MONTHLY, ...o });
const grant = (o: Partial<GrantInfo> = {}): GrantInfo => ({
  id: 'g1', type: 'TIMED', startsAt: d('2026-09-10T00:00:00Z'), expiresAt: d('2026-09-30T00:00:00Z'),
  revokedAt: null, plan: null, ...o });
const run = (subscriptions: SubscriptionInfo[], grants: GrantInfo[], accountActive = true) =>
  computeEffectiveAccess({ accountActive, subscriptions, grants, freePlan: FREE, now });

test('no subscription or grant falls back to FREE', () => {
  const a = run([], []);
  assert.equal(a.source, 'FREE'); assert.equal(a.hasPremiumAccess, false); assert.equal(a.aiDailyMessageLimit, 5);
});
test('active subscription gives its plan', () => {
  const a = run([sub()], []);
  assert.equal(a.source, 'SUBSCRIPTION'); assert.equal(a.planCode, 'MONTHLY'); assert.equal(a.hasPremiumAccess, true);
  assert.deepEqual(a.expiresAt, d('2026-10-01T00:00:00Z'));
});
test('expired subscription falls back to FREE', () => {
  const a = run([sub({ currentPeriodEnd: d('2026-09-19T12:00:00Z') })], []);
  assert.equal(a.source, 'FREE');
});
test('PAST_DUE, CANCELED and EXPIRED grant nothing', () => {
  for (const status of ['PAST_DUE', 'CANCELED', 'EXPIRED'] as const) assert.equal(run([sub({ status })], []).source, 'FREE');
});
test('trial ends at trialEndsAt', () => {
  const trial = sub({ status: 'TRIALING', trialEndsAt: d('2026-09-25T00:00:00Z') });
  assert.deepEqual(run([trial], []).expiresAt, d('2026-09-25T00:00:00Z'));
  assert.equal(run([{ ...trial, trialEndsAt: d('2026-09-19T11:00:00Z') }], []).source, 'FREE');
});
test('subscription not yet started is ignored', () => {
  assert.equal(run([sub({ currentPeriodStart: d('2026-09-20T00:00:00Z') })], []).source, 'FREE');
});
test('unlimited admin grant never expires and beats a subscription', () => {
  const a = run([sub()], [grant({ type: 'UNLIMITED', expiresAt: null })]);
  assert.equal(a.source, 'GRANT'); assert.equal(a.neverExpires, true); assert.equal(a.aiDailyMessageLimit, null);
});
test('timed grant works until expiry, then stops', () => {
  assert.equal(run([], [grant()]).source, 'GRANT');
  assert.equal(run([], [grant({ expiresAt: d('2026-09-19T12:00:00Z') })]).source, 'FREE');
});
test('revoked grant is ignored', () => {
  assert.equal(run([], [grant({ type: 'UNLIMITED', expiresAt: null, revokedAt: d('2026-09-15T00:00:00Z') })]).source, 'FREE');
});
test('future-dated revocation does not affect access yet', () => {
  assert.equal(run([], [grant({ revokedAt: d('2026-09-25T00:00:00Z') })]).source, 'GRANT');
});
test('grant that has not started, or malformed TIMED without expiry, is ignored', () => {
  assert.equal(run([], [grant({ startsAt: d('2026-09-20T00:00:00Z') })]).source, 'FREE');
  assert.equal(run([], [grant({ expiresAt: null })]).source, 'FREE');
});
test('best of several: higher AI limit wins; equal -> subscription wins', () => {
  const g = grant({ plan: WEEKLY });
  assert.equal(run([sub()], [g]).planCode, 'MONTHLY');
  const g2 = grant({ plan: MONTHLY, expiresAt: d('2026-10-01T00:00:00Z') });
  assert.equal(run([sub()], [g2]).source, 'SUBSCRIPTION');
});
test('suspended account has no access even with an unlimited grant', () => {
  const a = run([sub()], [grant({ type: 'UNLIMITED', expiresAt: null })], false);
  assert.equal(a.hasAccess, false); assert.equal(canUseAi(a, 0), false);
});
test('AI limit enforcement', () => {
  const a = run([], []);
  assert.equal(canUseAi(a, 4), true); assert.equal(canUseAi(a, 5), false);
  assert.equal(canUseAi(run([], [grant({ type: 'UNLIMITED', expiresAt: null })]), 10_000), true);
});
