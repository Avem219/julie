import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveXpAward } from './gamification/xp-ledger.ts';
import { localDay, utcDay, secondsUntilUtcReset } from './time/day.ts';
import { signWebhook, verifyWebhook, decidePaymentTransition, paymentMatchesExpected, addInterval, nextPeriod } from './payments/payments.ts';
import { validateUpload, generateStorageKey, sanitizeFilename } from './storage/upload-validation.ts';
import { toErrorResponse, parsePagination } from './http/http.ts';
import { AppError, forbidden } from './errors.ts';

const d = (s: string) => new Date(s);

test('XP: new key creates, identical retry is a duplicate, conflicting reuse is rejected', () => {
  const r = { amount: 25, source: 'QUIZ_PASSED', userId: 'u1' };
  assert.equal(resolveXpAward(null, r), 'CREATE');
  assert.equal(resolveXpAward(r, { ...r }), 'DUPLICATE');
  assert.throws(() => resolveXpAward(r, { ...r, amount: 999 }), (e) => e instanceof AppError && e.status === 409);
  assert.throws(() => resolveXpAward(r, { ...r, userId: 'u2' }));
});

test('local day depends on time zone; invalid zones rejected', () => {
  const t = d('2026-09-19T23:30:00Z');
  assert.equal(localDay(t, 'UTC'), '2026-09-19');
  assert.equal(localDay(t, 'Asia/Tokyo'), '2026-09-20');
  assert.equal(localDay(t, 'America/Los_Angeles'), '2026-09-19');
  assert.throws(() => localDay(t, 'Mars/Base'));
  assert.equal(utcDay(t), '2026-09-19');
  assert.equal(secondsUntilUtcReset(d('2026-09-19T23:59:00Z')), 60);
});

test('webhook signatures: valid, tampered, wrong secret, stale, malformed', () => {
  const secret = 'whsec_test_secret_value_123', body = '{"id":"evt_1","status":"SUCCEEDED"}';
  const now = d('2026-09-19T12:00:00Z'), ts = Math.floor(now.getTime() / 1000);
  const sig = signWebhook(body, ts, secret);
  const base = { rawBody: body, timestamp: ts, signatureHex: sig, secret, now };
  assert.equal(verifyWebhook(base), true);
  assert.equal(verifyWebhook({ ...base, rawBody: body.replace('SUCCEEDED', 'FAILED') }), false);
  assert.equal(verifyWebhook({ ...base, secret: 'another_secret_value_xyz' }), false);
  assert.equal(verifyWebhook({ ...base, now: d('2026-09-19T12:10:00Z') }), false); // replay outside window
  assert.equal(verifyWebhook({ ...base, signatureHex: 'zz' }), false);
  assert.throws(() => verifyWebhook({ ...base, secret: '' }));
});

test('payment transitions are idempotent and order-tolerant', () => {
  assert.deepEqual(decidePaymentTransition('PENDING', 'SUCCEEDED'), { action: 'APPLY', next: 'SUCCEEDED' });
  assert.deepEqual(decidePaymentTransition(null, 'SUCCEEDED'), { action: 'APPLY', next: 'SUCCEEDED' });
  assert.equal(decidePaymentTransition('SUCCEEDED', 'SUCCEEDED').action, 'NOOP_DUPLICATE'); // replayed callback
  assert.equal(decidePaymentTransition('SUCCEEDED', 'FAILED').action, 'IGNORE_STALE');
  assert.deepEqual(decidePaymentTransition('FAILED', 'SUCCEEDED'), { action: 'APPLY', next: 'SUCCEEDED' });
  assert.deepEqual(decidePaymentTransition('SUCCEEDED', 'REFUNDED'), { action: 'APPLY', next: 'REFUNDED' });
  assert.equal(decidePaymentTransition('PENDING', 'REFUNDED').action, 'REJECT');
  assert.equal(decidePaymentTransition('REFUNDED', 'SUCCEEDED').action, 'IGNORE_STALE');
});

test('paid amount must match the server-side expected price', () => {
  assert.ok(paymentMatchesExpected({ amountCents: 999, currency: 'usd' }, { amountCents: 999, currency: 'USD' }));
  assert.ok(!paymentMatchesExpected({ amountCents: 1, currency: 'USD' }, { amountCents: 999, currency: 'USD' }));
  assert.ok(!paymentMatchesExpected({ amountCents: 999, currency: 'EUR' }, { amountCents: 999, currency: 'USD' }));
});

test('billing period math', () => {
  assert.deepEqual(addInterval(d('2026-01-31T10:00:00Z'), 'MONTH', 1), d('2026-02-28T10:00:00Z')); // clamp
  assert.deepEqual(addInterval(d('2026-12-15T00:00:00Z'), 'MONTH', 1), d('2027-01-15T00:00:00Z'));
  assert.deepEqual(addInterval(d('2026-09-19T00:00:00Z'), 'WEEK', 1), d('2026-09-26T00:00:00Z'));
  assert.deepEqual(addInterval(d('2026-09-19T00:00:00Z'), 'DAY', 2), d('2026-09-21T00:00:00Z'));
  assert.throws(() => addInterval(d('2026-09-19T00:00:00Z'), 'DAY', 0));
  const plan = { interval: 'MONTH' as const, intervalCount: 1 };
  assert.deepEqual(nextPeriod(plan, d('2026-09-19T00:00:00Z'), d('2026-10-01T00:00:00Z')).start, d('2026-10-01T00:00:00Z')); // early renewal extends
  assert.deepEqual(nextPeriod(plan, d('2026-09-19T00:00:00Z'), d('2026-09-01T00:00:00Z')).start, d('2026-09-19T00:00:00Z')); // lapsed restarts
});

const pdfHead = new TextEncoder().encode('%PDF-1.7\n....');
test('uploads: valid PDF passes; spoofed, oversized, dangerous, mismatched files fail', () => {
  const ok = validateUpload({ filename: 'notes.pdf', declaredMime: 'application/pdf', sizeBytes: 1000, head: pdfHead });
  assert.equal(ok.ok, true);
  const bad = (o: object) => validateUpload({ filename: 'notes.pdf', declaredMime: 'application/pdf', sizeBytes: 1000, head: pdfHead, ...o }).ok;
  assert.equal(bad({ head: new TextEncoder().encode('MZ\x90\x00 exe bytes....') }), false); // executable disguised as PDF
  assert.equal(bad({ filename: 'report.php.pdf' }), false);
  assert.equal(bad({ filename: 'x.exe' }), false);
  assert.equal(bad({ filename: 'notes.png' }), false);
  assert.equal(bad({ sizeBytes: 26 * 1024 * 1024 }), false);
  assert.equal(bad({ sizeBytes: 0 }), false);
  assert.equal(bad({ declaredMime: 'image/svg+xml' }), false);
  assert.equal(bad({ declaredMime: 'text/html', filename: 'a.html' }), false);
});
test('filename sanitising and random storage keys', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\evil.pdf'), 'evil.pdf');
  const k1 = generateStorageKey('pdf', d('2026-09-19T00:00:00Z')), k2 = generateStorageKey('pdf', d('2026-09-19T00:00:00Z'));
  assert.match(k1, /^uploads\/2026\/09\/[0-9a-f]{32}\.pdf$/); assert.notEqual(k1, k2);
  assert.throws(() => generateStorageKey('../x'));
});

test('error responses: AppError passes through, unknown errors are masked', () => {
  const a = toErrorResponse(forbidden(), 'r1');
  assert.equal(a.status, 403); assert.equal(a.body.error.code, 'FORBIDDEN');
  const b = toErrorResponse(new Error('connection to postgres://user:pw@host failed'));
  assert.equal(b.status, 500); assert.ok(!JSON.stringify(b).includes('postgres'));
});
test('pagination: clamps, validates and whitelists sort fields', () => {
  const o = { sortable: ['createdAt', 'title'], defaultSort: 'createdAt' };
  assert.deepEqual(parsePagination({}, o), { page: 1, pageSize: 20, skip: 0, take: 20, orderBy: { createdAt: 'asc' } });
  assert.equal(parsePagination({ page: '3', pageSize: '10', sort: 'title', order: 'desc' }, o).skip, 20);
  for (const q of [{ page: '0' }, { pageSize: '1000' }, { page: 'abc' }, { sort: 'password_hash' }, { order: 'sideways' }, { page: '-1' }])
    assert.throws(() => parsePagination(q, o));
});
