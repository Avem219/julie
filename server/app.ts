import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, extname, sep } from 'node:path';
import type { DB } from './db.ts';
import type { Config } from './config.ts';
import { authenticate, type Auth } from './auth.ts';
import { AppError, badRequest, notFound, tooManyRequests, unauthenticated } from '../src/lib/errors.ts';
import { toErrorResponse } from '../src/lib/http/http.ts';
import { createRateLimiter } from '../src/lib/security/rate-limit.ts';
import { hasPermission } from '../src/lib/rbac/rbac.ts';
import { securityEvent } from './services.ts';
import { coreRoutes } from './routes-core.ts';
import { learningRoutes } from './routes-learning.ts';
import { platformRoutes } from './routes-platform.ts';
import { extraRoutes } from './routes-extra.ts';

export type Ctx = {
  req: IncomingMessage; url: URL; params: Record<string, string>; query: Record<string, string>;
  body: any; raw: string; auth: Auth | null; ip: string; now: Date; requestId: string; token?: string;
};
export type Result = { status?: number; body?: unknown; headers?: Record<string, string | string[]> };
export type Handler = (c: Ctx) => Promise<Result | void> | Result | void;
export type RouteOpts = { auth?: 'session' | 'none' | 'raw'; limiter?: 'auth'; perm?: string; bodyLimit?: number };
export type Add = (method: string, path: string, opts: RouteOpts, h: Handler) => void;
export type Env = { db: DB; config: Config; clock: () => Date; authLimiter: ReturnType<typeof createRateLimiter> };

type Route = { method: string; segs: string[]; opts: RouteOpts; h: Handler };
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const PUBLIC_DIR = resolve('./public');

export function securityHeaders(secure: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

export function createApp(input: { db: DB; config: Config; clock?: () => Date }) {
  const { db, config } = input;
  const clock = input.clock ?? (() => new Date());
  const env: Env = { db, config, clock, authLimiter: createRateLimiter({ windowMs: 60_000, max: config.loginRateLimitPerMin, now: () => clock().getTime() }) };
  const apiLimiter = createRateLimiter({ windowMs: 60_000, max: config.apiRateLimitPerMin, now: () => clock().getTime() });
  const routes: Route[] = [];
  const add: Add = (method, path, opts, h) => routes.push({ method, segs: path.split('/').filter(Boolean), opts, h });
  coreRoutes(env, add); learningRoutes(env, add); platformRoutes(env, add); extraRoutes(env, add);

  function match(method: string, path: string) {
    const parts = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of routes) {
      if (r.segs.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length && ok; i++) {
        if (r.segs[i].startsWith(':')) { try { params[r.segs[i].slice(1)] = decodeURIComponent(parts[i]); } catch { ok = false; } }
        else if (r.segs[i] !== parts[i]) ok = false;
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return { route: null, params: {}, pathMatched };
  }

  async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > limit) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large'); chunks.push(c as Buffer); }
    return Buffer.concat(chunks).toString('utf8');
  }
  const cookieToken = (req: IncomingMessage) => /(?:^|;\s*)julie_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const clientIp = (req: IncomingMessage) => (config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';

  function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string | string[]> = {}, requestId?: string) {
    // Binary responses (e.g. file downloads) carry their own Content-Type/Content-Length in `extra` and skip JSON encoding.
    if (Buffer.isBuffer(body)) {
      res.writeHead(status, { ...securityHeaders(config.secureCookies), 'Cache-Control': 'no-store', ...(requestId ? { 'X-Request-Id': requestId } : {}), ...extra });
      return void res.end(body);
    }
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...securityHeaders(config.secureCookies), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(requestId ? { 'X-Request-Id': requestId } : {}), ...extra });
    res.end(payload);
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    let rel = path === '/' ? '/index.html' : path;
    let file = resolve(PUBLIC_DIR, '.' + decodeURIComponent(rel));
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    try {
      const data = await readFile(file);
      res.writeHead(200, { ...securityHeaders(config.secureCookies), 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      if (extname(rel)) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      const data = await readFile(resolve(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { ...securityHeaders(config.secureCookies), 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      res.end(data);
    }
  }

  async function handler(req: IncomingMessage, res: ServerResponse) {
    const requestId = randomUUID(); const started = Date.now();
    const now = clock(); const ip = clientIp(req);
    let status = 500;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = (req.method ?? 'GET').toUpperCase();
      if (!url.pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') { status = 405; return send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }); }
        status = 200; return await serveStatic(req, res, url.pathname);
      }
      const rl = apiLimiter.check(ip);
      if (!rl.allowed) throw tooManyRequests();
      const { route, params, pathMatched } = match(method, url.pathname);
      if (!route) { status = pathMatched ? 405 : 404; return send(res, status, { error: { code: pathMatched ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: pathMatched ? 'Method not allowed' : 'Not found' } }, {}, requestId); }
      const opts = route.opts;
      const isWrite = method !== 'GET' && method !== 'HEAD';
      // CSRF: cookie-authenticated writes must carry a custom header, which browsers will not send cross-site without CORS approval.
      if (isWrite && opts.auth !== 'raw' && req.headers['x-requested-with'] !== 'julie') throw new AppError(403, 'CSRF_REJECTED', 'Missing required request header');
      if (opts.limiter === 'auth') { const a = env.authLimiter.check(ip); if (!a.allowed) { securityEvent(db, 'rate_limit.exceeded', 'MEDIUM', null, ip, { path: url.pathname }, now); throw tooManyRequests('Too many attempts, please wait a minute'); } }
      const raw = isWrite ? await readBody(req, opts.bodyLimit ?? 1_000_000) : '';
      let body: any = {};
      if (raw && opts.auth !== 'raw') {
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw badRequest('Content-Type must be application/json');
        try { body = JSON.parse(raw); } catch { throw badRequest('Invalid JSON'); }
      }
      const token = cookieToken(req);
      const auth = authenticate(db, token, now);
      if ((opts.auth ?? 'session') === 'session') {
        if (!auth) throw unauthenticated();
        if (opts.perm && !hasPermission(auth.principal, opts.perm)) {
          securityEvent(db, 'rbac.denied', 'LOW', auth.user.id, ip, { path: url.pathname, perm: opts.perm }, now);
          throw new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
        }
      }
      const query = Object.fromEntries(url.searchParams.entries());
      const result = (await route.h({ req, url, params, query, body, raw, auth, ip, now, requestId, token })) ?? { status: 204 };
      status = result.status ?? 200;
      return send(res, status, result.body, result.headers, requestId);
    } catch (err) {
      const r = toErrorResponse(err, requestId);
      status = r.status;
      if (!(err instanceof AppError)) console.error(JSON.stringify({ requestId, error: String((err as Error)?.stack ?? err) }));
      return send(res, r.status, r.body, {}, requestId);
    } finally {
      if (!config.quiet) console.log(JSON.stringify({ t: now.toISOString(), id: requestId, m: req.method, p: (req.url ?? '').split('?')[0], s: status, ms: Date.now() - started }));
    }
  }
  return { handler, env };
}
