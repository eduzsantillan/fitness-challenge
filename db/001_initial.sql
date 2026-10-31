-- Run once with npm run db:migrate, against a dedicated database for Ritmo.
CREATE TABLE auth_user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE, image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE auth_session (
  id TEXT PRIMARY KEY, "expiresAt" TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ipAddress" TEXT, "userAgent" TEXT,
  "userId" TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_idx ON auth_session("userId");
CREATE TABLE auth_account (
  id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ, "refreshTokenExpiresAt" TIMESTAMPTZ,
  scope TEXT, password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX auth_account_user_idx ON auth_account("userId");
CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification(identifier);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40)
);
CREATE TABLE challenges (
  id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
  owner_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  start_date DATE NOT NULL, end_date DATE NOT NULL, time_zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (end_date >= start_date AND end_date - start_date <= 30)
);
CREATE TABLE memberships (
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL, share_consent_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);
CREATE TABLE daily_activity (
  challenge_id TEXT NOT NULL, user_id TEXT NOT NULL, date DATE NOT NULL,
  steps INTEGER CHECK (steps BETWEEN 0 AND 250000),
  workout_seconds INTEGER CHECK (workout_seconds BETWEEN 0 AND 93600),
  captured_at TIMESTAMPTZ NOT NULL, synced_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'shortcuts', 'mixed')),
  PRIMARY KEY (challenge_id, user_id, date),
  FOREIGN KEY (challenge_id, user_id) REFERENCES memberships(challenge_id, user_id) ON DELETE CASCADE
);
CREATE TABLE invitations (
  hash TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX invitations_challenge_idx ON invitations(challenge_id);
CREATE TABLE shortcut_connections (
  challenge_id TEXT NOT NULL, user_id TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL, PRIMARY KEY (challenge_id, user_id),
  FOREIGN KEY (challenge_id, user_id) REFERENCES memberships(challenge_id, user_id) ON DELETE CASCADE
);
-- Only HMAC identifiers are stored here, not plaintext IPs, emails or Atajos keys.
CREATE TABLE request_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start BIGINT NOT NULL
);
