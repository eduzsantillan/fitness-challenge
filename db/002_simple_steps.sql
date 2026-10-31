-- Private, rotatable per-user write capability; only its seed and lookup digest are persisted.
ALTER TABLE profiles ADD COLUMN time_zone TEXT;
ALTER TABLE profiles ADD COLUMN code_seed TEXT;
ALTER TABLE profiles ADD COLUMN code_hash TEXT UNIQUE;
ALTER TABLE profiles ADD CONSTRAINT profile_code_pair CHECK ((code_seed IS NULL) = (code_hash IS NULL));
ALTER TABLE challenges ADD COLUMN prize TEXT NOT NULL DEFAULT '' CHECK (char_length(prize) <= 160);
-- Personal snapshots survive leaving a challenge, but not deletion of the user's shared data/account.
CREATE TABLE personal_steps (
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  steps INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 250000),
  captured_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, date)
);
-- Preserve pre-migration challenge measurements when a member leaves or a challenge is deleted.
-- Kept separately so an archived legacy value can never overwrite a new personal /steps snapshot.
CREATE TABLE legacy_step_archive (
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  steps INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 250000),
  captured_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL,
  source_challenge_id TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);
