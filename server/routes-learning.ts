import type { Add, Env, Ctx } from './app.ts';
import { tx } from './db.ts';
import { obj, reqStr, optStr, reqInt, optInt, optBool, oneOf, optOneOf, reqArr, newId, slugify, type Row, type Obj } from './util.ts';
import { AppError, badRequest, conflict, forbidden, notFound } from '../src/lib/errors.ts';
import { hasPermission, type Principal } from '../src/lib/rbac/rbac.ts';
import { parsePagination } from '../src/lib/http/http.ts';
import { audit, awardXp, canManageCourse, courseProgress, getCourse, getEffectiveAccess, levelInfo, notify, requireManage, teacherIds, touchStreak, trackEvent } from './services.ts';
import { gradeAttempt, toStudentQuiz, toStudentResult, isWithinTimeLimit, type QuizRecord, type QuestionType } from '../src/lib/assessment/grade.ts';

const QTYPES = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'] as const;
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

export function loadQuiz(db: Env['db'], id: string): { quiz: QuizRecord; row: Row } | null {
  const row = db.prepare('SELECT * FROM quizzes WHERE id=?').get(id) as Row | undefined;
  if (!row) return null;
  const qs = db.prepare('SELECT * FROM questions WHERE quiz_id=? ORDER BY position').all(id) as Row[];
  const questions = qs.map((q) => ({
    id: q.id, type: q.type as QuestionType, prompt: q.prompt, explanation: q.explanation, points: q.points, position: q.position,
    options: (db.prepare('SELECT * FROM options WHERE question_id=? ORDER BY position').all(q.id) as Row[]).map((o) => ({ id: o.id, text: o.text, isCorrect: !!o.is_correct, position: o.position })),
  }));
  return { row, quiz: { id: row.id, title: row.title, description: row.description, timeLimitSeconds: row.time_limit_seconds, passingScorePct: row.passing_score_pct, questions } };
}

export function learningRoutes(e: Env, add: Add) {
  const { db } = e;
  const uidOf = (c: Ctx) => c.auth!.user.id;
  const P = (c: Ctx): Principal => c.auth!.principal;

  const courseDto = (c: Row, extra: object = {}) => ({ id: c.id, slug: c.slug, title: c.title, description: c.description, subject: c.subject, level: c.level, status: c.status, isPremium: !!c.is_premium, ...extra });
  const canView = (c: Ctx, course: Row) => canManageCourse(db, P(c), course.id, 'course:manage_own') || (course.status === 'PUBLISHED' && hasPermission(P(c), 'course:read'));
  function viewable(c: Ctx, id: string): Row {
    const course = getCourse(db, id);
    if (!canView(c, course)) throw notFound('Course not found');
    return course;
  }
  const isEnrolled = (uid: string, courseId: string) => !!db.prepare(`SELECT 1 FROM enrollments WHERE user_id=? AND course_id=? AND status<>'DROPPED'`).get(uid, courseId);
  /** Which lock (if any) applies to a lesson for this user. Managers are never locked. */
  function lessonLock(c: Ctx, course: Row, lesson: Row): null | 'ENROLLMENT' | 'PREMIUM' {
    if (canManageCourse(db, P(c), course.id, 'course:manage_own')) return null;
    if (lesson.is_preview) return null;
    if (!isEnrolled(uidOf(c), course.id)) return 'ENROLLMENT';
    if (course.is_premium && !getEffectiveAccess(db, uidOf(c), c.now).hasPremiumAccess) return 'PREMIUM';
    return null;
  }

  // ── Courses ──
  add('GET', '/api/courses', { perm: 'course:read' }, (c) => {
    const p = parsePagination(c.query, { sortable: ['created_at', 'title'], defaultSort: 'created_at' });
    const q = (c.query.q ?? '').slice(0, 100); const subject = (c.query.subject ?? '').slice(0, 100);
    const where = [`status='PUBLISHED'`]; const args: any[] = [];
    if (q) { where.push(`(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`); const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; args.push(like, like); }
    if (subject) { where.push('subject=?'); args.push(subject); }
    const order = Object.entries(p.orderBy)[0];
    const total = (db.prepare(`SELECT COUNT(*) n FROM courses WHERE ${where.join(' AND ')}`).get(...args) as Row).n;
    const rows = db.prepare(`SELECT * FROM courses WHERE ${where.join(' AND ')} ORDER BY ${order[0]} ${order[1] === 'desc' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`).all(...args, p.take, p.skip) as Row[];
    return { body: { total, page: p.page, pageSize: p.pageSize, items: rows.map((r) => courseDto(r, { enrolled: isEnrolled(uidOf(c), r.id), lessonCount: (db.prepare(`SELECT COUNT(*) n FROM lessons WHERE course_id=? AND status='PUBLISHED'`).get(r.id) as Row).n })) } };
  });

  add('GET', '/api/courses/:id', {}, (c) => {
    const course = viewable(c, c.params.id); const uid = uidOf(c);
    const manage = canManageCourse(db, P(c), course.id, 'course:manage_own');
    const lessons = (db.prepare(`SELECT * FROM lessons WHERE course_id=? ${manage ? '' : `AND status='PUBLISHED'`} ORDER BY position`).all(course.id) as Row[]);
    const done = new Set((db.prepare('SELECT lesson_id FROM lesson_progress WHERE user_id=?').all(uid) as Row[]).map((r) => r.lesson_id));
    const quizzes = (db.prepare(`SELECT * FROM quizzes WHERE course_id=? ${manage ? '' : `AND status='PUBLISHED'`} ORDER BY created_at`).all(course.id) as Row[])
      .map((q) => ({ id: q.id, title: q.title, description: q.description, status: q.status, timeLimitSeconds: q.time_limit_seconds, maxAttempts: q.max_attempts, passingScorePct: q.passing_score_pct, questionCount: (db.prepare('SELECT COUNT(*) n FROM questions WHERE quiz_id=?').get(q.id) as Row).n }));
    const enrolled = isEnrolled(uid, course.id);
    const announcements = (manage || enrolled) ? (db.prepare('SELECT id,title,body,created_at FROM announcements WHERE course_id=? ORDER BY created_at DESC LIMIT 20').all(course.id) as Row[]).map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.created_at })) : [];
    return { body: { ...courseDto(course), canManage: manage, enrolled, progress: courseProgress(db, uid, course.id), announcements, quizzes,
      lessons: lessons.map((l) => ({ id: l.id, title: l.title, summary: l.summary, position: l.position, status: l.status, isPreview: !!l.is_preview, xpReward: l.xp_reward, completed: done.has(l.id) })) } };
  });

  add('POST', '/api/courses', { perm: 'course:manage_own' }, (c) => {
    const b = obj(c.body); const id = newId();
    const title = reqStr(b, 'title', 3, 160);
    tx(db, () => {
      db.prepare('INSERT INTO courses(id,slug,title,description,subject,level,is_premium,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, `${slugify(title)}-${id.slice(0, 6)}`, title, optStr(b, 'description', 5000) ?? null, optStr(b, 'subject', 100) ?? null, optStr(b, 'level', 50) ?? null, optBool(b, 'isPremium') ? 1 : 0, uidOf(c), c.now.toISOString(), c.now.toISOString());
      db.prepare('INSERT INTO course_teachers(course_id,user_id) VALUES(?,?)').run(id, uidOf(c));
    });
    return { status: 201, body: { id } };
  });

  add('PATCH', '/api/courses/:id', {}, (c) => {
    const course = requireManage(db, P(c), c.params.id, 'course:manage_own'); const b = obj(c.body);
    // explicit field picking = no mass assignment (created_by, id, slug can never be set by clients)
    const title = optStr(b, 'title', 160), description = optStr(b, 'description', 5000), subject = optStr(b, 'subject', 100), level = optStr(b, 'level', 50);
    const status = optOneOf(b, 'status', STATUSES), premium = optBool(b, 'isPremium');
    db.prepare('UPDATE courses SET title=?,description=?,subject=?,level=?,status=?,is_premium=?,updated_at=? WHERE id=?')
      .run(title?.trim() || course.title, description ?? course.description, subject ?? course.subject, level ?? course.level, status ?? course.status, premium === undefined ? course.is_premium : premium ? 1 : 0, c.now.toISOString(), course.id);
    if (status && status !== course.status && P(c).roles.includes('ADMIN')) audit(db, uidOf(c), 'course.status_change', 'course', course.id, { from: course.status, to: status }, c);
    return { body: { ok: true } };
  });

  add('GET', '/api/teacher/courses', {}, (c) => {
    if (!hasPermission(P(c), 'course:manage_own') && !hasPermission(P(c), 'course:manage_any')) throw forbidden();
    const any = hasPermission(P(c), 'course:manage_any');
    const rows = (any ? db.prepare('SELECT * FROM courses ORDER BY created_at DESC').all() : db.prepare('SELECT c.* FROM courses c JOIN course_teachers t ON t.course_id=c.id WHERE t.user_id=? ORDER BY c.created_at DESC').all(uidOf(c))) as Row[];
    return { body: { items: rows.map((r) => courseDto(r, {
      enrollments: (db.prepare(`SELECT COUNT(*) n FROM enrollments WHERE course_id=? AND status<>'DROPPED'`).get(r.id) as Row).n,
      lessons: (db.prepare('SELECT COUNT(*) n FROM lessons WHERE course_id=?').get(r.id) as Row).n })) } };
  });

  add('POST', '/api/courses/:id/enroll', { perm: 'enrollment:self' }, (c) => {
    const course = viewable(c, c.params.id); const uid = uidOf(c);
    if (course.status !== 'PUBLISHED') throw notFound('Course not found');
    const r = db.prepare(`INSERT INTO enrollments(id,user_id,course_id,enrolled_at) VALUES(?,?,?,?) ON CONFLICT(user_id,course_id) DO UPDATE SET status='ACTIVE' WHERE status='DROPPED'`).run(newId(), uid, course.id, c.now.toISOString());
    if (r.changes > 0) trackEvent(db, uid, 'course_enrolled', { courseId: course.id }, c.now);
    return { status: 201, body: { ok: true } };
  });
  add('DELETE', '/api/courses/:id/enroll', { perm: 'enrollment:self' }, (c) => {
    db.prepare(`UPDATE enrollments SET status='DROPPED' WHERE user_id=? AND course_id=?`).run(uidOf(c), c.params.id);
    return { status: 204 };
  });

  add('POST', '/api/courses/:id/announcements', {}, (c) => {
    const course = requireManage(db, P(c), c.params.id, 'announcement:manage_own'); const b = obj(c.body);
    const title = reqStr(b, 'title', 1, 160), body = reqStr(b, 'body', 1, 4000);
    tx(db, () => {
      db.prepare('INSERT INTO announcements(id,course_id,author_id,title,body,created_at) VALUES(?,?,?,?,?,?)').run(newId(), course.id, uidOf(c), title, body, c.now.toISOString());
      for (const s of db.prepare(`SELECT user_id FROM enrollments WHERE course_id=? AND status<>'DROPPED'`).all(course.id) as Row[]) notify(db, s.user_id, 'ANNOUNCEMENT', `${course.title}: ${title}`, body.slice(0, 200), c.now);
    });
    return { status: 201, body: { ok: true } };
  });

  // ── Lessons ──
  add('POST', '/api/courses/:id/lessons', {}, (c) => {
    const course = requireManage(db, P(c), c.params.id, 'lesson:manage_own'); const b = obj(c.body); const id = newId();
    const pos = ((db.prepare('SELECT COALESCE(MAX(position),0) m FROM lessons WHERE course_id=?').get(course.id) as Row).m as number) + 1;
    db.prepare('INSERT INTO lessons(id,course_id,title,summary,content,position,xp_reward,is_preview,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, course.id, reqStr(b, 'title', 1, 200), optStr(b, 'summary', 500) ?? null, optStr(b, 'content', 50_000) ?? null, pos, optInt(b, 'xpReward', 0, 100) ?? 10, optBool(b, 'isPreview') ? 1 : 0, optOneOf(b, 'status', STATUSES) ?? 'DRAFT', c.now.toISOString());
    return { status: 201, body: { id } };
  });
  add('PATCH', '/api/lessons/:id', {}, (c) => {
    const l = db.prepare('SELECT * FROM lessons WHERE id=?').get(c.params.id) as Row | undefined; if (!l) throw notFound('Lesson not found');
    requireManage(db, P(c), l.course_id, 'lesson:manage_own'); const b = obj(c.body);
    const pv = optBool(b, 'isPreview');
    db.prepare('UPDATE lessons SET title=?,summary=?,content=?,position=?,xp_reward=?,is_preview=?,status=? WHERE id=?')
      .run(optStr(b, 'title', 200)?.trim() || l.title, optStr(b, 'summary', 500) ?? l.summary, optStr(b, 'content', 50_000) ?? l.content, optInt(b, 'position', 0, 10_000) ?? l.position, optInt(b, 'xpReward', 0, 100) ?? l.xp_reward, pv === undefined ? l.is_preview : pv ? 1 : 0, optOneOf(b, 'status', STATUSES) ?? l.status, l.id);
    return { body: { ok: true } };
  });
  add('GET', '/api/lessons/:id', {}, (c) => {
    const l = db.prepare('SELECT * FROM lessons WHERE id=?').get(c.params.id) as Row | undefined; if (!l) throw notFound('Lesson not found');
    const course = viewable(c, l.course_id); const manage = canManageCourse(db, P(c), course.id, 'course:manage_own');
    if (l.status !== 'PUBLISHED' && !manage) throw notFound('Lesson not found');
    const lock = lessonLock(c, course, l);
    const completed = !!db.prepare('SELECT 1 FROM lesson_progress WHERE user_id=? AND lesson_id=?').get(uidOf(c), l.id);
    if (!lock) trackEvent(db, uidOf(c), 'lesson_opened', { lessonId: l.id }, c.now);
    return { body: { id: l.id, courseId: course.id, courseTitle: course.title, title: l.title, summary: l.summary, xpReward: l.xp_reward, completed, locked: lock, content: lock ? null : l.content } };
  });
  add('POST', '/api/lessons/:id/complete', { perm: 'progress:self' }, (c) => {
    const l = db.prepare('SELECT * FROM lessons WHERE id=?').get(c.params.id) as Row | undefined; if (!l || l.status !== 'PUBLISHED') throw notFound('Lesson not found');
    const course = viewable(c, l.course_id); const uid = uidOf(c);
    if (!isEnrolled(uid, course.id)) throw forbidden('Enroll in the course first');
    if (lessonLock(c, course, l)) throw new AppError(402, 'ACCESS_REQUIRED', 'This lesson requires premium access');
    let xp = 0; let courseDone = false;
    tx(db, () => {
      const ins = db.prepare('INSERT OR IGNORE INTO lesson_progress(user_id,lesson_id,completed_at) VALUES(?,?,?)').run(uid, l.id, c.now.toISOString());
      if (ins.changes > 0) {
        if (awardXp(db, { userId: uid, amount: l.xp_reward || 0, source: 'LESSON_COMPLETED', key: `LESSON_COMPLETED:${uid}:${l.id}` }, c.now)) xp = l.xp_reward;
        trackEvent(db, uid, 'lesson_completed', { lessonId: l.id }, c.now);
        const prog = courseProgress(db, uid, course.id);
        if (prog.totalLessons > 0 && prog.completedLessons >= prog.totalLessons) {
          courseDone = true;
          db.prepare(`UPDATE enrollments SET status='COMPLETED', completed_at=? WHERE user_id=? AND course_id=?`).run(c.now.toISOString(), uid, course.id);
          notify(db, uid, 'COURSE', `Course completed: ${course.title}`, 'You finished every lesson.', c.now);
        }
      }
      touchStreak(db, uid, c.now);
    });
    return { body: { xpAwarded: xp, courseCompleted: courseDone, progress: courseProgress(db, uid, course.id), level: levelInfo(db, uid) } };
  });

  // ── Quizzes ──
  function validateQuestions(list: unknown[]) {
    return list.map((raw, i) => {
      const q = obj(raw); const type = oneOf(q, 'type', QTYPES);
      const optsIn = reqArr(q, 'options', type === 'TRUE_FALSE' ? 2 : type === 'SHORT_ANSWER' ? 1 : 2, type === 'SHORT_ANSWER' ? 10 : 8).map((o) => obj(o));
      const options = optsIn.map((o) => ({ text: reqStr(o, 'text', 1, 500), isCorrect: type === 'SHORT_ANSWER' ? true : o.isCorrect === true }));
      const correct = options.filter((o) => o.isCorrect).length;
      if (type === 'SHORT_ANSWER') { /* every option is an accepted answer */ }
      else if (type === 'MULTIPLE_CHOICE' ? correct < 1 || correct >= options.length : correct !== 1) throw badRequest(`Question ${i + 1}: invalid number of correct options`);
      return { type, prompt: reqStr(q, 'prompt', 1, 2000), explanation: optStr(q, 'explanation', 2000) ?? null, points: optInt(q, 'points', 1, 100) ?? 1, options };
    });
  }
  add('POST', '/api/courses/:id/quizzes', {}, (c) => {
    const course = requireManage(db, P(c), c.params.id, 'quiz:manage_own'); const b = obj(c.body); const id = newId();
    const questions = validateQuestions(reqArr(b, 'questions', 1, 50));
    tx(db, () => {
      db.prepare('INSERT INTO quizzes(id,course_id,title,description,time_limit_seconds,max_attempts,passing_score_pct,reveal_answers,xp_reward,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, course.id, reqStr(b, 'title', 1, 200), optStr(b, 'description', 1000) ?? null, optInt(b, 'timeLimitSeconds', 30, 14_400) ?? null, optInt(b, 'maxAttempts', 1, 100) ?? null, optInt(b, 'passingScorePct', 0, 100) ?? 60, optBool(b, 'revealAnswers') === false ? 0 : 1, optInt(b, 'xpReward', 0, 500) ?? 25, optOneOf(b, 'status', STATUSES) ?? 'DRAFT', uidOf(c), c.now.toISOString());
      questions.forEach((q, qi) => {
        const qid = newId();
        db.prepare('INSERT INTO questions(id,quiz_id,type,prompt,explanation,points,position) VALUES(?,?,?,?,?,?,?)').run(qid, id, q.type, q.prompt, q.explanation, q.points, qi);
        q.options.forEach((o, oi) => db.prepare('INSERT INTO options(id,question_id,text,is_correct,position) VALUES(?,?,?,?,?)').run(newId(), qid, o.text, o.isCorrect ? 1 : 0, oi));
      });
    });
    return { status: 201, body: { id } };
  });
  add('PATCH', '/api/quizzes/:id', {}, (c) => {
    const q = db.prepare('SELECT * FROM quizzes WHERE id=?').get(c.params.id) as Row | undefined; if (!q) throw notFound('Quiz not found');
    requireManage(db, P(c), q.course_id, 'quiz:manage_own'); const b = obj(c.body); // questions are immutable once created so past grades stay meaningful
    db.prepare('UPDATE quizzes SET title=?,description=?,status=? WHERE id=?').run(optStr(b, 'title', 200)?.trim() || q.title, optStr(b, 'description', 1000) ?? q.description, optOneOf(b, 'status', STATUSES) ?? q.status, q.id);
    return { body: { ok: true } };
  });
  add('GET', '/api/quizzes/:id', {}, (c) => {
    const l = loadQuiz(db, c.params.id); if (!l) throw notFound('Quiz not found');
    const course = viewable(c, l.row.course_id);
    if (canManageCourse(db, P(c), course.id, 'quiz:manage_own')) return { body: { manage: true, status: l.row.status, quiz: l.quiz } }; // full key: owners/admins only
    if (l.row.status !== 'PUBLISHED') throw notFound('Quiz not found');
    if (!isEnrolled(uidOf(c), course.id)) throw forbidden('Enroll in the course first');
    return { body: { manage: false, quiz: toStudentQuiz(l.quiz) } };
  });

  add('POST', '/api/quizzes/:id/attempts', { perm: 'quiz:attempt' }, (c) => {
    const l = loadQuiz(db, c.params.id); if (!l || l.row.status !== 'PUBLISHED') throw notFound('Quiz not found');
    const course = viewable(c, l.row.course_id); const uid = uidOf(c);
    if (!isEnrolled(uid, course.id)) throw forbidden('Enroll in the course first');
    if (course.is_premium && !getEffectiveAccess(db, uid, c.now).hasPremiumAccess) throw new AppError(402, 'ACCESS_REQUIRED', 'This quiz requires premium access');
    const result = tx(db, () => {
      const open = db.prepare(`SELECT * FROM attempts WHERE quiz_id=? AND user_id=? AND status='IN_PROGRESS'`).get(l.row.id, uid) as Row | undefined;
      if (open) {
        if (isWithinTimeLimit(new Date(open.started_at), c.now, l.row.time_limit_seconds)) return { attemptId: open.id, startedAt: open.started_at };
        db.prepare(`UPDATE attempts SET status='EXPIRED' WHERE id=?`).run(open.id);
      }
      const n = (db.prepare('SELECT COUNT(*) n, COALESCE(MAX(attempt_number),0) m FROM attempts WHERE quiz_id=? AND user_id=?').get(l.row.id, uid) as Row);
      if (l.row.max_attempts && n.n >= l.row.max_attempts) throw conflict('No attempts remaining');
      const id = newId();
      db.prepare('INSERT INTO attempts(id,quiz_id,user_id,attempt_number,started_at) VALUES(?,?,?,?,?)').run(id, l.row.id, uid, n.m + 1, c.now.toISOString());
      trackEvent(db, uid, 'quiz_started', { quizId: l.row.id }, c.now);
      return { attemptId: id, startedAt: c.now.toISOString() };
    });
    return { status: 201, body: { ...result, timeLimitSeconds: l.row.time_limit_seconds, quiz: toStudentQuiz(l.quiz) } };
  });

  add('POST', '/api/attempts/:id/submit', { perm: 'quiz:attempt' }, (c) => {
    const uid = uidOf(c); const b = obj(c.body);
    const a = db.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').get(c.params.id, uid) as Row | undefined; // other users' attempts look nonexistent
    if (!a) throw notFound('Attempt not found');
    if (a.status !== 'IN_PROGRESS') throw conflict('This attempt has already been submitted');
    const l = loadQuiz(db, a.quiz_id)!;
    if (!isWithinTimeLimit(new Date(a.started_at), c.now, l.row.time_limit_seconds)) {
      db.prepare(`UPDATE attempts SET status='EXPIRED' WHERE id=? AND status='IN_PROGRESS'`).run(a.id);
      throw conflict('The time limit for this attempt has passed');
    }
    const answers = reqArr(b, 'answers', 0, 200).map((x) => {
      const o = obj(x);
      return { questionId: reqStr(o, 'questionId', 1, 64), selectedOptionIds: Array.isArray(o.selectedOptionIds) ? o.selectedOptionIds.map(String) : undefined, textAnswer: typeof o.textAnswer === 'string' ? o.textAnswer : undefined };
    });
    const grade = gradeAttempt(l.quiz, answers); // throws 400 on invalid submissions
    let xp = 0;
    tx(db, () => {
      const upd = db.prepare(`UPDATE attempts SET status='GRADED', submitted_at=?, score=?, max_score=?, percentage=?, passed=? WHERE id=? AND status='IN_PROGRESS'`)
        .run(c.now.toISOString(), grade.score, grade.maxScore, grade.percentage, grade.passed ? 1 : 0, a.id);
      if (upd.changes !== 1) throw conflict('This attempt has already been submitted'); // concurrent double-submit loses here
      const byQ = new Map(answers.map((x) => [x.questionId, x]));
      for (const r of grade.results) {
        const given = byQ.get(r.questionId);
        db.prepare('INSERT INTO submitted_answers(attempt_id,question_id,selected_option_ids,text_answer,is_correct,points_awarded) VALUES(?,?,?,?,?,?)')
          .run(a.id, r.questionId, JSON.stringify(given?.selectedOptionIds ?? []), given?.textAnswer?.slice(0, 2000) ?? null, r.isCorrect ? 1 : 0, r.pointsAwarded);
      }
      if (grade.passed && awardXp(db, { userId: uid, amount: l.row.xp_reward || 0, source: 'QUIZ_PASSED', key: `QUIZ_PASSED:${uid}:${l.row.id}` }, c.now)) xp = l.row.xp_reward; // first pass only
      touchStreak(db, uid, c.now);
      trackEvent(db, uid, 'quiz_submitted', { quizId: l.row.id, passed: grade.passed }, c.now);
      notify(db, uid, 'QUIZ', `Quiz result: ${l.row.title}`, `${grade.percentage}% — ${grade.passed ? 'passed' : 'not passed'}`, c.now);
    });
    return { body: { ...toStudentResult(l.quiz, grade, !!l.row.reveal_answers), xpAwarded: xp, level: levelInfo(db, uid) } };
  });

  add('GET', '/api/attempts', { perm: 'quiz:attempt' }, (c) => {
    const rows = db.prepare(`SELECT a.id,a.attempt_number,a.status,a.percentage,a.passed,a.submitted_at,q.title,q.id qid FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.user_id=? ORDER BY a.started_at DESC LIMIT 100`).all(uidOf(c)) as Row[];
    return { body: { items: rows.map((r) => ({ id: r.id, quizId: r.qid, quizTitle: r.title, attemptNumber: r.attempt_number, status: r.status, percentage: r.percentage, passed: r.passed === null ? null : !!r.passed, submittedAt: r.submitted_at })) } };
  });

  add('GET', '/api/courses/:id/results', {}, (c) => {
    const course = requireManage(db, P(c), c.params.id, 'progress:read_own_students');
    const students = db.prepare(`SELECT u.id,u.display_name,u.email FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.course_id=? AND e.status<>'DROPPED' ORDER BY u.display_name`).all(course.id) as Row[];
    return { body: { items: students.map((s) => ({
      studentId: s.id, name: s.display_name, email: s.email, progress: courseProgress(db, s.id, course.id),
      quizzes: (db.prepare(`SELECT q.title, MAX(a.percentage) best, COUNT(a.id) attempts FROM quizzes q LEFT JOIN attempts a ON a.quiz_id=q.id AND a.user_id=? AND a.status='GRADED' WHERE q.course_id=? GROUP BY q.id`).all(s.id, course.id) as Row[]).map((r) => ({ title: r.title, best: r.best, attempts: r.attempts })) })) } };
  });
}
