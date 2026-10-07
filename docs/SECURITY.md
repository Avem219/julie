# Security notes (standalone edition)

What is implemented and covered by the automated tests in `server/app.test.ts`:
- **AuthN:** scrypt password hashing; random 256-bit session tokens, only their SHA-256 stored; 7-day expiry; suspended accounts lose sessions immediately; equal-time login for unknown emails; generic login errors; login/register rate limit; failures recorded as security events.
- **AuthZ:** server-side RBAC (`hasPermission`) on every route; explicit ownership checks (teachers only manage their own courses; other users' attempts/goals/tasks/notifications look nonexistent). Roles never come from the client: registration ignores role fields; only admins (or the local `make-admin` CLI) grant roles. Developer and admin do not imply each other or student/teacher.
- **Quiz integrity:** students only receive sanitised quizzes (no `isCorrect`, explanations, or short-answer keys); grading, XP and time limits are server-side; double-submit blocked by a conditional update; questions are immutable after creation.
- **XP:** append-only ledger with idempotency keys; conflicting reuse is rejected; there is no client XP endpoint.
- **Access:** one engine (`computeEffectiveAccess`) decides premium/AI limits; expired, revoked, future-dated and malformed grants are ignored.
- **Payments:** price from the server, signed + time-windowed webhooks, idempotent state machine, amount check, atomic payment+subscription update.
- **API keys:** HMAC-SHA256 with server pepper, constant-time compare, plaintext shown once, scopes, revoke/rotate, usage counted, per-key rate limit.
- **Web:** strict CSP (no inline script/style), `nosniff`, frame denial, `Referrer-Policy`, HSTS when secure; CSRF custom header + SameSite=Lax; body size cap; JSON only; safe DOM building (no `innerHTML`); parameterised SQL everywhere with whitelisted sort fields.
- **Audit:** admin/developer/payment actions written to `audit_logs`, which database triggers make append-only.

Known limits (not fixed):
- In-memory rate limiters do not coordinate across instances.
- No email verification, password reset, MFA, or account lockout beyond rate limiting (Firebase would provide these).
- No file upload endpoint yet, so upload hardening is untested end to end.
- No penetration test or dependency audit has been done; SQLite in `node:sqlite` is flagged experimental by Node.
- The payment webhook has only been exercised with self-signed test requests.
