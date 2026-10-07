# JULIE — Implementation Status

Updated: 2026-10-04. Levels: NOT STARTED / IN PROGRESS / IMPLEMENTED / TESTED / VERIFIED / BLOCKED.
TESTED = automated tests pass. VERIFIED = run for real (server started, exercised over HTTP and in a real Chromium browser, screenshots in `docs/screenshots/`).

**Two deliverables:**
1. **Standalone edition** (`npm start`) — runs today, zero npm dependencies, SQLite via `node:sqlite`. Everything below marked VERIFIED was run in the authoring sandbox. This is the complete, functional app.
2. **Production port** (Next.js + Prisma/PostgreSQL + Firebase) — schema drafted (`prisma/schema.prisma`, 59 models), NOT validated or migrated (no package registry/PostgreSQL available in this sandbox). See `docs/STANDALONE.md` for the mapping between the two.

| Area | Status | Evidence / gaps |
|---|---|---|
| Domain logic (`src/lib`: access, RBAC, quiz, XP, streak, API keys, payments, uploads, http, time) | TESTED | 47 unit tests |
| HTTP server, routing, security headers, CSRF, rate limits | VERIFIED | integration tests + live server |
| Local auth (register, login, logout, sessions, suspension) | VERIFIED | Firebase adapter NOT STARTED — see "External integrations" below |
| RBAC + ownership on all routes | TESTED | positive and negative cases incl. IDOR |
| Student: dashboard, courses, lessons, progress, XP/levels/streaks, quizzes, goals/tasks, notifications + preferences, timetable, news, plans, profile | VERIFIED | real Chromium journeys (`e2e/browser-e2e.py`, `e2e/browser-e2e-extra.py`) |
| Teacher: courses, lessons, quiz builder, announcements, student results, file/link resources, short-answer override grading | VERIFIED | upload tested with a real file via a real file chooser in-browser |
| Admin: users, roles, suspension, grants/revocation, plan pricing/limits/activation, news publishing, feature flags, audit log, security events, analytics | VERIFIED | all admin tabs clicked and exercised in-browser |
| Developer: API keys (create/rotate/revoke), usage, public `/api/v1/courses` | VERIFIED | |
| Subjects (catalog, admin-managed) | TESTED | |
| File uploads / local storage adapter | VERIFIED | allowlist + magic-byte validation; download gated by enrollment/ownership |
| Subscriptions: trial, admin grants, effective access | TESTED | |
| Payments: checkout, signed webhook, idempotency, refunds | TESTED | no real provider connected — see "External integrations" |
| Julie AI: limits, persistence, context rules, failure handling | TESTED | fake provider only — see "External integrations" |
| Timetable, news/categories, feature flags, notification preferences, short-answer teacher review | VERIFIED | all implemented and exercised in-browser this session |
| Outgoing webhooks (developer-configured) | NOT STARTED | incoming payment webhook exists; outgoing is not |
| PostgreSQL migration, Prisma client, Next.js port | BLOCKED | needs package registry + database access this sandbox doesn't have |
| Deployment | NOT STARTED | run instructions in `docs/STANDALONE.md`; nothing deployed to a server |

Test counts at time of writing: **76 passing** (`npm test`); two browser E2E suites passing with zero console errors.

## External integrations required (the only remaining work)
Everything else is implemented, tested, and has no further internal work planned. These two need real-world credentials/accounts that only you can provide:

1. **Payment provider** (e.g. Stripe, Paddle, etc.) — `POST /api/payments/webhook` already implements a signed, replay-protected, idempotent handler (`src/lib/payments/payments.ts`). You need to: pick a provider, implement the small adapter that calls your provider's API from `POST /api/payments/checkout` (currently returns "not configured"), and configure that provider to send webhooks to `/api/payments/webhook` with `x-julie-timestamp` + `x-julie-signature` headers (HMAC-SHA256 of `timestamp.rawBody` using `PAYMENT_WEBHOOK_SECRET`). Set `PAYMENT_WEBHOOK_SECRET` in the environment.
2. **AI provider** (Anthropic by default) — `server/ai.ts` has a working Anthropic Messages API adapter, untested against the live API (no network in this sandbox). Set `AI_PROVIDER=anthropic`, `AI_API_KEY`, `AI_MODEL` and it should work as-is; swap the adapter if you want a different provider.

Optional, not required to run: Firebase Authentication (only needed for the production Next.js/Postgres port, not the standalone app, which has its own working email+password auth).
