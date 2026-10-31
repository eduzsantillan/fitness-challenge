-- Results use the last snapshot received before the real closing instant, including across time zones.
-- Existing rows only backfill evidence we actually have; lost older versions are never invented.
CREATE TABLE personal_step_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  steps INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 250000),
  captured_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL,
  time_zone TEXT
);
CREATE INDEX personal_step_history_cutoff_idx ON personal_step_history(user_id,date,captured_at DESC,synced_at DESC,id DESC);
INSERT INTO personal_step_history(user_id,date,steps,captured_at,synced_at,time_zone)
  SELECT s.user_id,s.date,s.steps,s.captured_at,s.synced_at,p.time_zone
  FROM personal_steps s LEFT JOIN profiles p ON p.user_id=s.user_id;
ALTER TABLE challenges ADD COLUMN prize_rule TEXT NOT NULL DEFAULT 'coordinate'
  CHECK (prize_rule IN ('coordinate','others','creator'));
-- Frozen totals and receipt are private to members. Erasure redacts identities and measurements in this object.
ALTER TABLE challenges ADD COLUMN result JSONB;
