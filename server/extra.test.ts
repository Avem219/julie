import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import { openDb, type DB } from './db.ts';
import { createApp } from './app.ts';
import { seedDev } from './seed.ts';
import type { Config } from './config.ts';

const PW = 'sample-password-1234';
let now = new Date('2026-09-19T12:00:00Z');
const storageDir = './data/test-uploads';
const cfg: Config = { nodeEnv: 'test', port: 0, dbPath: ':memory:', secureCookies: false, trustProxy: false, apiKeyPepper: 'test-pepper-1234567890', paymentWebhookSecret: null, ai: null, loginRateLimitPerMin: 1000, apiRateLimitPerMin: 100000, quiet: true, storageDir };

let db: DB, ids: Record<string, string>, server: Server, base: string;
before(async () => {
  db = openDb(':memory:'); ids = seedDev(db, PW, now);
  const app = createApp({ db, config: cfg, clock: () => now });
  server = createServer((req, res) => void app.handler(req, res));
  await new Promise<void>((r) => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.close(); await rm(storageDir, { recursive: true, force: true }); });

class Client {
  cookie = ''; base: string;
  constructor(b: string) { this.base = b; }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'X-Requested-With': 'julie', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('json')) { const t = await res.text(); return { status: res.status, headers: res.headers, json: t ? JSON.parse(t) : null }; }
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  }
  get = (p: string) => this.req('GET', p); post = (p: string, b: unknown = {}) => this.req('POST', p, b);
  patch = (p: string, b: unknown) => this.req('PATCH', p, b); del = (p: string) => this.req('DELETE', p);
  async login(email: string) { const r = await this.post('/api/auth/login', { email, password: PW }); assert.equal(r.status, 200); return r.json; }
}
const client = () => new Client(base);
const as = async (email: string) => { const c = client(); await c.login(email); return c; };
const courseId = (slug: string) => (db.prepare('SELECT id FROM courses WHERE slug=?').get(slug) as any).id as string;

test('subjects: public read, admin-only write, unique slug', async () => {
  const s = await as('student@example.test');
  const list = await s.get('/api/subjects'); assert.equal(list.status, 200); assert.ok(list.json.items.some((x: any) => x.name === 'Mathematics'));
  assert.equal((await s.post('/api/subjects', { name: 'Art' })).status, 403);
  const admin = await as('admin@example.test');
  const created = await admin.post('/api/subjects', { name: 'Art', description: 'Drawing and painting' }); assert.equal(created.status, 201);
  assert.equal((await admin.post('/api/subjects', { name: 'Art' })).status, 409);
  assert.equal((await admin.patch(`/api/subjects/${created.json.id}`, { isActive: false })).status, 200);
  const list2 = await s.get('/api/subjects'); assert.ok(!list2.json.items.some((x: any) => x.name === 'Art'));
});

test('news: only published visible publicly; admin can draft, publish, and edit', async () => {
  const pub = await fetch(base + '/api/news'); assert.equal(pub.status, 200);
  const pubJson = await pub.json(); assert.ok(pubJson.items.some((x: any) => x.slug === 'welcome-to-julie'));
  assert.ok(!pubJson.items.some((x: any) => x.status === 'DRAFT'));
  const s = await as('student@example.test'); assert.equal((await s.get('/api/admin/news')).status, 403);
  const admin = await as('admin@example.test');
  const created = await admin.post('/api/admin/news', { title: 'Draft article', body: 'not yet public' }); assert.equal(created.status, 201);
  let pub2 = await (await fetch(base + '/api/news')).json(); assert.ok(!pub2.items.some((x: any) => x.id === created.json.id));
  assert.equal((await admin.patch(`/api/admin/news/${created.json.id}`, { status: 'PUBLISHED' })).status, 200);
  pub2 = await (await fetch(base + '/api/news')).json(); assert.ok(pub2.items.some((x: any) => x.id === created.json.id));
});

test('timetable: private to owner, validated times, deletable', async () => {
  const s = await as('student@example.test'); const other = await as('developer@example.test');
  const fr = courseId('fractions-basics');
  assert.equal((await s.post('/api/timetable', { dayOfWeek: 1, startMinute: 540, endMinute: 500, title: 'Math' })).status, 400);
  const e = await s.post('/api/timetable', { dayOfWeek: 1, startMinute: 540, endMinute: 600, title: 'Math class', courseId: fr }); assert.equal(e.status, 201);
  const mine = await s.get('/api/timetable'); assert.equal(mine.json.items.length, 1); assert.equal(mine.json.items[0].courseTitle, 'Fractions Basics');
  const theirs = await other.get('/api/timetable'); assert.equal(theirs.json.items.length, 0);
  assert.equal((await other.del(`/api/timetable/${e.json.id}`)).status, 404);
  assert.equal((await s.del(`/api/timetable/${e.json.id}`)).status, 204);
  assert.equal((await s.get('/api/timetable')).json.items.length, 0);
});

test('feature flags: developer reads, only admin manages, invalid key rejected', async () => {
  const dev = await as('developer@example.test');
  const list = await dev.get('/api/feature-flags'); assert.equal(list.status, 200); assert.ok(list.json.items.some((f: any) => f.key === 'new-dashboard-widgets'));
  assert.equal((await dev.get('/api/admin/feature-flags')).status, 403);
  const admin = await as('admin@example.test');
  assert.equal((await admin.post('/api/admin/feature-flags', { key: 'Bad Key!' })).status, 400);
  const created = await admin.post('/api/admin/feature-flags', { key: 'quiz_hints', enabled: false });
  assert.equal(created.status, 201);
  assert.equal((await admin.patch('/api/admin/feature-flags/quiz_hints', { enabled: true, rolloutPercent: 50 })).status, 200);
  const list2 = await dev.get('/api/feature-flags'); assert.ok(list2.json.items.find((f: any) => f.key === 'quiz_hints').enabled);
});

test('notification preferences: default enabled, per-category toggle persists', async () => {
  const s = await as('student@example.test');
  const p0 = await s.get('/api/notification-preferences'); assert.equal(p0.json.items.find((x: any) => x.category === 'QUIZ').enabled, true);
  assert.equal((await s.patch('/api/notification-preferences/QUIZ', { enabled: false })).status, 200);
  assert.equal((await s.patch('/api/notification-preferences/NOT_REAL', { enabled: false })).status, 400);
  const p1 = await s.get('/api/notification-preferences'); assert.equal(p1.json.items.find((x: any) => x.category === 'QUIZ').enabled, false);
  assert.equal(p1.json.items.find((x: any) => x.category === 'GOAL').enabled, true);
});

test('admin plans: full list including inactive, students cannot access', async () => {
  const s = await as('student@example.test'); assert.equal((await s.get('/api/admin/plans')).status, 403);
  const admin = await as('admin@example.test');
  const all = await admin.get('/api/admin/plans'); assert.equal(all.status, 200);
  assert.ok(all.json.items.some((p: any) => p.code === 'MONTHLY'));
  assert.equal((await s.get('/api/subscriptions/plans')).status, 200); // public/self plan list still open to any signed-in user
});

test('file resources: teacher uploads (validated), students in course download, others cannot; link resources; ownership enforced', async () => {
  const t = await as('teacher@example.test'); const s = await as('student@example.test'); const outsider = await as('developer@example.test');
  const fr = courseId('fractions-basics');
  const pdfB64 = Buffer.from('%PDF-1.7\n%mock pdf content for test\n').toString('base64');
  const bad = await t.post(`/api/courses/${fr}/resources`, { type: 'FILE', title: 'Worksheet', filename: 'worksheet.exe', mime: 'application/pdf', data: pdfB64 });
  assert.equal(bad.status, 400); // extension mismatch
  const up = await t.post(`/api/courses/${fr}/resources`, { type: 'FILE', title: 'Worksheet', filename: 'worksheet.pdf', mime: 'application/pdf', data: pdfB64 });
  assert.equal(up.status, 201);
  assert.equal((await outsider.post(`/api/courses/${fr}/resources`, { type: 'FILE', title: 'x', filename: 'a.pdf', mime: 'application/pdf', data: pdfB64 })).status, 403);
  assert.equal((await outsider.get(`/api/resources/${up.json.id}/download`)).status, 404); // not enrolled
  await s.post(`/api/courses/${fr}/enroll`);
  const dl = await s.get(`/api/resources/${up.json.id}/download`); assert.equal(dl.status, 200); assert.ok(dl.buf!.toString('utf8').startsWith('%PDF-'));
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  const link = await t.post(`/api/courses/${fr}/resources`, { type: 'LINK', title: 'External reading', url: 'http://insecure.example' });
  assert.equal(link.status, 400); // https only
  const link2 = await t.post(`/api/courses/${fr}/resources`, { type: 'LINK', title: 'External reading', url: 'https://example.test/reading' });
  assert.equal(link2.status, 201);
  assert.equal((await outsider.get(`/api/courses/${fr}/resources`)).status, 404); // not enrolled, invisible
  const listing = await s.get(`/api/courses/${fr}/resources`); assert.equal(listing.status, 200); assert.equal(listing.json.items.length, 2);
  assert.equal((await outsider.del(`/api/resources/${up.json.id}`)).status, 403);
  assert.equal((await t.del(`/api/resources/${up.json.id}`)).status, 204);
  assert.equal((await s.get(`/api/resources/${up.json.id}/download`)).status, 404);
});

test('short-answer review: teacher can see and override; overriding recalculates score and pass', async () => {
  const t = await as('teacher@example.test'); const s = await as('student@example.test');
  const fr = courseId('fractions-basics'); const course = (await s.get(`/api/courses/${fr}`)).json;
  const quizId = course.quizzes[0].id;
  const start = await s.post(`/api/quizzes/${quizId}/attempts`); const qs = start.json.quiz.questions;
  const shortQ = qs[2];
  const answers = [{ questionId: qs[0].id, selectedOptionIds: [] }, { questionId: qs[1].id, selectedOptionIds: [] }, { questionId: shortQ.id, textAnswer: 'top number' }]; // wrong wording, marked incorrect
  const sub = await s.post(`/api/attempts/${start.json.attemptId}/submit`, { answers });
  assert.equal(sub.status, 200); assert.ok(sub.json.percentage < 100);
  const review = await t.get(`/api/quizzes/${quizId}/short-answers`); assert.equal(review.status, 200);
  const row = review.json.items.find((r: any) => r.attemptId === start.json.attemptId); assert.ok(row); assert.equal(row.autoCorrect, false);
  const otherTeacher = await as('teacher2@example.test'); assert.equal((await otherTeacher.get(`/api/quizzes/${quizId}/short-answers`)).status, 403);
  const before = (await s.get('/api/attempts')).json.items.find((a: any) => a.id === start.json.attemptId).percentage;
  const ov = await t.post(`/api/attempts/${start.json.attemptId}/answers/${shortQ.id}/override`, { isCorrect: true }); assert.equal(ov.status, 200);
  const after = (await s.get('/api/attempts')).json.items.find((a: any) => a.id === start.json.attemptId).percentage;
  assert.ok(after > before);
});
