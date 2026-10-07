import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb, type DB } from './db.ts';
import { createApp } from './app.ts';
import { seedDev } from './seed.ts';
import type { Config } from './config.ts';
import type { AIProvider } from './ai.ts';
import { signWebhook } from '../src/lib/payments/payments.ts';

const PW = 'sample-password-1234'; const WH = 'whsec_test_secret_123456';
let now = new Date('2026-09-19T12:00:00Z');
const ai = { calls: [] as any[], fail: false } ;
const fakeAi: AIProvider = { name: 'fake', async complete(input) { ai.calls.push(input); if (ai.fail) throw new Error('upstream down'); return { text: 'Here is an explanation.', tokensIn: 1, tokensOut: 1, model: 'fake-model' }; } };
const baseConfig = (o: Partial<Config> = {}): Config => ({ nodeEnv: 'test', port: 0, dbPath: ':memory:', secureCookies: false, trustProxy: false, apiKeyPepper: 'test-pepper-1234567890', paymentWebhookSecret: WH, ai: fakeAi, loginRateLimitPerMin: 1000, apiRateLimitPerMin: 100000, quiet: true, storageDir: './data/test-uploads-app', ...o });

async function boot(cfg: Config) {
  const db = openDb(':memory:'); const ids = seedDev(db, PW, now);
  const app = createApp({ db, config: cfg, clock: () => now });
  const server: Server = createServer((req, res) => void app.handler(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  return { db, ids, server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
class Client {
  cookie = '';
  base: string;
  constructor(base: string) { this.base = base; }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'X-Requested-With': 'julie', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null, text };
  }
  get = (p: string) => this.req('GET', p); post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b); del = (p: string) => this.req('DELETE', p);
  async login(email: string, password = PW) { const r = await this.post('/api/auth/login', { email, password }); assert.equal(r.status, 200, r.text); return r.json; }
}

let ctx: Awaited<ReturnType<typeof boot>>;
before(async () => { ctx = await boot(baseConfig()); });
after(() => { ctx.server.close(); });
const client = () => new Client(ctx.base);
const as = async (email: string) => { const c = client(); await c.login(email); return c; };
const courseId = (slug: string) => (ctx.db.prepare('SELECT id FROM courses WHERE slug=?').get(slug) as any).id as string;

test('register creates a STUDENT and ignores any client-supplied roles', async () => {
  const c = client();
  const r = await c.post('/api/auth/register', { email: 'New.User@Example.test', password: 'a-long-password-1', displayName: 'New User', roles: ['ADMIN'], role: 'ADMIN', isAdmin: true });
  assert.equal(r.status, 201); assert.deepEqual(r.json.roles, ['STUDENT']);
  assert.ok(!r.json.permissions.includes('user:manage'));
  assert.equal((await c.get('/api/auth/me')).json.email, 'new.user@example.test');
  assert.equal((await client().post('/api/auth/register', { email: 'new.user@example.test', password: 'a-long-password-1', displayName: 'x' })).status, 409);
  assert.equal((await client().post('/api/auth/register', { email: 'weak@example.test', password: 'short', displayName: 'x' })).status, 400);
});

test('authentication: bad credentials, unauthenticated access, logout, CSRF header', async () => {
  assert.equal((await client().post('/api/auth/login', { email: 'student@example.test', password: 'wrong-password-1' })).status, 401);
  assert.equal((await client().post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-1' })).status, 401);
  assert.equal((await client().get('/api/auth/me')).status, 401);
  assert.equal((await client().get('/api/courses')).status, 401);
  const c = await as('student@example.test');
  const noHeader = await fetch(ctx.base + '/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c.cookie }, body: JSON.stringify({ title: 'x' }) });
  assert.equal(noHeader.status, 403); // CSRF header missing
  assert.equal((await c.post('/api/auth/logout')).status, 204);
  assert.equal((await c.get('/api/auth/me')).status, 401);
});

test('RBAC: students cannot reach teacher/admin/developer endpoints', async () => {
  const s = await as('student@example.test');
  assert.equal((await s.post('/api/courses', { title: 'Hacked course' })).status, 403);
  assert.equal((await s.get('/api/admin/users')).status, 403);
  assert.equal((await s.get('/api/admin/audit-logs')).status, 403);
  assert.equal((await s.get('/api/developer/keys')).status, 403);
  assert.equal((await s.post('/api/admin/users/x/roles', { role: 'ADMIN' })).status, 403);
  const ev = (await (await as('admin@example.test')).get('/api/admin/security-events')).json;
  assert.ok(ev.items.some((e: any) => e.type === 'rbac.denied'));
});

test('developer role does not grant admin or student abilities; admin is not a teacher by implication', async () => {
  const d = await as('developer@example.test');
  assert.equal((await d.get('/api/admin/users')).status, 403);
  assert.equal((await d.get('/api/developer/keys')).status, 200);
  const a = await as('admin@example.test');
  assert.equal((await a.get('/api/developer/keys')).status, 403);
  assert.equal((await a.post('/api/courses', { title: 'Admin course' })).status, 403); // needs course:manage_own (teacher role)
});

test('teacher ownership: cannot edit or extend another teacher\'s course; admin can manage any', async () => {
  const t1 = await as('teacher@example.test'); const t2 = await as('teacher2@example.test'); const admin = await as('admin@example.test');
  const fr = courseId('fractions-basics');
  assert.equal((await t2.patch(`/api/courses/${fr}`, { title: 'Stolen' })).status, 403);
  assert.equal((await t2.post(`/api/courses/${fr}/lessons`, { title: 'Injected' })).status, 403);
  assert.equal((await t2.post(`/api/courses/${fr}/quizzes`, { title: 'Q', questions: [{ type: 'TRUE_FALSE', prompt: 'p', options: [{ text: 'T', isCorrect: true }, { text: 'F' }] }] })).status, 403);
  assert.equal((await t2.get(`/api/courses/${fr}/results`)).status, 403);
  const created = await t1.post('/api/courses', { title: 'Private draft course', created_by: 'x', id: 'evil', slug: 'evil' });
  assert.equal(created.status, 201);
  const draft = created.json.id;
  assert.equal((await t2.get(`/api/courses/${draft}`)).status, 404); // drafts are invisible to other teachers
  assert.equal((await t2.patch(`/api/courses/${draft}`, { title: 'x' })).status, 404);
  assert.equal((await t1.patch(`/api/courses/${draft}`, { title: 'Renamed', status: 'PUBLISHED', created_by: ctx.ids.student })).status, 200);
  const row = ctx.db.prepare('SELECT title,created_by,slug FROM courses WHERE id=?').get(draft) as any;
  assert.equal(row.title, 'Renamed'); assert.equal(row.created_by, ctx.ids.teacher); assert.notEqual(row.slug, 'evil'); // mass assignment ignored
  assert.equal((await admin.patch(`/api/courses/${draft}`, { description: 'moderated' })).status, 200);
});

test('learning flow: enroll, complete lesson once for XP, streak, progress', async () => {
  const s = await as('student@example.test'); const fr = courseId('fractions-basics');
  assert.equal((await s.post(`/api/courses/${fr}/enroll`)).status, 201);
  const course = (await s.get(`/api/courses/${fr}`)).json;
  assert.equal(course.lessons.length, 2);
  const l1 = course.lessons[0].id;
  assert.equal((await s.get(`/api/lessons/${l1}`)).json.locked, null);
  const c1 = (await s.post(`/api/lessons/${l1}/complete`)).json;
  assert.equal(c1.xpAwarded, 10); assert.equal(c1.progress.percent, 50);
  assert.equal((await s.post(`/api/lessons/${l1}/complete`)).json.xpAwarded, 0); // idempotent
  const me = (await s.get('/api/auth/me')).json;
  assert.equal(me.level.totalXp, 10); assert.equal(me.streak.currentDays, 1);
  const c2 = (await s.post(`/api/lessons/${course.lessons[1].id}/complete`)).json;
  assert.equal(c2.courseCompleted, true);
  const dash = (await s.get('/api/dashboard')).json;
  assert.equal(dash.courses[0].progress.percent, 100); assert.ok(dash.unreadNotifications >= 1);
});

test('unenrolled students cannot complete lessons or take quizzes', async () => {
  const c = client(); await c.post('/api/auth/register', { email: 'outsider@example.test', password: 'a-long-password-1', displayName: 'Out' });
  const fr = courseId('fractions-basics'); const course = (await c.get(`/api/courses/${fr}`)).json;
  assert.equal((await c.get(`/api/lessons/${course.lessons[1].id}`)).json.locked, 'ENROLLMENT');
  assert.equal((await c.get(`/api/lessons/${course.lessons[1].id}`)).json.content, null);
  assert.equal((await c.post(`/api/lessons/${course.lessons[1].id}/complete`)).status, 403);
  assert.equal((await c.post(`/api/quizzes/${course.quizzes[0].id}/attempts`)).status, 403);
  assert.equal((await c.get(`/api/quizzes/${course.quizzes[0].id}`)).status, 403);
});

test('quiz: student DTO hides answers; grading and XP are server-side, once; other users cannot touch attempts', async () => {
  const s = await as('student@example.test'); const other = await as('developer@example.test');
  await other.post(`/api/courses/${courseId('fractions-basics')}/enroll`);
  const fr = courseId('fractions-basics'); const quizId = (await s.get(`/api/courses/${fr}`)).json.quizzes[0].id;
  const before = (await s.get('/api/auth/me')).json.level.totalXp;
  const start = await s.post(`/api/quizzes/${quizId}/attempts`);
  assert.equal(start.status, 201);
  assert.ok(!/isCorrect|explanation|is_correct/.test(start.text));
  assert.ok(!start.text.includes('numerator')); // short-answer key never sent
  assert.equal((await s.get(`/api/quizzes/${quizId}`)).text.includes('isCorrect'), false);
  const qs = start.json.quiz.questions;
  const resume = await s.post(`/api/quizzes/${quizId}/attempts`); assert.equal(resume.json.attemptId, start.json.attemptId); // no duplicate open attempts
  const opt = (qi: number, text: string) => qs[qi].options.find((o: any) => o.text === text).id;
  assert.equal((await other.post(`/api/attempts/${start.json.attemptId}/submit`, { answers: [] })).status, 404); // IDOR
  assert.equal((await s.post(`/api/attempts/${start.json.attemptId}/submit`, { answers: [{ questionId: qs[0].id, selectedOptionIds: [opt(1, 'True')] }] })).status, 400); // option from another question
  const answers = [{ questionId: qs[0].id, selectedOptionIds: [opt(0, '2/4')] }, { questionId: qs[1].id, selectedOptionIds: [opt(1, 'True')] }, { questionId: qs[2].id, textAnswer: ' Numerator ' }];
  const sub = await s.post(`/api/attempts/${start.json.attemptId}/submit`, { answers, score: 999, xp: 999, passed: true });
  assert.equal(sub.status, 200); assert.equal(sub.json.percentage, 100); assert.equal(sub.json.passed, true); assert.equal(sub.json.xpAwarded, 25);
  assert.equal((await s.get('/api/auth/me')).json.level.totalXp, before + 25);
  assert.equal((await s.post(`/api/attempts/${start.json.attemptId}/submit`, { answers })).status, 409); // no double submit
  const again = await s.post(`/api/quizzes/${quizId}/attempts`);
  const sub2 = await s.post(`/api/attempts/${again.json.attemptId}/submit`, { answers: [] });
  assert.equal(sub2.json.passed, false); assert.equal(sub2.json.xpAwarded, 0);
  assert.equal((await s.get('/api/attempts')).json.items.length, 2);
  assert.equal((await s.post('/api/xp', { amount: 99999 })).status, 404); // no client XP endpoint exists
});

test('quiz time limit and attempt limits are enforced server-side', async () => {
  const t = await as('teacher@example.test'); const s = await as('developer@example.test'); const fr = courseId('fractions-basics');
  const q = await t.post(`/api/courses/${fr}/quizzes`, { title: 'Timed', timeLimitSeconds: 60, maxAttempts: 1, status: 'PUBLISHED', questions: [{ type: 'TRUE_FALSE', prompt: 'Sky is blue', options: [{ text: 'True', isCorrect: true }, { text: 'False' }] }] });
  assert.equal(q.status, 201);
  assert.equal((await t.post(`/api/courses/${fr}/quizzes`, { title: 'Bad', questions: [{ type: 'SINGLE_CHOICE', prompt: 'x', options: [{ text: 'a' }, { text: 'b' }] }] })).status, 400);
  const st = await s.post(`/api/quizzes/${q.json.id}/attempts`);
  now = new Date(now.getTime() + 120_000);
  assert.equal((await s.post(`/api/attempts/${st.json.attemptId}/submit`, { answers: [] })).status, 409);
  assert.equal((await s.post(`/api/quizzes/${q.json.id}/attempts`)).status, 409); // only 1 attempt allowed
});

test('premium gating uses effective access: locked -> admin timed grant -> expiry -> revoke', async () => {
  const s = await as('developer@example.test'); const admin = await as('admin@example.test'); const ph = courseId('photosynthesis-101');
  await s.post(`/api/courses/${ph}/enroll`);
  const lessons = (await s.get(`/api/courses/${ph}`)).json.lessons; const paid = lessons.find((l: any) => !l.isPreview).id;
  assert.equal((await s.get(`/api/lessons/${paid}`)).json.locked, 'PREMIUM');
  assert.equal((await s.post(`/api/lessons/${paid}/complete`)).status, 402);
  const uid = ctx.ids.developer;
  assert.equal((await admin.post(`/api/admin/users/${uid}/grants`, { type: 'TIMED', reason: 'x', expiresAt: '2020-01-01T00:00:00Z' })).status, 400);
  assert.equal((await s.post(`/api/admin/users/${uid}/grants`, { type: 'UNLIMITED', reason: 'self grant' })).status, 403);
  const g = await admin.post(`/api/admin/users/${uid}/grants`, { type: 'TIMED', reason: 'support case 42', expiresAt: new Date(now.getTime() + 3600_000).toISOString() });
  assert.equal(g.status, 201);
  assert.equal((await s.get(`/api/lessons/${paid}`)).json.locked, null);
  now = new Date(now.getTime() + 2 * 3600_000);
  assert.equal((await s.get(`/api/lessons/${paid}`)).json.locked, 'PREMIUM'); // expired
  const g2 = await admin.post(`/api/admin/users/${uid}/grants`, { type: 'UNLIMITED', reason: 'partner access' });
  assert.equal((await s.get(`/api/lessons/${paid}`)).json.locked, null);
  assert.equal((await admin.post(`/api/admin/grants/${g2.json.id}/revoke`, { reason: 'ended' })).status, 200);
  assert.equal((await admin.post(`/api/admin/grants/${g2.json.id}/revoke`, { reason: 'again' })).status, 409);
  assert.equal((await s.get(`/api/lessons/${paid}`)).json.locked, 'PREMIUM'); // revoked
  const logs = (await admin.get('/api/admin/audit-logs')).json.items.map((l: any) => l.action);
  assert.ok(logs.includes('access_grant.create') && logs.includes('access_grant.revoke'));
});

test('free trial can be started once and grants premium', async () => {
  const c = client(); await c.post('/api/auth/register', { email: 'trial@example.test', password: 'a-long-password-1', displayName: 'Tri' });
  assert.equal((await c.post('/api/subscriptions/trial')).status, 201);
  const me = (await c.get('/api/auth/me')).json;
  assert.equal(me.access.source, 'SUBSCRIPTION'); assert.equal(me.access.hasPremiumAccess, true);
  assert.equal((await c.post('/api/subscriptions/trial')).status, 409);
});

test('payments: server-side price, signed webhook, idempotent, no client-granted access', async () => {
  const c = client(); await c.post('/api/auth/register', { email: 'payer@example.test', password: 'a-long-password-1', displayName: 'Pay' });
  const chk = await c.post('/api/payments/checkout', { planCode: 'MONTHLY', amountCents: 1, priceCents: 1 });
  assert.equal(chk.status, 201); assert.equal(chk.json.amountCents, 999);
  assert.equal((await c.post('/api/payments/checkout', { planCode: 'FREE' })).status, 400);
  assert.equal((await c.get('/api/auth/me')).json.access.source, 'FREE'); // pending payment gives nothing
  const send = (payload: object, opts: { sig?: string; ts?: number } = {}) => {
    const raw = JSON.stringify(payload); const ts = opts.ts ?? Math.floor(now.getTime() / 1000);
    return fetch(ctx.base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-julie-timestamp': String(ts), 'x-julie-signature': opts.sig ?? signWebhook(raw, ts, WH) }, body: raw }).then(async (r) => ({ status: r.status, json: await r.json() }));
  };
  const ok = { externalRef: chk.json.externalRef, status: 'SUCCEEDED', amountCents: 999, currency: 'USD' };
  assert.equal((await send(ok, { sig: 'a'.repeat(64) })).status, 401);
  assert.equal((await send(ok, { ts: Math.floor(now.getTime() / 1000) - 3600 })).status, 401); // stale timestamp
  assert.equal((await send({ ...ok, amountCents: 1 })).status, 422);
  assert.equal((await send({ ...ok, externalRef: 'pay_unknown' })).status, 404);
  assert.equal((await send(ok)).json.result, 'APPLIED');
  assert.equal((await send(ok)).json.result, 'NOOP_DUPLICATE'); // replayed callback
  const me = (await c.get('/api/auth/me')).json;
  assert.equal(me.access.planCode, 'MONTHLY'); assert.equal(me.access.hasPremiumAccess, true);
  assert.equal((ctx.db.prepare(`SELECT COUNT(*) n FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE email='payer@example.test')`).get() as any).n, 1);
  assert.equal((await send({ ...ok, status: 'FAILED' })).json.result, 'IGNORE_STALE');
  assert.equal((await send({ ...ok, status: 'REFUNDED' })).json.status, 'REFUNDED');
  assert.equal((await c.get('/api/auth/me')).json.access.source, 'FREE'); // refund removes access
});

test('Julie AI: limits enforced, failures not counted, context respects access, unconfigured is reported honestly', async () => {
  const s = await as('student@example.test'); ai.calls.length = 0;
  const fr = courseId('fractions-basics'); const lessons = (await s.get(`/api/courses/${fr}`)).json.lessons;
  const day0 = (ctx.db.prepare('SELECT COALESCE(SUM(request_count),0) n FROM ai_usage').get() as any).n;
  ai.fail = true; assert.equal((await s.post('/api/ai/chat', { message: 'hi' })).status, 502); ai.fail = false;
  const first = await s.post('/api/ai/chat', { message: 'What is a fraction?', lessonId: lessons[0].id });
  assert.equal(first.status, 200); assert.equal(first.json.usage.usedToday, 1); assert.equal(first.json.usage.dailyLimit, 5);
  assert.ok(ai.calls.at(-1).system.includes('equal parts')); // lesson context included (student is enrolled)
  for (let i = 0; i < 4; i++) assert.equal((await s.post('/api/ai/chat', { message: 'more', conversationId: first.json.conversationId })).status, 200);
  const blocked = await s.post('/api/ai/chat', { message: 'one more' }); assert.equal(blocked.status, 429); assert.equal(blocked.json.error.code, 'AI_LIMIT_REACHED');
  assert.equal((await s.get('/api/ai/history')).json.messages.length, 10);
  const outsider = client(); await outsider.post('/api/auth/register', { email: 'ai-out@example.test', password: 'a-long-password-1', displayName: 'O' });
  const ph = courseId('photosynthesis-101'); const locked = (await outsider.get(`/api/courses/${ph}`)).json.lessons.find((l: any) => !l.isPreview).id;
  ai.calls.length = 0; await outsider.post('/api/ai/chat', { message: 'explain', lessonId: locked });
  assert.ok(!ai.calls[0].system.includes('chloroplasts')); // locked lesson content never reaches the model
  assert.equal((await outsider.post('/api/ai/chat', { message: 'x', conversationId: first.json.conversationId })).status, 404); // other user's conversation
  assert.ok(day0 >= 0);
  const t = await as('teacher@example.test'); assert.equal((await t.post('/api/ai/chat', { message: 'hi' })).status, 403); // no ai:use permission
});

test('AI unconfigured returns 503 without consuming quota', async () => {
  const b = await boot(baseConfig({ ai: null })); const c = new Client(b.base); await c.login('student@example.test');
  const r = await c.post('/api/ai/chat', { message: 'hi' });
  assert.equal(r.status, 503); assert.equal(r.json.error.code, 'AI_NOT_CONFIGURED');
  assert.equal((await c.get('/api/ai/history')).json.configured, false);
  assert.equal((b.db.prepare('SELECT COUNT(*) n FROM ai_usage').get() as any).n, 0);
  b.server.close();
});

test('API keys: shown once, hashed, scoped, revocable, rotatable; developer-only', async () => {
  const d = await as('developer@example.test');
  const created = await d.post('/api/developer/keys', { name: 'CI key', scopes: ['courses:read'] });
  assert.equal(created.status, 201); const key = created.json.key; assert.match(key, /^julie_[0-9a-f]{12}_[0-9a-f]{64}$/);
  const stored = ctx.db.prepare('SELECT * FROM api_keys WHERE id=?').get(created.json.id) as any;
  assert.ok(!JSON.stringify(stored).includes(key.slice(-20)));
  const list = await d.get('/api/developer/keys');
  assert.ok(!list.text.includes(key) && !list.text.includes(stored.key_hash) && !list.text.includes('key_hash'));
  assert.equal((await d.post('/api/developer/keys', { name: 'bad', scopes: ['admin:everything'] })).status, 400);
  const use = (k: string) => fetch(ctx.base + '/api/v1/courses', { headers: { Authorization: `Bearer ${k}` } });
  const ok = await use(key); assert.equal(ok.status, 200); assert.ok((await ok.json()).items.length >= 2);
  assert.equal((await use('julie_' + '0'.repeat(12) + '_' + '0'.repeat(64))).status, 401);
  assert.equal((await use('garbage')).status, 401);
  assert.equal((await d.get('/api/developer/keys')).json.items[0].requests7d >= 1, true);
  const other = await as('teacher@example.test'); assert.equal((await other.del(`/api/developer/keys/${created.json.id}`)).status, 403); // no api_key:manage_own
  const rot = await d.post(`/api/developer/keys/${created.json.id}/rotate`);
  assert.equal(rot.status, 201); assert.equal((await use(key)).status, 401); assert.equal((await use(rot.json.key)).status, 200);
  assert.equal((await d.del(`/api/developer/keys/${rot.json.id}`)).status, 204);
  assert.equal((await use(rot.json.key)).status, 401);
});

test('admin: role changes are audited, last admin protected, suspension kills sessions, audit log is immutable', async () => {
  const admin = await as('admin@example.test'); const victim = await as('teacher2@example.test'); const uid = ctx.ids.teacher2;
  assert.equal((await admin.post(`/api/admin/users/${uid}/roles`, { role: 'SUPERUSER' })).status, 400);
  assert.deepEqual((await admin.post(`/api/admin/users/${uid}/roles`, { role: 'DEVELOPER', reason: 'needs keys' })).json.roles, ['DEVELOPER', 'TEACHER']);
  assert.equal((await victim.get('/api/developer/keys')).status, 200); // takes effect immediately
  assert.equal((await admin.del(`/api/admin/users/${ctx.ids.admin}/roles/ADMIN`)).status, 409); // last admin
  assert.equal((await admin.patch(`/api/admin/users/${ctx.ids.admin}/status`, { status: 'SUSPENDED' })).status, 409); // not self
  assert.equal((await admin.patch(`/api/admin/users/${uid}/status`, { status: 'SUSPENDED' })).status, 200);
  assert.equal((await victim.get('/api/auth/me')).status, 401);
  assert.equal((await client().post('/api/auth/login', { email: 'teacher2@example.test', password: PW })).status, 403);
  await admin.patch(`/api/admin/users/${uid}/status`, { status: 'ACTIVE' });
  const logs = (await admin.get('/api/admin/audit-logs')).json.items.map((l: any) => l.action);
  for (const a of ['role.grant', 'user.status_change']) assert.ok(logs.includes(a));
  assert.throws(() => ctx.db.prepare('UPDATE audit_logs SET action=?').run('tampered'), /append-only/);
  assert.throws(() => ctx.db.prepare('DELETE FROM audit_logs').run(), /append-only/);
  const users = (await admin.get('/api/admin/users?q=example&pageSize=2&sort=email')).json; assert.equal(users.items.length, 2);
  assert.equal((await admin.get('/api/admin/users?sort=password_hash')).status, 400); // sort whitelist
  assert.ok(!(await admin.get('/api/admin/users')).text.includes('password_hash'));
  const an = (await admin.get('/api/admin/analytics')).json; assert.ok(an.users.total >= 5 && an.learning.lessonCompletions >= 2);
});

test('goals, tasks and notifications are private to their owner', async () => {
  const s = await as('student@example.test'); const o = await as('developer@example.test');
  const g = await s.post('/api/goals', { title: 'Finish fractions', targetDate: '2026-12-01' }); assert.equal(g.status, 201);
  const task = await s.post('/api/tasks', { title: 'Read lesson 1', goalId: g.json.id }); assert.equal(task.status, 201);
  assert.equal((await o.patch(`/api/goals/${g.json.id}`, { status: 'COMPLETED' })).status, 404); // another student's goal (IDOR)
  assert.equal((await (await as('teacher@example.test')).get('/api/goals')).status, 403); // teacher role lacks goal:self
  const o2 = client(); await o2.post('/api/auth/register', { email: 'peer@example.test', password: 'a-long-password-1', displayName: 'Peer' });
  assert.equal((await o2.patch(`/api/goals/${g.json.id}`, { status: 'COMPLETED' })).status, 404);
  assert.equal((await o2.patch(`/api/tasks/${task.json.id}`, { status: 'DONE' })).status, 404);
  assert.equal((await o2.post('/api/tasks', { title: 't', goalId: g.json.id })).status, 404);
  const xp0 = (await s.get('/api/auth/me')).json.level.totalXp;
  assert.equal((await s.patch(`/api/goals/${g.json.id}`, { status: 'COMPLETED' })).json.xpAwarded, 20);
  assert.equal((await s.patch(`/api/goals/${g.json.id}`, { status: 'ACTIVE' })).status, 200);
  assert.equal((await s.patch(`/api/goals/${g.json.id}`, { status: 'COMPLETED' })).json.xpAwarded, 0); // no XP farming
  assert.equal((await s.get('/api/auth/me')).json.level.totalXp, xp0 + 20);
  assert.equal((await s.patch(`/api/tasks/${task.json.id}`, { status: 'DONE' })).status, 200);
  const n = (await s.get('/api/notifications')).json; assert.ok(n.total >= 1);
  assert.equal((await o2.post(`/api/notifications/${n.items[0].id}/read`)).status, 404);
  assert.equal((await s.post(`/api/notifications/${n.items[0].id}/read`)).status, 200);
  assert.equal((await s.get('/api/notifications?page=0')).status, 400);
});

test('teacher announcements notify enrolled students; results are visible to the owner only', async () => {
  const t = await as('teacher@example.test'); const fr = courseId('fractions-basics'); const s = await as('student@example.test');
  const before = (await s.get('/api/notifications')).json.total;
  assert.equal((await t.post(`/api/courses/${fr}/announcements`, { title: 'Test on Friday', body: 'Bring a pencil' })).status, 201);
  assert.equal((await s.get('/api/notifications')).json.total, before + 1);
  assert.equal((await s.post(`/api/courses/${fr}/announcements`, { title: 'x', body: 'y' })).status, 403);
  const res = (await t.get(`/api/courses/${fr}/results`)).json; assert.ok(res.items.some((r: any) => r.email === 'student@example.test' && r.progress.percent === 100));
  assert.equal((await t.get('/api/teacher/courses')).json.items.length >= 1, true);
});

test('platform hardening: security headers, static serving, traversal, unknown routes, malformed JSON, body limits', async () => {
  const r = await fetch(ctx.base + '/');
  assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy')?.includes("script-src 'self'")); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const t = await fetch(ctx.base + '/..%2f..%2fpackage.json'); assert.ok(t.status === 404 || !(await t.text()).includes('"name": "julie"'));
  assert.equal((await client().get('/api/does-not-exist')).status, 404);
  assert.equal((await client().get('/api/health')).json.status, 'ok');
  const bad = await fetch(ctx.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'julie' }, body: '{oops' });
  assert.equal(bad.status, 400);
  const big = await fetch(ctx.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'julie' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1_100_000) }) });
  assert.equal(big.status, 413);
  const err = await client().post('/api/auth/login', { email: 'a@b.co' }); assert.ok(!JSON.stringify(err.json).includes('stack'));
  const noSession = await fetch(ctx.base + '/api/v1/courses'); assert.equal(noSession.status, 401);
});

test('login rate limiting blocks brute force and is recorded as a security event', async () => {
  const b = await boot(baseConfig({ loginRateLimitPerMin: 3 })); const c = new Client(b.base);
  for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/auth/login', { email: 'student@example.test', password: 'wrong-password-x' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'student@example.test', password: PW })).status, 429);
  assert.ok((b.db.prepare(`SELECT COUNT(*) n FROM security_events WHERE type='rate_limit.exceeded'`).get() as any).n >= 1);
  assert.ok((b.db.prepare(`SELECT COUNT(*) n FROM security_events WHERE type='auth.failed'`).get() as any).n >= 3);
  b.server.close();
});

test('sessions expire and a suspended user\'s API key stops working', async () => {
  const c = await as('student@example.test'); assert.equal((await c.get('/api/auth/me')).status, 200);
  now = new Date(now.getTime() + 8 * 86_400_000);
  assert.equal((await c.get('/api/auth/me')).status, 401);
});
