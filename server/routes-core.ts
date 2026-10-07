import type { Add, Env, Ctx } from './app.ts';
import { authenticate, createSession, destroySession, hashPassword, verifyPassword, DUMMY_HASH, SESSION_DAYS, type Auth } from './auth.ts';
import { obj, reqStr, optStr, optInt, oneOf, optOneOf, newId, EMAIL_RE, type Row } from './util.ts';
import { AppError, badRequest, notFound } from '../src/lib/errors.ts';
import { assertTimeZone } from '../src/lib/time/day.ts';
import { parsePagination } from '../src/lib/http/http.ts';
import { audit, awardXp, courseProgress, getEffectiveAccess, levelInfo, notify, securityEvent, touchStreak, trackEvent } from './services.ts';
import { tx } from './db.ts';

export function coreRoutes(e: Env, add: Add) {
  const { db, config } = e;
  const cookie = (token: string, maxAge: number) =>
    `julie_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;

  function me(a: Auth, now: Date) {
    const streak = (db.prepare('SELECT current_days,longest_days,last_activity_date FROM streaks WHERE user_id=?').get(a.user.id) as Row | undefined);
    const acc = getEffectiveAccess(db, a.user.id, now);
    return {
      ...a.user, roles: a.principal.roles, permissions: [...a.principal.permissions].sort(),
      access: { ...acc, expiresAt: acc.expiresAt?.toISOString() ?? null },
      level: levelInfo(db, a.user.id),
      streak: { currentDays: streak?.current_days ?? 0, longestDays: streak?.longest_days ?? 0, lastActivityDate: streak?.last_activity_date ?? null },
    };
  }

  add('POST', '/api/auth/register', { auth: 'none', limiter: 'auth' }, (c) => {
    const b = obj(c.body); // role fields in the body are ignored: new accounts are always STUDENT
    const email = reqStr(b, 'email', 3, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw badRequest('email is not valid');
    const pw = b.password;
    if (typeof pw !== 'string' || pw.length < 10 || pw.length > 200) throw badRequest('password must be 10-200 characters');
    const displayName = reqStr(b, 'displayName', 1, 80);
    const id = newId();
    try {
      tx(db, () => {
        db.prepare('INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').run(id, email, displayName, hashPassword(pw), c.now.toISOString());
        db.prepare(`INSERT INTO user_roles(user_id,role,granted_at,reason) VALUES(?,?,?,?)`).run(id, 'STUDENT', c.now.toISOString(), 'self-registration');
      });
    } catch (err: any) {
      if (String(err?.message).includes('UNIQUE')) throw new AppError(409, 'CONFLICT', 'Unable to register with these details');
      throw err;
    }
    const token = createSession(db, id, c.now);
    trackEvent(db, id, 'user_registered', {}, c.now);
    return { status: 201, body: me(authenticate(db, token, c.now)!, c.now), headers: { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400) } };
  });

  add('POST', '/api/auth/login', { auth: 'none', limiter: 'auth' }, (c) => {
    const b = obj(c.body);
    const email = reqStr(b, 'email', 3, 254).toLowerCase();
    const pw = typeof b.password === 'string' ? b.password.slice(0, 200) : '';
    const u = db.prepare('SELECT id,password_hash,status FROM users WHERE email=?').get(email) as Row | undefined;
    const ok = verifyPassword(pw, u?.password_hash ?? DUMMY_HASH) && !!u;
    if (!ok) { securityEvent(db, 'auth.failed', 'LOW', u?.id ?? null, c.ip, {}, c.now); throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'); }
    if (u!.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_INACTIVE', 'This account is not active');
    const token = createSession(db, u!.id, c.now);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(c.now.toISOString(), u!.id);
    return { body: me(authenticate(db, token, c.now)!, c.now), headers: { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400) } };
  });

  add('POST', '/api/auth/logout', {}, (c) => { destroySession(db, c.token!); return { status: 204, headers: { 'Set-Cookie': cookie('', 0) } }; });
  add('GET', '/api/auth/me', {}, (c) => ({ body: me(c.auth!, c.now) }));
  add('GET', '/api/auth/session', { auth: 'none' }, (c) => ({ body: c.auth ? me(c.auth, c.now) : null })); // 200 either way, so the client can check login state without a 401

  add('PATCH', '/api/profile', {}, (c) => {
    const b = obj(c.body); const id = c.auth!.user.id;
    const name = optStr(b, 'displayName', 80); const tz = optStr(b, 'timezone', 64);
    if (name !== undefined) { if (!name.trim()) throw badRequest('displayName cannot be empty'); db.prepare('UPDATE users SET display_name=? WHERE id=?').run(name.trim(), id); }
    if (tz !== undefined) { assertTimeZone(tz); db.prepare('UPDATE users SET timezone=? WHERE id=?').run(tz, id); }
    return { body: me(authenticate(db, c.token, c.now)!, c.now) };
  });

  add('GET', '/api/dashboard', { perm: 'progress:self' }, (c) => {
    const uid = c.auth!.user.id;
    const enrolled = (db.prepare(`SELECT c.id,c.title,c.subject,e.status FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=? AND e.status<>'DROPPED' ORDER BY e.enrolled_at DESC`).all(uid) as Row[])
      .map((r) => ({ id: r.id, title: r.title, subject: r.subject, status: r.status, progress: courseProgress(db, uid, r.id) }));
    const nextLesson = (courseId: string) => (db.prepare(`SELECT l.id,l.title FROM lessons l WHERE l.course_id=? AND l.status='PUBLISHED' AND l.id NOT IN (SELECT lesson_id FROM lesson_progress WHERE user_id=?) ORDER BY l.position LIMIT 1`).get(courseId, uid) as Row | undefined);
    const tasks = (db.prepare(`SELECT id,title,due_at,status FROM tasks WHERE user_id=? AND status IN ('TODO','IN_PROGRESS') ORDER BY due_at IS NULL, due_at LIMIT 5`).all(uid) as Row[]).map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at, status: t.status }));
    const goals = (db.prepare(`SELECT id,title,target_date FROM goals WHERE user_id=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 5`).all(uid) as Row[]).map((g) => ({ id: g.id, title: g.title, targetDate: g.target_date }));
    const recent = (db.prepare(`SELECT a.id,q.title,a.percentage,a.passed,a.submitted_at FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.user_id=? AND a.status='GRADED' ORDER BY a.submitted_at DESC LIMIT 5`).all(uid) as Row[]).map((a) => ({ id: a.id, quizTitle: a.title, percentage: a.percentage, passed: !!a.passed, submittedAt: a.submitted_at }));
    const unread = (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(uid) as Row).n;
    return { body: { me: me(c.auth!, c.now), courses: enrolled.map((x) => ({ ...x, nextLesson: nextLesson(x.id) ? { id: nextLesson(x.id)!.id, title: nextLesson(x.id)!.title } : null })), tasks, goals, recentAttempts: recent, unreadNotifications: unread } };
  });

  // Goals & tasks
  add('GET', '/api/goals', { perm: 'goal:self' }, (c) => {
    const uid = c.auth!.user.id;
    const goals = (db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at DESC').all(uid) as Row[]);
    const tasks = (db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY created_at DESC').all(uid) as Row[]);
    const t = (r: Row) => ({ id: r.id, goalId: r.goal_id, title: r.title, dueAt: r.due_at, status: r.status, completedAt: r.completed_at });
    return { body: { goals: goals.map((g) => ({ id: g.id, title: g.title, description: g.description, targetDate: g.target_date, status: g.status, tasks: tasks.filter((x) => x.goal_id === g.id).map(t) })), looseTasks: tasks.filter((x) => !x.goal_id).map(t) } };
  });
  add('POST', '/api/goals', { perm: 'goal:self' }, (c) => {
    const b = obj(c.body); const id = newId();
    const title = reqStr(b, 'title', 1, 200), description = optStr(b, 'description', 1000), targetDate = optStr(b, 'targetDate', 10);
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw badRequest('targetDate must be YYYY-MM-DD');
    db.prepare('INSERT INTO goals(id,user_id,title,description,target_date,created_at) VALUES(?,?,?,?,?,?)').run(id, c.auth!.user.id, title, description ?? null, targetDate ?? null, c.now.toISOString());
    return { status: 201, body: { id } };
  });
  add('PATCH', '/api/goals/:id', { perm: 'goal:self' }, (c) => {
    const b = obj(c.body); const uid = c.auth!.user.id;
    const g = db.prepare('SELECT * FROM goals WHERE id=? AND user_id=?').get(c.params.id, uid) as Row | undefined;
    if (!g) throw notFound('Goal not found');
    const status = optOneOf(b, 'status', ['ACTIVE', 'COMPLETED', 'ABANDONED'] as const); const title = optStr(b, 'title', 200);
    let xp = 0;
    tx(db, () => {
      if (title !== undefined && title.trim()) db.prepare('UPDATE goals SET title=? WHERE id=?').run(title.trim(), g.id);
      if (status) {
        db.prepare('UPDATE goals SET status=?, completed_at=? WHERE id=?').run(status, status === 'COMPLETED' ? c.now.toISOString() : null, g.id);
        if (status === 'COMPLETED' && awardXp(db, { userId: uid, amount: 20, source: 'GOAL_COMPLETED', key: `GOAL_COMPLETED:${uid}:${g.id}` }, c.now)) {
          xp = 20; touchStreak(db, uid, c.now); notify(db, uid, 'GOAL', 'Goal completed', g.title, c.now);
        }
      }
    });
    return { body: { ok: true, xpAwarded: xp } };
  });
  add('POST', '/api/tasks', { perm: 'task:self' }, (c) => {
    const b = obj(c.body); const uid = c.auth!.user.id; const id = newId();
    const goalId = optStr(b, 'goalId', 64); const dueAt = optStr(b, 'dueAt', 40);
    if (goalId && !db.prepare('SELECT 1 FROM goals WHERE id=? AND user_id=?').get(goalId, uid)) throw notFound('Goal not found');
    if (dueAt && Number.isNaN(new Date(dueAt).getTime())) throw badRequest('dueAt must be an ISO date-time');
    db.prepare('INSERT INTO tasks(id,user_id,goal_id,title,due_at,created_at) VALUES(?,?,?,?,?,?)').run(id, uid, goalId ?? null, reqStr(b, 'title', 1, 200), dueAt ?? null, c.now.toISOString());
    return { status: 201, body: { id } };
  });
  add('PATCH', '/api/tasks/:id', { perm: 'task:self' }, (c) => {
    const b = obj(c.body); const status = oneOf(b, 'status', ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const);
    const r = db.prepare('UPDATE tasks SET status=?, completed_at=? WHERE id=? AND user_id=?').run(status, status === 'DONE' ? c.now.toISOString() : null, c.params.id, c.auth!.user.id);
    if (r.changes === 0) throw notFound('Task not found');
    return { body: { ok: true } };
  });

  // Notifications
  add('GET', '/api/notifications', { perm: 'notification:self' }, (c) => {
    const p = parsePagination(c.query, { sortable: ['created_at'], defaultSort: 'created_at', maxPageSize: 50 });
    const unreadOnly = c.query.unread === '1'; const uid = c.auth!.user.id;
    const where = `user_id=?${unreadOnly ? ' AND read_at IS NULL' : ''}`;
    const total = (db.prepare(`SELECT COUNT(*) n FROM notifications WHERE ${where}`).get(uid) as Row).n;
    const rows = db.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(uid, p.take, p.skip) as Row[];
    return { body: { total, page: p.page, pageSize: p.pageSize, items: rows.map((n) => ({ id: n.id, category: n.category, title: n.title, body: n.body, read: !!n.read_at, createdAt: n.created_at })) } };
  });
  add('POST', '/api/notifications/read-all', { perm: 'notification:self' }, (c) => {
    db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(c.now.toISOString(), c.auth!.user.id);
    return { body: { ok: true } };
  });
  add('POST', '/api/notifications/:id/read', { perm: 'notification:self' }, (c) => {
    const r = db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').run(c.now.toISOString(), c.params.id, c.auth!.user.id);
    if (r.changes === 0) throw notFound('Notification not found');
    return { body: { ok: true } };
  });

  add('GET', '/api/health', { auth: 'none' }, () => { db.prepare('SELECT 1').get(); return { body: { status: 'ok' } }; });
}
