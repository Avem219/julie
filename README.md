# JULIE

Learning platform for students, teachers, admins and developers.

**Runs today:** `npm start` (Node >= 22.18, no dependencies). Includes student learning (courses, lessons, quizzes, XP/levels/streaks, goals, notifications), teacher tools, admin console (roles, access grants, audit log), developer API keys, subscriptions/trial, a payments webhook, and an AI tutor abstraction.

```bash
export JULIE_DEV_SEED_PASSWORD='choose-a-password'
npm run seed && npm start      # http://localhost:3000  (users: student@ teacher@ admin@ developer@ example.test)
npm test                       # 68 tests
```

Read next: `docs/STANDALONE.md` (how it runs, what differs from the production design), `docs/IMPLEMENTATION_STATUS.md` (honest status), `docs/SECURITY.md`, `docs/API.md`.
The Prisma/PostgreSQL/Firebase production design is in `prisma/` and is not yet validated.
