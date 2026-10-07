import { createServer } from 'node:http';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
const { handler } = createApp({ db, config });
const server = createServer((req, res) => void handler(req, res));
server.listen(config.port, () => {
  console.log(`Julie listening on http://localhost:${config.port} (${config.nodeEnv}); AI ${config.ai ? 'configured' : 'NOT configured'}; payments ${config.paymentWebhookSecret ? 'webhook configured' : 'NOT configured'}`);
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
