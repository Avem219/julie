# JULIE — Project Audit (Phase 1)

**Date:** 2026-09-19
**Result:** Greenfield. No existing repository was available, so there is nothing to preserve, repair, or migrate.

## 1. Current architecture
None existed. Chosen target (a decision, not an observation):
- Single TypeScript full-stack app: Next.js (App Router) with route handlers under `/api/*`
- PostgreSQL + Prisma
- Firebase Authentication (ID token verified server-side with Firebase Admin; Firebase UID mapped to `users.firebase_uid`; no passwords stored)
- Rationale: one deployable unit, works on free tiers (e.g. Vercel + Neon/Supabase + Firebase Spark)

## 2. Existing functionality
None.

## 3. Database status
- `prisma/schema.prisma`: 58 models, 25 enums covering identity/RBAC, academic structure, enrollment, assessment, progress/gamification, goals, scheduling, Julie AI, content, subscriptions, access grants, notifications, administration, developer platform, analytics.
- `prisma/constraints.sql`: CHECK constraints Prisma cannot express.
- **Not verified.** The authoring sandbox has no package-registry access, so `prisma validate`, migrations, and a clean-database run have NOT been executed. Only a structural script check ran (balanced braces, relation fields have counterparts).
- No migrations or seed data exist yet.

## 4. Backend status
Not started.

## 5. Frontend status
Not started.

## 6. Missing functionality
Everything except the schema draft: auth, RBAC, APIs, effective-access calculation, AI abstraction, storage abstraction, all UIs, tests, seed, deployment docs.

## 7. Broken functionality
N/A.

## 8. Security issues
None in code (no code). Design risks to handle: IDOR on every resource by id, `answer_options.is_correct` leaking to students, API key/webhook secret storage, mass assignment, rate limiting, upload validation.

## 9. Deployment issues
No config yet. `.env.example` and `.gitignore` are drafted. Nothing has been deployed.

## 10. Recommended implementation order
1. Validate schema and create the initial migration on a real machine
2. Apply `constraints.sql`; write dev-only seed (fictional data, clearly marked)
3. Backend foundation (validation, errors, logging, rate limit, headers)
4. Firebase auth + RBAC + ownership checks
5. Learning APIs, then subscriptions/effective access
6. AI provider abstraction
7. Student, teacher, admin, developer UIs
8. Tests and security hardening; production build and docs
