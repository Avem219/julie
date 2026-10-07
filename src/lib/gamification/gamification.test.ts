import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateLevel, updateStreak, xpIdempotencyKey, assertValidXpAmount } from './gamification.ts';

const levels = [{ number: 1, title: 'A', minXp: 0 }, { number: 2, title: 'B', minXp: 100 }, { number: 3, title: 'C', minXp: 300 }];

test('level boundaries', () => {
  assert.equal(calculateLevel(0, levels).level, 1);
  assert.equal(calculateLevel(99, levels).level, 1);
  assert.equal(calculateLevel(100, levels).level, 2);
  const top = calculateLevel(5000, levels);
  assert.equal(top.level, 3); assert.equal(top.xpForNextLevel, null); assert.equal(top.progressPct, 100);
  assert.equal(calculateLevel(-50, levels).totalXp, 0);
});
test('level progress percentage', () => assert.equal(calculateLevel(150, levels).progressPct, 25));
test('level table without minXp 0 is rejected', () => assert.throws(() => calculateLevel(1, [{ number: 1, title: 'x', minXp: 10 }])));

test('streak: first activity, same day, next day, gap', () => {
  let s = updateStreak({ currentDays: 0, longestDays: 0, lastActivityDate: null }, '2026-09-01');
  assert.deepEqual(s, { currentDays: 1, longestDays: 1, lastActivityDate: '2026-09-01' });
  s = updateStreak(s, '2026-09-01'); assert.equal(s.currentDays, 1);
  s = updateStreak(s, '2026-09-02'); assert.equal(s.currentDays, 2);
  s = updateStreak(s, '2026-09-03'); assert.equal(s.longestDays, 3);
  s = updateStreak(s, '2026-09-10'); assert.equal(s.currentDays, 1); assert.equal(s.longestDays, 3);
});
test('streak handles month/year boundaries and clock skew', () => {
  assert.equal(updateStreak({ currentDays: 4, longestDays: 4, lastActivityDate: '2026-12-31' }, '2027-01-01').currentDays, 5);
  assert.equal(updateStreak({ currentDays: 4, longestDays: 4, lastActivityDate: '2026-09-05' }, '2026-09-04').currentDays, 4);
});
test('streak rejects malformed dates', () => assert.throws(() => updateStreak({ currentDays: 0, longestDays: 0, lastActivityDate: null }, '19/09/2026')));

test('XP idempotency key is deterministic; invalid amounts rejected', () => {
  assert.equal(xpIdempotencyKey('LESSON_COMPLETED', 'u1', 'l9'), 'LESSON_COMPLETED:u1:l9');
  for (const bad of [0, 1.5, 999_999, NaN]) assert.throws(() => assertValidXpAmount(bad));
  assertValidXpAmount(25);
});
