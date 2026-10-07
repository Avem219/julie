// Usage:  node server/cli.ts make-admin <email>     (run on the server; the only way to create the first admin)
//         JULIE_DEV_SEED_PASSWORD=... node server/cli.ts seed-dev   (development only)
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { seedDev } from './seed.ts';

const [cmd, arg] = process.argv.slice(2);
const config = loadConfig(); const db = openDb(config.dbPath); const now = new Date().toISOString();
if (cmd === 'make-admin' && arg) {
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(arg.toLowerCase()) as { id: string } | undefined;
  if (!u) { console.error('No user with that email. Register in the app first.'); process.exit(1); }
  db.prepare(`INSERT INTO user_roles(user_id,role,granted_at,reason) VALUES(?,?,?,'cli make-admin') ON CONFLICT(user_id,role) DO UPDATE SET revoked_at=NULL`).run(u.id, 'ADMIN', now);
  db.prepare(`INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?,?)`).run(crypto.randomUUID(), null, 'role.grant', 'user', u.id, JSON.stringify({ role: 'ADMIN', via: 'cli' }), now);
  console.log(`${arg} is now an administrator.`);
} else if (cmd === 'seed-dev') {
  if (config.nodeEnv === 'production') { console.error('Refusing to seed sample data in production.'); process.exit(1); }
  const pw = process.env.JULIE_DEV_SEED_PASSWORD;
  if (!pw) { console.error('Set JULIE_DEV_SEED_PASSWORD (min 10 chars). Seeds sample users @example.test.'); process.exit(1); }
  seedDev(db, pw);
  console.log('Seeded sample data: student@, teacher@, teacher2@, admin@, developer@ example.test');
} else { console.error('Usage: cli.ts make-admin <email> | seed-dev'); process.exit(1); }
db.close();
