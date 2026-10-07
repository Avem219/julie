import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { providerFromEnv, type AIProvider } from './ai.ts';

export type Config = {
  nodeEnv: string; port: number; dbPath: string; secureCookies: boolean; trustProxy: boolean;
  apiKeyPepper: string; paymentWebhookSecret: string | null; ai: AIProvider | null;
  loginRateLimitPerMin: number; apiRateLimitPerMin: number; quiet: boolean; storageDir: string;
};

function devPepper(): string {
  const f = './data/.dev-pepper';
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  mkdirSync('./data', { recursive: true });
  const p = randomBytes(32).toString('hex');
  writeFileSync(f, p, { mode: 0o600 });
  return p;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const prod = nodeEnv === 'production';
  let pepper = env.API_KEY_HASH_PEPPER;
  if (!pepper) {
    if (prod) throw new Error('API_KEY_HASH_PEPPER is required in production');
    pepper = devPepper(); // dev only: random per machine, git-ignored
  }
  if (pepper.length < 16) throw new Error('API_KEY_HASH_PEPPER must be at least 16 characters');
  const secret = env.PAYMENT_WEBHOOK_SECRET ?? null;
  if (secret !== null && secret.length < 16) throw new Error('PAYMENT_WEBHOOK_SECRET must be at least 16 characters');
  return {
    nodeEnv, port: Number(env.PORT ?? 3000), dbPath: env.DATABASE_PATH ?? './data/julie.db',
    secureCookies: prod, trustProxy: env.TRUST_PROXY === '1', apiKeyPepper: pepper, paymentWebhookSecret: secret,
    ai: providerFromEnv(env), loginRateLimitPerMin: 10, apiRateLimitPerMin: 300, quiet: false,
    storageDir: env.STORAGE_LOCAL_DIR ?? './data/uploads',
  };
}
