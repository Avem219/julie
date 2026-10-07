-- Apply after the initial Prisma migration (as an additional migration file).
-- Prisma cannot express CHECK constraints; these enforce invariants at the database level.

ALTER TABLE access_grants
  ADD CONSTRAINT access_grants_timed_requires_expiry
  CHECK (type <> 'TIMED' OR expires_at IS NOT NULL);

ALTER TABLE access_grants
  ADD CONSTRAINT access_grants_expiry_after_start
  CHECK (expires_at IS NULL OR expires_at > starts_at);

ALTER TABLE timetable_entries
  ADD CONSTRAINT timetable_day_range CHECK (day_of_week BETWEEN 0 AND 6),
  ADD CONSTRAINT timetable_minutes_range CHECK (
    start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND end_minute > start_minute);

ALTER TABLE quizzes
  ADD CONSTRAINT quiz_passing_pct_range CHECK (passing_score_pct BETWEEN 0 AND 100);

ALTER TABLE feature_flags
  ADD CONSTRAINT flag_rollout_range CHECK (rollout_percent BETWEEN 0 AND 100);

ALTER TABLE xp_events
  ADD CONSTRAINT xp_amount_nonzero CHECK (amount <> 0);
