import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  firebase_uid TEXT UNIQUE,            -- reserved for the Firebase adapter (see docs/STANDALONE.md)
  password_hash TEXT NOT NULL,         -- local-auth adapter only; disappears when Firebase is used
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','DELETED')),
  timezone TEXT NOT NULL DEFAULT 'UTC', created_at TEXT NOT NULL, last_login_at TEXT);
CREATE TABLE IF NOT EXISTS user_roles(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('STUDENT','TEACHER','ADMIN','DEVELOPER')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL, reason TEXT,
  granted_at TEXT NOT NULL, revoked_at TEXT, PRIMARY KEY(user_id, role));
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS levels(number INTEGER PRIMARY KEY, title TEXT NOT NULL, min_xp INTEGER NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS plans(
  code TEXT PRIMARY KEY, name TEXT NOT NULL, interval TEXT NOT NULL CHECK(interval IN ('NONE','DAY','WEEK','MONTH')),
  interval_count INTEGER NOT NULL DEFAULT 1, price_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
  trial_days INTEGER, ai_daily_limit INTEGER, grants_premium INTEGER NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '{}', is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriptions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL CHECK(status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELED','EXPIRED')),
  period_start TEXT NOT NULL, period_end TEXT, trial_ends_at TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS access_grants(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT REFERENCES plans(code), type TEXT NOT NULL CHECK(type IN ('TIMED','UNLIMITED')),
  starts_at TEXT NOT NULL, expires_at TEXT, reason TEXT NOT NULL,
  granted_by TEXT NOT NULL REFERENCES users(id), revoked_at TEXT, revoked_by TEXT REFERENCES users(id), revoke_reason TEXT, created_at TEXT NOT NULL,
  CHECK(type <> 'TIMED' OR expires_at IS NOT NULL));
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), subscription_id TEXT REFERENCES subscriptions(id),
  plan_code TEXT NOT NULL REFERENCES plans(code), amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCEEDED','FAILED','REFUNDED')),
  provider TEXT NOT NULL, external_ref TEXT UNIQUE, failure_reason TEXT, created_at TEXT NOT NULL, paid_at TEXT);
CREATE TABLE IF NOT EXISTS courses(
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT, subject TEXT, level TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')), is_premium INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS course_teachers(
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(course_id, user_id));
CREATE TABLE IF NOT EXISTS lessons(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, summary TEXT, content TEXT,
  position INTEGER NOT NULL DEFAULT 0, xp_reward INTEGER NOT NULL DEFAULT 10, is_preview INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enrollments(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','DROPPED')), enrolled_at TEXT NOT NULL, completed_at TEXT,
  UNIQUE(user_id, course_id));
CREATE TABLE IF NOT EXISTS lesson_progress(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL, PRIMARY KEY(user_id, lesson_id));
CREATE TABLE IF NOT EXISTS quizzes(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT,
  time_limit_seconds INTEGER, max_attempts INTEGER, passing_score_pct INTEGER NOT NULL DEFAULT 60 CHECK(passing_score_pct BETWEEN 0 AND 100),
  reveal_answers INTEGER NOT NULL DEFAULT 1, xp_reward INTEGER NOT NULL DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')), created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions(
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','TRUE_FALSE','SHORT_ANSWER')),
  prompt TEXT NOT NULL, explanation TEXT, points INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS options(
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE, text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS attempts(
  id TEXT PRIMARY KEY, quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS','GRADED','EXPIRED')),
  started_at TEXT NOT NULL, submitted_at TEXT, score REAL, max_score REAL, percentage REAL, passed INTEGER,
  UNIQUE(quiz_id, user_id, attempt_number));
CREATE TABLE IF NOT EXISTS submitted_answers(
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_option_ids TEXT NOT NULL DEFAULT '[]', text_answer TEXT, is_correct INTEGER, points_awarded REAL, PRIMARY KEY(attempt_id, question_id));
CREATE TABLE IF NOT EXISTS xp_events(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, amount INTEGER NOT NULL CHECK(amount <> 0),
  source TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS streaks(
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, current_days INTEGER NOT NULL DEFAULT 0,
  longest_days INTEGER NOT NULL DEFAULT 0, last_activity_date TEXT);
CREATE TABLE IF NOT EXISTS goals(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, target_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETED','ABANDONED')), completed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  title TEXT NOT NULL, due_at TEXT, status TEXT NOT NULL DEFAULT 'TODO' CHECK(status IN ('TODO','IN_PROGRESS','DONE','CANCELLED')),
  completed_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  read_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS announcements(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs(
  id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, metadata TEXT,
  ip_address TEXT, request_id TEXT, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TABLE IF NOT EXISTS security_events(
  id TEXT PRIMARY KEY, user_id TEXT, type TEXT NOT NULL, severity TEXT NOT NULL, ip_address TEXT, metadata TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')), expires_at TEXT, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_usage(
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE, day TEXT NOT NULL, request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(api_key_id, day));
CREATE TABLE IF NOT EXISTS ai_usage(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, day));
CREATE TABLE IF NOT EXISTS ai_messages(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('USER','ASSISTANT')), content TEXT NOT NULL, model TEXT, tokens_in INTEGER, tokens_out INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_events(
  id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, properties TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_enroll_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id, position);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_events_name ON user_events(name, created_at);

CREATE TABLE IF NOT EXISTS subjects(
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS news_categories(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS news_articles(
  id TEXT PRIMARY KEY, category_id TEXT REFERENCES news_categories(id) ON DELETE SET NULL, author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED')), published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS timetables(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS timetable_entries(
  id TEXT PRIMARY KEY, timetable_id TEXT NOT NULL REFERENCES timetables(id) ON DELETE CASCADE, course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
  day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), start_minute INTEGER NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),
  end_minute INTEGER NOT NULL CHECK(end_minute BETWEEN 1 AND 1440), title TEXT NOT NULL, location TEXT, notes TEXT, CHECK(end_minute > start_minute));
CREATE TABLE IF NOT EXISTS feature_flags(
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, description TEXT, enabled INTEGER NOT NULL DEFAULT 0, rollout_percent INTEGER NOT NULL DEFAULT 0 CHECK(rollout_percent BETWEEN 0 AND 100),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification_preferences(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, category TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, category));
CREATE TABLE IF NOT EXISTS resources(
  id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE, lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE,
  file_asset_id TEXT REFERENCES file_assets(id) ON DELETE SET NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN ('FILE','LINK')), title TEXT NOT NULL, description TEXT, url TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_resources_course ON resources(course_id);
CREATE TABLE IF NOT EXISTS file_assets(
  id TEXT PRIMARY KEY, uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL, storage_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','COURSE','PUBLIC')),
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE, lesson_id TEXT REFERENCES lessons(id) ON DELETE CASCADE, created_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX IF NOT EXISTS idx_news_status ON news_articles(status, published_at);
CREATE INDEX IF NOT EXISTS idx_timetable_entries ON timetable_entries(timetable_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_files_course ON file_assets(course_id);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  ensureBaseData(db);
  return db;
}

/** Configuration data the app needs to function (levels and default plans). Admins can adjust plans via the API. */
function ensureBaseData(db: DB) {
  const lv = db.prepare('INSERT OR IGNORE INTO levels(number,title,min_xp) VALUES(?,?,?)');
  for (const [n, t, x] of [[1, 'Novice', 0], [2, 'Learner', 100], [3, 'Scholar', 300], [4, 'Adept', 600], [5, 'Expert', 1000], [6, 'Master', 1600]] as const) lv.run(n, t, x);
  const pl = db.prepare('INSERT OR IGNORE INTO plans(code,name,interval,interval_count,price_cents,trial_days,ai_daily_limit,grants_premium) VALUES(?,?,?,?,?,?,?,?)');
  pl.run('FREE', 'Free', 'NONE', 1, 0, null, 5, 0);
  pl.run('TRIAL', 'Free trial', 'NONE', 1, 0, 7, 30, 1);
  pl.run('DAILY', 'Daily', 'DAY', 1, 99, null, 50, 1);
  pl.run('WEEKLY', 'Weekly', 'WEEK', 1, 399, null, 100, 1);
  pl.run('MONTHLY', 'Monthly', 'MONTH', 1, 999, null, 200, 1);
}

/** BEGIN IMMEDIATE transaction. Not re-entrant: never call tx() inside tx(). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}
