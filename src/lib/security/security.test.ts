import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApiKey, verifyApiKey, parseApiKey, hashApiKey } from './api-keys.ts';
import { createRateLimiter } from './rate-limit.ts';

const pepper = 'test-pepper-not-a-real-secret';

test('API key: generated, hashed, verifiable, plaintext not derivable from stored data', () => {
  const k = generateApiKey(pepper);
  assert.ok(parseApiKey(k.plaintext)); assert.equal(parseApiKey(k.plaintext)?.prefix, k.prefix);
  assert.ok(!k.keyHash.includes(k.plaintext.slice(-16)));
  assert.ok(verifyApiKey(k.plaintext, k.keyHash, pepper));
  assert.ok(!verifyApiKey(k.plaintext, k.keyHash, 'another-pepper-value-123'));
  assert.notEqual(generateApiKey(pepper).plaintext, k.plaintext);
});
test('API key: malformed or tampered keys and bad hashes are rejected', () => {
  const k = generateApiKey(pepper);
  const last = k.plaintext.slice(-1);
  assert.ok(!verifyApiKey(k.plaintext.slice(0, -1) + (last === 'a' ? 'b' : 'a'), k.keyHash, pepper));
  assert.ok(!verifyApiKey('julie_bad', k.keyHash, pepper));
  assert.ok(!verifyApiKey(k.plaintext, 'abcd', pepper));
  assert.ok(!verifyApiKey(k.plaintext, '', pepper));
});
test('API key: missing/short pepper is refused', () => {
  assert.throws(() => hashApiKey('x', ''));
  assert.throws(() => generateApiKey('short'));
});
test('rate limiter blocks over the limit and recovers after the window', () => {
  let t = 0;
  const rl = createRateLimiter({ windowMs: 1000, max: 3, now: () => t });
  assert.ok(rl.check('ip').allowed && rl.check('ip').allowed && rl.check('ip').allowed);
  const blocked = rl.check('ip');
  assert.equal(blocked.allowed, false);
  assert.ok(rl.check('other').allowed);
  t = 1001;
  assert.ok(rl.check('ip').allowed);
});
