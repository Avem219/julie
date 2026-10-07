import type { DB } from './db.ts';
import { newId, type Row } from './util.ts';
import { computeEffectiveAccess, type EffectiveAccess, type PlanInfo } from '../src/lib/access/effective-access.ts';
import { calculateLevel, updateStreak, assertValidXpAmount, type LevelDef } from '../src/lib/gamification/gamification.ts';
import { resolveXpAward } from '../src/lib/gamification/xp-ledger.ts';
import { localDay } from '../src/lib/time/day.ts';
import { canManageOwned, type Principal } from '../src/lib/rbac/rbac.ts';
import { forbidden, notFound } from '../src/lib/errors.ts';

export const audit = (db: DB, actorId: string | null, action: string, entityType: string, entityId: string | null, meta: unknown, ctx: { ip?: string; requestId?: string }, now = new Date()) =>
  void db.prepare('INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,metadata,ip_address,request_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(newId(), actorId, action, entityType, entityId, JSON.stringify(meta ?? {}), ctx.ip ?? null, ctx.requestId ?? null, now.toISOString());

export const securityEvent = (db: DB, type: string, severity: string, userId: string | null, ip: string | undefined, meta: unknown, now = new Date()) =>
  void db.prepare('INSERT INTO security_events(id,user_id,type,severity,ip_address,metadata,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(newId(), userId, type, severity, ip ?? null, JSON.stringify(meta ?? {}), now.toISOString());

export const notify = (db: DB, userId: string, category: string, title: string, body: string | null, now = new Date()) =>
  void db.prepare('INSERT INTO notifications(id,user_id,category,title,body,created_at) VALUES(?,?,?,?,?,?)').run(newId(), userId, category, title, body, now.toISOString());

export const trackEvent = (db: DB, userId: string | null, name: string, props: unknown, now = new Date()) =>
  void db.prepare('INSERT INTO user_events(id,user_id,name,properties,created_at) VALUES(?,?,?,?,?)').run(newId(), userId, name, JSON.stringify(props ?? {}), now.toISOString());

const planInfo = (r: Row): PlanInfo => ({ code: r.code, grantsPremiumAccess: !!r.grants_premium, aiDailyMessageLimit: r.ai_daily_limit ?? null, features: JSON.parse(r.features ?? '{}') });

export function getEffectiveAccess(db: DB, userId: string, now: Date): EffectiveAccess {
  const u = db.prepare('SELECT status FROM users WHERE id=?').get(userId) as Row | undefined;
  const subs = db.prepare(`SELECT s.*, p.code, p.grants_premium, p.ai_daily_limit, p.features FROM subscriptions s JOIN plans p ON p.code=s.plan_code WHERE s.user_id=?`).all(userId) as Row[];
  const grants = db.prepare(`SELECT g.*, p.code, p.grants_premium, p.ai_daily_limit, p.features FROM access_grants g LEFT JOIN plans p ON p.code=g.plan_code WHERE g.user_id=?`).all(userId) as Row[];
  const free = db.prepare(`SELECT * FROM plans WHERE code='FREE'`).get() as Row | undefined;
  const d = (s: string | null) => (s ? new Date(s) : null);
  return computeEffectiveAccess({
    accountActive: u?.status === 'ACTIVE', now, freePlan: free ? planInfo(free) : null,
    subscriptions: subs.map((s) => ({ id: s.id, status: s.status, currentPeriodStart: new Date(s.period_start), currentPeriodEnd: d(s.period_end), trialEndsAt: d(s.trial_ends_at), plan: planInfo(s) })),
    grants: grants.map((g) => ({ id: g.id, type: g.type, startsAt: new Date(g.starts_at), expiresAt: d(g.expires_at), revokedAt: d(g.revoked_at), plan: g.code ? planInfo(g) : null })),
  });
}

export const loadLevels = (db: DB): LevelDef[] => (db.prepare('SELECT number,title,min_xp FROM levels ORDER BY min_xp').all() as Row[]).map((r) => ({ number: r.number, title: r.title, minXp: r.min_xp }));
export const totalXp = (db: DB, userId: string): number => (db.prepare('SELECT COALESCE(SUM(amount),0) t FROM xp_events WHERE user_id=?').get(userId) as Row).t;
export const levelInfo = (db: DB, userId: string) => calculateLevel(totalXp(db, userId), loadLevels(db));

/** Server-determined XP only. Same key + same award is a no-op; a conflicting reuse throws 409. Call inside tx() when combined with other writes. */
export function awardXp(db: DB, a: { userId: string; amount: number; source: string; key: string }, now: Date): boolean {
  assertValidXpAmount(a.amount);
  const existing = db.prepare('SELECT amount, source, user_id FROM xp_events WHERE idempotency_key=?').get(a.key) as Row | undefined;
  const decision = resolveXpAward(existing ? { amount: existing.amount, source: existing.source, userId: existing.user_id } : null, { amount: a.amount, source: a.source, userId: a.userId });
  if (decision === 'DUPLICATE') return false;
  db.prepare('INSERT INTO xp_events(id,user_id,amount,source,idempotency_key,created_at) VALUES(?,?,?,?,?,?)').run(newId(), a.userId, a.amount, a.source, a.key, now.toISOString());
  return true;
}

export function touchStreak(db: DB, userId: string, now: Date) {
  const tz = (db.prepare('SELECT timezone FROM users WHERE id=?').get(userId) as Row).timezone;
  const cur = db.prepare('SELECT current_days,longest_days,last_activity_date FROM streaks WHERE user_id=?').get(userId) as Row | undefined;
  const next = updateStreak({ currentDays: cur?.current_days ?? 0, longestDays: cur?.longest_days ?? 0, lastActivityDate: cur?.last_activity_date ?? null }, localDay(now, tz));
  db.prepare(`INSERT INTO streaks(user_id,current_days,longest_days,last_activity_date) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET current_days=excluded.current_days, longest_days=excluded.longest_days, last_activity_date=excluded.last_activity_date`)
    .run(userId, next.currentDays, next.longestDays, next.lastActivityDate);
  return next;
}

export const teacherIds = (db: DB, courseId: string): string[] => (db.prepare('SELECT user_id FROM course_teachers WHERE course_id=?').all(courseId) as Row[]).map((r) => r.user_id);
export function getCourse(db: DB, id: string): Row { const c = db.prepare('SELECT * FROM courses WHERE id=?').get(id) as Row | undefined; if (!c) throw notFound('Course not found'); return c; }
export const canManageCourse = (db: DB, p: Principal, courseId: string, ownPerm: string) => canManageOwned(p, 'course:manage_any', ownPerm, teacherIds(db, courseId));
/** Existence is checked first; drafts are hidden (404) from non-managers; managers-only actions give 403. */
export function requireManage(db: DB, p: Principal, courseId: string, ownPerm: string): Row {
  const c = getCourse(db, courseId);
  if (!canManageCourse(db, p, courseId, ownPerm)) { if (c.status !== 'PUBLISHED') throw notFound('Course not found'); throw forbidden(); }
  return c;
}

export function courseProgress(db: DB, userId: string, courseId: string) {
  const total = (db.prepare(`SELECT COUNT(*) n FROM lessons WHERE course_id=? AND status='PUBLISHED'`).get(courseId) as Row).n as number;
  const done = (db.prepare(`SELECT COUNT(*) n FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id WHERE lp.user_id=? AND l.course_id=? AND l.status='PUBLISHED'`).get(userId, courseId) as Row).n as number;
  return { totalLessons: total, completedLessons: done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
