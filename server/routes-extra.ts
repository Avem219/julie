import { readFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Add, Env, Ctx } from './app.ts';
import { tx } from './db.ts';
import { obj, reqStr, optStr, optInt, optBool, oneOf, optOneOf, reqInt, newId, slugify, type Row } from './util.ts';
import { AppError, badRequest, conflict, forbidden, notFound } from '../src/lib/errors.ts';
import { parsePagination } from '../src/lib/http/http.ts';
import { audit, canManageCourse, getCourse, requireManage, trackEvent } from './services.ts';
import { validateUpload, generateStorageKey, sanitizeFilename, ALLOWED_UPLOADS } from '../src/lib/storage/upload-validation.ts';
import { hasPermission } from '../src/lib/rbac/rbac.ts';

const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
const NOTIF_CATS = ['SYSTEM', 'ANNOUNCEMENT', 'COURSE', 'QUIZ', 'GOAL', 'SUBSCRIPTION', 'SECURITY', 'AI'] as const;

export function extraRoutes(e: Env, add: Add) {
  const { db, config } = e;
  const uidOf = (c: Ctx) => c.auth!.user.id;
  const iso = (d: Date) => d.toISOString();

  // ── Subjects ──
  add('GET', '/api/subjects', { perm: 'course:read' }, () => ({ body: { items: (db.prepare('SELECT * FROM subjects WHERE is_active=1 ORDER BY name').all() as Row[]).map((s) => ({ id: s.id, slug: s.slug, name: s.name, description: s.description })) } }));
  add('POST', '/api/subjects', { perm: 'subject:manage' }, (c) => {
    const b = obj(c.body); const name = reqStr(b, 'name', 1, 100); const id = newId();
    const slug = slugify(name);
    if (db.prepare('SELECT 1 FROM subjects WHERE slug=?').get(slug)) throw conflict('A subject with this name already exists');
    db.prepare('INSERT INTO subjects(id,slug,name,description,created_at) VALUES(?,?,?,?,?)').run(id, slug, name, optStr(b, 'description', 500) ?? null, c.now.toISOString());
    audit(db, uidOf(c), 'subject.create', 'subject', id, { name }, c, c.now);
    return { status: 201, body: { id, slug } };
  });
  add('PATCH', '/api/subjects/:id', { perm: 'subject:manage' }, (c) => {
    const s = db.prepare('SELECT * FROM subjects WHERE id=?').get(c.params.id) as Row | undefined; if (!s) throw notFound('Subject not found');
    const b = obj(c.body); const active = optBool(b, 'isActive');
    db.prepare('UPDATE subjects SET name=?,description=?,is_active=? WHERE id=?').run(optStr(b, 'name', 100)?.trim() || s.name, optStr(b, 'description', 500) ?? s.description, active === undefined ? s.is_active : active ? 1 : 0, s.id);
    audit(db, uidOf(c), 'subject.update', 'subject', s.id, {}, c, c.now);
    return { body: { ok: true } };
  });

  // ── News ──
  const newsDto = (n: Row) => ({ id: n.id, slug: n.slug, title: n.title, summary: n.summary, body: n.body, status: n.status, category: n.category_slug ?? null, publishedAt: n.published_at, createdAt: n.created_at });
  add('GET', '/api/news', { auth: 'none' }, (c) => {
    const p = parsePagination(c.query, { sortable: ['published_at', 'created_at'], defaultSort: 'published_at', maxPageSize: 50 });
    const total = (db.prepare(`SELECT COUNT(*) n FROM news_articles WHERE status='PUBLISHED'`).get() as Row).n;
    const [f, dir] = Object.entries(p.orderBy)[0];
    const rows = db.prepare(`SELECT a.*, cat.slug category_slug FROM news_articles a LEFT JOIN news_categories cat ON cat.id=a.category_id WHERE a.status='PUBLISHED' ORDER BY a.${f} ${dir === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(p.take, p.skip) as Row[];
    return { body: { total, page: p.page, pageSize: p.pageSize, items: rows.map(newsDto) } };
  });
  add('GET', '/api/admin/news', { perm: 'news:manage' }, (c) => {
    const rows = db.prepare(`SELECT a.*, cat.slug category_slug FROM news_articles a LEFT JOIN news_categories cat ON cat.id=a.category_id ORDER BY a.created_at DESC LIMIT 100`).all() as Row[];
    return { body: { items: rows.map(newsDto) } };
  });
  add('POST', '/api/admin/news', { perm: 'news:manage' }, (c) => {
    const b = obj(c.body); const id = newId(); const title = reqStr(b, 'title', 1, 160);
    const catSlug = optStr(b, 'category', 60);
    const cat = catSlug ? (db.prepare('SELECT id FROM news_categories WHERE slug=?').get(catSlug) as Row | undefined) : undefined;
    if (catSlug && !cat) throw badRequest('Unknown category');
    db.prepare('INSERT INTO news_articles(id,category_id,author_id,slug,title,summary,body,status,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, cat?.id ?? null, uidOf(c), `${slugify(title)}-${id.slice(0, 6)}`, title, optStr(b, 'summary', 300) ?? null, reqStr(b, 'body', 1, 20_000), optOneOf(b, 'status', STATUSES) ?? 'DRAFT', optOneOf(b, 'status', STATUSES) === 'PUBLISHED' ? c.now.toISOString() : null, c.now.toISOString(), c.now.toISOString());
    audit(db, uidOf(c), 'news.create', 'news_article', id, { title }, c, c.now);
    return { status: 201, body: { id } };
  });
  add('PATCH', '/api/admin/news/:id', { perm: 'news:manage' }, (c) => {
    const n = db.prepare('SELECT * FROM news_articles WHERE id=?').get(c.params.id) as Row | undefined; if (!n) throw notFound('Article not found');
    const b = obj(c.body); const status = optOneOf(b, 'status', STATUSES);
    db.prepare('UPDATE news_articles SET title=?,summary=?,body=?,status=?,published_at=?,updated_at=? WHERE id=?')
      .run(optStr(b, 'title', 160)?.trim() || n.title, optStr(b, 'summary', 300) ?? n.summary, optStr(b, 'body', 20_000) ?? n.body, status ?? n.status, status === 'PUBLISHED' && n.status !== 'PUBLISHED' ? c.now.toISOString() : n.published_at, c.now.toISOString(), n.id);
    audit(db, uidOf(c), 'news.update', 'news_article', n.id, { status }, c, c.now);
    return { body: { ok: true } };
  });

  // ── Timetable ──
  function myTimetable(uid: string, now: Date): string {
    const t = db.prepare(`SELECT id FROM timetables WHERE user_id=? AND is_active=1 ORDER BY created_at LIMIT 1`).get(uid) as Row | undefined;
    if (t) return t.id;
    const id = newId(); db.prepare('INSERT INTO timetables(id,user_id,name,created_at) VALUES(?,?,?,?)').run(id, uid, 'My timetable', now.toISOString()); return id;
  }
  add('GET', '/api/timetable', { perm: 'timetable:self' }, (c) => {
    const tid = myTimetable(uidOf(c), c.now);
    const rows = db.prepare(`SELECT e.*, co.title course_title FROM timetable_entries e LEFT JOIN courses co ON co.id=e.course_id WHERE e.timetable_id=? ORDER BY e.day_of_week, e.start_minute`).all(tid) as Row[];
    return { body: { items: rows.map((r) => ({ id: r.id, courseId: r.course_id, courseTitle: r.course_title, dayOfWeek: r.day_of_week, startMinute: r.start_minute, endMinute: r.end_minute, title: r.title, location: r.location, notes: r.notes })) } };
  });
  add('POST', '/api/timetable', { perm: 'timetable:self' }, (c) => {
    const b = obj(c.body); const tid = myTimetable(uidOf(c), c.now); const id = newId();
    const start = reqInt(b, 'startMinute', 0, 1439); const end = reqInt(b, 'endMinute', 1, 1440);
    if (end <= start) throw badRequest('endMinute must be after startMinute');
    const courseId = optStr(b, 'courseId', 64);
    if (courseId && !db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId)) throw badRequest('Unknown courseId');
    db.prepare('INSERT INTO timetable_entries(id,timetable_id,course_id,day_of_week,start_minute,end_minute,title,location,notes) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, tid, courseId ?? null, reqInt(b, 'dayOfWeek', 0, 6), start, end, reqStr(b, 'title', 1, 120), optStr(b, 'location', 120) ?? null, optStr(b, 'notes', 500) ?? null);
    return { status: 201, body: { id } };
  });
  add('DELETE', '/api/timetable/:id', { perm: 'timetable:self' }, (c) => {
    const tid = myTimetable(uidOf(c), c.now);
    const r = db.prepare('DELETE FROM timetable_entries WHERE id=? AND timetable_id=?').run(c.params.id, tid);
    if (r.changes === 0) throw notFound('Entry not found');
    return { status: 204 };
  });

  // ── Feature flags ──
  add('GET', '/api/feature-flags', { perm: 'feature_flag:read' }, () => ({ body: { items: (db.prepare('SELECT * FROM feature_flags ORDER BY key').all() as Row[]).map((f) => ({ key: f.key, description: f.description, enabled: !!f.enabled, rolloutPercent: f.rollout_percent })) } } as any));
  add('GET', '/api/admin/feature-flags', { perm: 'feature_flag:manage' }, () => ({ body: { items: db.prepare('SELECT * FROM feature_flags ORDER BY key').all() as Row[] } }));
  add('POST', '/api/admin/feature-flags', { perm: 'feature_flag:manage' }, (c) => {
    const b = obj(c.body); const key = reqStr(b, 'key', 2, 60);
    if (!/^[a-z0-9_.-]+$/.test(key)) throw badRequest('key may contain only lowercase letters, digits, _ . -');
    if (db.prepare('SELECT 1 FROM feature_flags WHERE key=?').get(key)) throw conflict('Flag already exists');
    const id = newId();
    db.prepare('INSERT INTO feature_flags(id,key,description,enabled,rollout_percent,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(id, key, optStr(b, 'description', 300) ?? null, optBool(b, 'enabled') ? 1 : 0, optInt(b, 'rolloutPercent', 0, 100) ?? 0, uidOf(c), c.now.toISOString());
    audit(db, uidOf(c), 'feature_flag.create', 'feature_flag', id, { key }, c, c.now);
    return { status: 201, body: { id } };
  });
  add('PATCH', '/api/admin/feature-flags/:key', { perm: 'feature_flag:manage' }, (c) => {
    const f = db.prepare('SELECT * FROM feature_flags WHERE key=?').get(c.params.key) as Row | undefined; if (!f) throw notFound('Flag not found');
    const b = obj(c.body); const enabled = optBool(b, 'enabled'); const pct = optInt(b, 'rolloutPercent', 0, 100);
    db.prepare('UPDATE feature_flags SET enabled=?,rollout_percent=?,updated_by=?,updated_at=? WHERE key=?').run(enabled === undefined ? f.enabled : enabled ? 1 : 0, pct ?? f.rollout_percent, uidOf(c), c.now.toISOString(), f.key);
    audit(db, uidOf(c), 'feature_flag.update', 'feature_flag', f.key, { enabled, rolloutPercent: pct }, c, c.now);
    return { body: { ok: true } };
  });

  // ── Notification preferences ──
  add('GET', '/api/notification-preferences', { perm: 'notification:self' }, (c) => {
    const rows = new Map((db.prepare('SELECT category,enabled FROM notification_preferences WHERE user_id=?').all(uidOf(c)) as Row[]).map((r) => [r.category, !!r.enabled]));
    return { body: { items: NOTIF_CATS.map((cat) => ({ category: cat, enabled: rows.has(cat) ? rows.get(cat) : true })) } };
  });
  add('PATCH', '/api/notification-preferences/:category', { perm: 'notification:self' }, (c) => {
    const cat = oneOf({ c: c.params.category }, 'c', NOTIF_CATS); const enabled = !!obj(c.body).enabled;
    db.prepare(`INSERT INTO notification_preferences(user_id,category,enabled) VALUES(?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET enabled=excluded.enabled`).run(uidOf(c), cat, enabled ? 1 : 0);
    return { body: { ok: true } };
  });

  // ── File uploads (local disk storage adapter) ──
  const uploadDir = resolve(config.storageDir);
  const diskPath = (key: string) => resolve(uploadDir, key.replace(/^uploads\//, ''));

  add('GET', '/api/courses/:id/resources', {}, (c) => {
    const course = getCourse(db, c.params.id);
    const manage = canManageCourse(db, c.auth!.principal, course.id, 'resource:manage_own');
    const enrolled = !!db.prepare(`SELECT 1 FROM enrollments WHERE user_id=? AND course_id=? AND status<>'DROPPED'`).get(uidOf(c), course.id);
    if (!manage && !(enrolled && course.status === 'PUBLISHED')) throw notFound('Course not found');
    const rows = db.prepare('SELECT r.*, f.original_name, f.size_bytes, f.mime_type FROM resources r LEFT JOIN file_assets f ON f.id=r.file_asset_id WHERE r.course_id=? ORDER BY r.created_at DESC').all(course.id) as Row[];
    return { body: { items: rows.map((r) => ({ id: r.id, lessonId: r.lesson_id, type: r.type, title: r.title, description: r.description, url: r.url, fileName: r.original_name, sizeBytes: r.size_bytes, mimeType: r.mime_type })) } };
  });
  add('POST', '/api/courses/:id/resources', { bodyLimit: 30_000_000 }, async (c) => {
    const course = requireManage(db, c.auth!.principal, c.params.id, 'resource:manage_own');
    const b = obj(c.body);
    const type = oneOf(b, 'type', ['FILE', 'LINK'] as const);
    const id = newId(); const lessonId = optStr(b, 'lessonId', 64) || null;
    if (lessonId && !db.prepare('SELECT 1 FROM lessons WHERE id=? AND course_id=?').get(lessonId, course.id)) throw badRequest('lessonId does not belong to this course');
    if (type === 'LINK') {
      const url = reqStr(b, 'url', 8, 2000);
      if (!/^https:\/\//.test(url)) throw badRequest('url must start with https://');
      db.prepare('INSERT INTO resources(id,course_id,lesson_id,created_by,type,title,description,url,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, course.id, lessonId, uidOf(c), 'LINK', reqStr(b, 'title', 1, 160), optStr(b, 'description', 500) ?? null, url, c.now.toISOString());
      return { status: 201, body: { id } };
    }
    // FILE: base64-encoded upload in the JSON body (this server has no multipart parser; kept simple and dependency-free)
    const filename = reqStr(b, 'filename', 1, 200); const declaredMime = reqStr(b, 'mime', 3, 100);
    const dataB64 = reqStr(b, 'data', 1, 29_000_000);
    let bytes: Buffer; try { bytes = Buffer.from(dataB64, 'base64'); } catch { throw badRequest('data must be base64-encoded'); }
    if (bytes.length === 0) throw badRequest('Empty file');
    const check = validateUpload({ filename, declaredMime, sizeBytes: bytes.length, head: bytes.subarray(0, 16) });
    if (!check.ok) throw badRequest(check.reason);
    const key = generateStorageKey(check.ext, c.now);
    const fs = await import('node:fs/promises');
    await fs.mkdir(resolve(diskPath(key), '..'), { recursive: true });
    await fs.writeFile(diskPath(key), bytes, { mode: 0o600 });
    const fileId = newId();
    tx(db, () => {
      db.prepare('INSERT INTO file_assets(id,uploaded_by,storage_key,original_name,mime_type,size_bytes,visibility,course_id,lesson_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(fileId, uidOf(c), key, check.displayName, check.mime, bytes.length, 'COURSE', course.id, lessonId, c.now.toISOString());
      db.prepare('INSERT INTO resources(id,course_id,lesson_id,file_asset_id,created_by,type,title,description,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id, course.id, lessonId, fileId, uidOf(c), 'FILE', reqStr(b, 'title', 1, 160) || check.displayName, optStr(b, 'description', 500) ?? null, c.now.toISOString());
    });
    audit(db, uidOf(c), 'resource.upload', 'resource', id, { fileId, mime: check.mime, sizeBytes: bytes.length }, c, c.now);
    return { status: 201, body: { id, fileId } };
  });

  add('GET', '/api/resources/:id/download', {}, async (c) => {
    const r = db.prepare('SELECT * FROM resources WHERE id=?').get(c.params.id) as Row | undefined; if (!r || r.type !== 'FILE') throw notFound('Resource not found');
    const course = getCourse(db, r.course_id);
    const manage = canManageCourse(db, c.auth!.principal, course.id, 'resource:manage_own');
    const enrolled = !!db.prepare(`SELECT 1 FROM enrollments WHERE user_id=? AND course_id=? AND status<>'DROPPED'`).get(uidOf(c), course.id);
    if (!manage && !(enrolled && course.status === 'PUBLISHED')) throw notFound('Resource not found');
    const f = db.prepare('SELECT * FROM file_assets WHERE id=? AND deleted_at IS NULL').get(r.file_asset_id) as Row | undefined; if (!f) throw notFound('File not found');
    let data: Buffer; try { data = await readFile(diskPath(f.storage_key)); } catch { throw notFound('File not found'); }
    trackEvent(db, uidOf(c), 'resource_downloaded', { resourceId: r.id }, c.now);
    return { status: 200, body: data as any, headers: { 'Content-Type': f.mime_type, 'Content-Disposition': `attachment; filename="${f.original_name.replace(/"/g, '')}"`, 'Content-Length': String(data.length) } };
  });

  add('DELETE', '/api/resources/:id', {}, async (c) => {
    const r = db.prepare('SELECT * FROM resources WHERE id=?').get(c.params.id) as Row | undefined; if (!r) throw notFound('Resource not found');
    requireManage(db, c.auth!.principal, r.course_id, 'resource:manage_own');
    tx(db, () => {
      db.prepare('DELETE FROM resources WHERE id=?').run(r.id);
      if (r.file_asset_id) db.prepare('UPDATE file_assets SET deleted_at=? WHERE id=?').run(c.now.toISOString(), r.file_asset_id);
    });
    if (r.file_asset_id) { const f = db.prepare('SELECT storage_key FROM file_assets WHERE id=?').get(r.file_asset_id) as Row | undefined; if (f) await unlink(diskPath(f.storage_key)).catch(() => {}); }
    return { status: 204 };
  });

  // ── Teacher review / override of short-answer grading ──
  add('GET', '/api/quizzes/:id/short-answers', {}, (c) => {
    const quiz = db.prepare('SELECT * FROM quizzes WHERE id=?').get(c.params.id) as Row | undefined; if (!quiz) throw notFound('Quiz not found');
    requireManage(db, c.auth!.principal, quiz.course_id, 'quiz:manage_own');
    const rows = db.prepare(`SELECT sa.*, q.prompt, a.user_id, u.display_name, a.id attempt_id FROM submitted_answers sa
      JOIN questions q ON q.id=sa.question_id JOIN attempts a ON a.id=sa.attempt_id JOIN users u ON u.id=a.user_id
      WHERE q.quiz_id=? AND q.type='SHORT_ANSWER' AND a.status='GRADED' ORDER BY a.submitted_at DESC LIMIT 200`).all(c.params.id) as Row[];
    return { body: { items: rows.map((r) => ({ attemptId: r.attempt_id, questionId: r.question_id, student: r.display_name, prompt: r.prompt, answer: r.text_answer, autoCorrect: !!r.is_correct, pointsAwarded: r.points_awarded })) } };
  });
  add('POST', '/api/attempts/:id/answers/:qid/override', {}, (c) => {
    const a = db.prepare('SELECT a.*, q.course_id, qq.points FROM attempts a JOIN quizzes q ON q.id=a.quiz_id JOIN questions qq ON qq.id=? WHERE a.id=?').get(c.params.qid, c.params.id) as Row | undefined;
    if (!a) throw notFound('Attempt not found');
    requireManage(db, c.auth!.principal, a.course_id, 'quiz:manage_own');
    const correct = !!obj(c.body).isCorrect;
    const points = correct ? a.points : 0;
    const r = db.prepare('UPDATE submitted_answers SET is_correct=?, points_awarded=? WHERE attempt_id=? AND question_id=?').run(correct ? 1 : 0, points, a.id, c.params.qid);
    if (r.changes === 0) throw notFound('Answer not found');
    tx(db, () => {
      const totals = db.prepare('SELECT COALESCE(SUM(points_awarded),0) s FROM submitted_answers WHERE attempt_id=?').get(a.id) as Row;
      const pct = a.max_score > 0 ? Math.round((totals.s / a.max_score) * 10_000) / 100 : 0;
      const quiz = db.prepare('SELECT passing_score_pct FROM quizzes WHERE id=?').get(a.quiz_id) as Row;
      db.prepare('UPDATE attempts SET score=?, percentage=?, passed=? WHERE id=?').run(totals.s, pct, pct >= quiz.passing_score_pct ? 1 : 0, a.id);
    });
    audit(db, uidOf(c), 'quiz.answer_override', 'attempt', a.id, { questionId: c.params.qid, isCorrect: correct }, c, c.now);
    return { body: { ok: true } };
  });
}
