# Standalone edition — what runs today

`npm start` runs a complete app with **no npm dependencies**: Node's built-in HTTP server, `node:sqlite` storage, and a plain-JS web client.
It exists because the authoring environment had no package registry or PostgreSQL. It uses the same domain logic (`src/lib`) that the production design specifies, so nothing has to be re-derived for the port.

## Requirements
Node >= 22.18 (built-in TypeScript type stripping and `node:sqlite`, which Node flags as experimental).

## Run it
```bash
cp .env.example .env            # optional; export the variables yourself, the app does not load .env files
export JULIE_DEV_SEED_PASSWORD='choose-a-password'   # dev sample data only
npm run seed                    # fictional users: student@, teacher@, teacher2@, admin@, developer@ example.test
npm start                       # http://localhost:3000
npm test                        # 68 tests
```
Real deployment: set `NODE_ENV=production`, `API_KEY_HASH_PEPPER`, a persistent `DATABASE_PATH`, serve over HTTPS (cookies become `Secure`), then register in the app and run `npm run make-admin -- you@example.com` on the server to create the first administrator (there is intentionally no self-service admin path).

## Deliberate differences from the production design
| Topic | Standalone | Production target |
|---|---|---|
| Auth | Email + password, scrypt hashes, server-side sessions | Firebase Auth; verify ID token; map to `users.firebase_uid`; no passwords stored |
| Database | SQLite file, `src/../server/db.ts` | PostgreSQL via Prisma (`prisma/schema.prisma`, 59 models) |
| Rate limits, AI quota | Login/API limiter in memory (single instance); **AI daily quota is persisted** in `ai_usage` and reserved atomically | Move limiter to a shared store (Redis or platform feature) behind `createRateLimiter`'s interface |
| Files/uploads | Not included. Validation logic exists and is tested (`src/lib/storage`) but no storage adapter or upload endpoint is wired | Storage adapter (S3-compatible or similar) + endpoints |
| Not implemented | Timetable, news categories, feature flags, webhooks (outgoing), subjects as a table (courses carry a `subject` text), notification preferences, teacher review of short answers (auto-graded only), AI feedback thumbs | Present in the Prisma schema; port when needed |

## Status of external integrations
- **Payments:** checkout creates a PENDING payment priced from the server. Completion happens only through the signed webhook (`POST /api/payments/webhook`, headers `x-julie-timestamp`, `x-julie-signature` = HMAC-SHA256 of `timestamp.rawBody`). No provider adapter is bundled: you must connect your provider to that contract. Tested with signed test requests, never with a real provider.
- **Julie AI:** Anthropic Messages adapter (`server/ai.ts`) needs `AI_PROVIDER=anthropic`, `AI_API_KEY`, `AI_MODEL`. The adapter has **not** been run against the live API. Everything around it (limits, context rules, persistence, failure handling) is tested with a fake provider.
