-- Freewise schema v1. Money is always integer cents. Timestamps are ISO-8601 UTC.

CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A person can sign in with more than one Google account.
CREATE TABLE user_emails (
  email       TEXT PRIMARY KEY COLLATE NOCASE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_sub  TEXT UNIQUE  -- Google's stable account id, filled in on first sign-in
);

CREATE TABLE settlements (
  id            INTEGER PRIMARY KEY,
  from_user_id  INTEGER NOT NULL REFERENCES users(id),  -- who paid the balance
  to_user_id    INTEGER NOT NULL REFERENCES users(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE expenses (
  id             INTEGER PRIMARY KEY,
  description    TEXT NOT NULL CHECK (length(trim(description)) > 0),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_by        INTEGER NOT NULL REFERENCES users(id),
  split_type     TEXT NOT NULL CHECK (split_type IN ('equal', 'full')),
  -- What the other person owes the payer for this expense.
  owed_cents     INTEGER NOT NULL CHECK (owed_cents >= 0 AND owed_cents <= amount_cents),
  spent_on       TEXT NOT NULL CHECK (spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  deleted_at     TEXT,
  -- NULL while on the current ledger; set when a settle-up archives it.
  settlement_id  INTEGER REFERENCES settlements(id)
);

CREATE INDEX expenses_by_settlement ON expenses(settlement_id) WHERE deleted_at IS NULL;
