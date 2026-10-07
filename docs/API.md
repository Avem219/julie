# API reference

Generated from the route registrations in `server/routes-*.ts` (all under one origin; JSON in/out).

**Conventions**
- Sessions: `HttpOnly` `SameSite=Lax` cookie. Every non-GET request must send `X-Requested-With: julie` (CSRF defence) and `Content-Type: application/json`.
- Errors: `{ "error": { "code", "message", "requestId" } }` with 400 validation, 401 unauthenticated, 402 access required, 403 forbidden, 404 not found, 409 conflict, 413 too large, 422 amount mismatch, 429 rate limited, 502/503 upstream/not configured, 500 internal (generic).
- Lists: `?page=&pageSize=&sort=&order=` (sort fields are whitelisted per endpoint) returning `{ total, page, pageSize, items }`.
- "Requires" is the server-checked permission; roles map to permissions in `src/lib/rbac/rbac.ts`. Ownership rules (e.g. a teacher may manage only their own courses) are enforced in addition.
- `/api/v1/*` uses `Authorization: Bearer <api key>` instead of a session.

| Method | Path | Requires |
|---|---|---|
| GET | `/api/admin/analytics` | analytics:read |
| GET | `/api/admin/audit-logs` | audit:read |
| POST | `/api/admin/grants/:id/revoke` | access_grant:manage |
| PATCH | `/api/admin/plans/:code` | subscription_plan:manage |
| GET | `/api/admin/security-events` | security:read |
| GET | `/api/admin/users` | user:read_any |
| GET | `/api/admin/users/:id` | user:read_any |
| POST | `/api/admin/users/:id/grants` | access_grant:manage |
| POST | `/api/admin/users/:id/roles` | role:manage |
| DELETE | `/api/admin/users/:id/roles/:role` | role:manage |
| PATCH | `/api/admin/users/:id/status` | user:manage |
| POST | `/api/ai/chat` | ai:use |
| GET | `/api/ai/history` | ai:use |
| GET | `/api/attempts` | quiz:attempt |
| POST | `/api/attempts/:id/submit` | quiz:attempt |
| POST | `/api/auth/login` | public |
| POST | `/api/auth/logout` | signed in |
| GET | `/api/auth/me` | signed in |
| POST | `/api/auth/register` | public |
| GET | `/api/auth/session` | public |
| GET | `/api/courses` | course:read |
| POST | `/api/courses` | course:manage_own |
| GET | `/api/courses/:id` | signed in |
| PATCH | `/api/courses/:id` | signed in |
| POST | `/api/courses/:id/announcements` | signed in |
| DELETE | `/api/courses/:id/enroll` | enrollment:self |
| POST | `/api/courses/:id/enroll` | enrollment:self |
| POST | `/api/courses/:id/lessons` | signed in |
| POST | `/api/courses/:id/quizzes` | signed in |
| GET | `/api/courses/:id/results` | signed in |
| GET | `/api/dashboard` | progress:self |
| GET | `/api/developer/keys` | api_key:manage_own |
| POST | `/api/developer/keys` | api_key:manage_own |
| DELETE | `/api/developer/keys/:id` | api_key:manage_own |
| POST | `/api/developer/keys/:id/rotate` | api_key:manage_own |
| GET | `/api/goals` | goal:self |
| POST | `/api/goals` | goal:self |
| PATCH | `/api/goals/:id` | goal:self |
| GET | `/api/health` | public |
| GET | `/api/lessons/:id` | signed in |
| PATCH | `/api/lessons/:id` | signed in |
| POST | `/api/lessons/:id/complete` | progress:self |
| GET | `/api/notifications` | notification:self |
| POST | `/api/notifications/:id/read` | notification:self |
| POST | `/api/notifications/read-all` | notification:self |
| POST | `/api/payments/checkout` | subscription:self |
| POST | `/api/payments/webhook` | signed webhook |
| PATCH | `/api/profile` | signed in |
| GET | `/api/quizzes/:id` | signed in |
| PATCH | `/api/quizzes/:id` | signed in |
| POST | `/api/quizzes/:id/attempts` | quiz:attempt |
| GET | `/api/subscriptions/mine` | subscription:self |
| GET | `/api/subscriptions/plans` | subscription:self |
| POST | `/api/subscriptions/trial` | subscription:self |
| POST | `/api/tasks` | task:self |
| PATCH | `/api/tasks/:id` | task:self |
| GET | `/api/teacher/courses` | signed in |
| GET | `/api/v1/courses` | public |
