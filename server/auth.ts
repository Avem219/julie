import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from './db.ts';
import { buildPrincipal, type Principal } from '../src/lib/rbac/rbac.ts';
import type { Row } from './util.ts';

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}
export const DUMMY_HASH = hashPassword('not-a-real-password-for-timing-only'); // equalises timing for unknown emails

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const SESSION_DAYS = 7;

export function createSession(db: DB, userId: string, now: Date): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
    .run(sha(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString());
  return token;
}
export const destroySession = (db: DB, token: string) => void db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));

export type Auth = { user: { id: string; email: string; displayName: string; timezone: string }; principal: Principal };

/** Trusted identity comes only from the server-side session row + user status + active roles in the DB. */
export function authenticate(db: DB, token: string | undefined, now: Date): Auth | null {
  if (!token) return null;
  const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(sha(token)) as Row | undefined;
  if (!s) return null;
  if (new Date(s.expires_at) <= now) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token)); return null; }
  const u = db.prepare('SELECT id,email,display_name,timezone,status FROM users WHERE id=?').get(s.user_id) as Row | undefined;
  if (!u || u.status !== 'ACTIVE') return null;
  const roles = (db.prepare('SELECT role FROM user_roles WHERE user_id=? AND revoked_at IS NULL').all(u.id) as Row[]).map((r) => r.role as string);
  return { user: { id: u.id, email: u.email, displayName: u.display_name, timezone: u.timezone }, principal: buildPrincipal(u.id, roles) };
}
