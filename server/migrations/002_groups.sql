-- Freewise schema v2: friends, groups (each with its own ledger), splits between
-- any number of people, and an activity log. Anyone who already exists is put in
-- one group together, which takes over the existing ledger and history.

-- Users: names no longer need to be unique, and we keep the Google profile picture.
CREATE TABLE users_new (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  picture_url  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO users_new (id, name, created_at) SELECT id, name, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Friendships are stored in both directions so "my friends" is a single lookup.
CREATE TABLE friendships (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

CREATE TABLE groups (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE group_members (
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  added_by  INTEGER REFERENCES users(id),
  added_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_by_user ON group_members(user_id);

-- Existing people (at most two in v1) become friends and share the first group.
INSERT INTO groups (name, created_by)
  SELECT group_concat(name, ' & '), min(id) FROM (SELECT id, name FROM users ORDER BY id) HAVING count(*) >= 2;
INSERT INTO group_members (group_id, user_id) SELECT g.id, u.id FROM groups g CROSS JOIN users u;
INSERT INTO friendships (user_id, friend_id)
  SELECT a.id, b.id FROM users a JOIN users b ON a.id <> b.id WHERE EXISTS (SELECT 1 FROM groups);

-- A settle-up now belongs to a group and records one payment per person-to-person transfer.
CREATE TABLE settlements_new (
  id          INTEGER PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE settlement_payments (
  settlement_id  INTEGER NOT NULL REFERENCES settlements_new(id) ON DELETE CASCADE,
  from_user_id   INTEGER NOT NULL REFERENCES users(id),
  to_user_id     INTEGER NOT NULL REFERENCES users(id),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  CHECK (from_user_id <> to_user_id)
);
INSERT INTO settlements_new (id, group_id, created_by, created_at)
  SELECT id, (SELECT id FROM groups), created_by, created_at FROM settlements;
INSERT INTO settlement_payments (settlement_id, from_user_id, to_user_id, amount_cents)
  SELECT id, from_user_id, to_user_id, amount_cents FROM settlements WHERE amount_cents > 0;

-- Expenses belong to a group; each participant's share lives in expense_shares.
CREATE TABLE expenses_new (
  id             INTEGER PRIMARY KEY,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description    TEXT NOT NULL CHECK (length(trim(description)) > 0),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_by        INTEGER NOT NULL REFERENCES users(id),
  split_type     TEXT NOT NULL CHECK (split_type IN ('equal', 'full')),
  spent_on       TEXT NOT NULL CHECK (spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  deleted_at     TEXT,
  -- NULL while on the group's current ledger; set when a settle-up archives it.
  settlement_id  INTEGER REFERENCES settlements_new(id)
);
-- share_cents is each participant's portion of the cost (the payer's own share included).
CREATE TABLE expense_shares (
  expense_id   INTEGER NOT NULL REFERENCES expenses_new(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  share_cents  INTEGER NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);
INSERT INTO expenses_new (id, group_id, description, amount_cents, paid_by, split_type, spent_on,
                          created_by, created_at, updated_at, deleted_at, settlement_id)
  SELECT id, (SELECT id FROM groups), description, amount_cents, paid_by, split_type, spent_on,
         created_by, created_at, updated_at, deleted_at, settlement_id
  FROM expenses;
INSERT INTO expense_shares (expense_id, user_id, share_cents)
  SELECT id, paid_by, amount_cents - owed_cents FROM expenses WHERE split_type = 'equal';
INSERT INTO expense_shares (expense_id, user_id, share_cents)
  SELECT e.id, u.id, e.owed_cents FROM expenses e JOIN users u ON u.id <> e.paid_by;

DROP TABLE expenses;
DROP TABLE settlements;
ALTER TABLE settlements_new RENAME TO settlements;
ALTER TABLE expenses_new RENAME TO expenses;
CREATE INDEX expenses_active ON expenses(group_id) WHERE settlement_id IS NULL AND deleted_at IS NULL;
CREATE INDEX expenses_by_settlement ON expenses(settlement_id);
CREATE INDEX settlements_by_group ON settlements(group_id);

-- Append-only feed of what happened. Group events are visible to the group's
-- members; events without a group (e.g. adding a friend) to the two people involved.
CREATE TABLE activity (
  id              INTEGER PRIMARY KEY,
  type            TEXT NOT NULL,
  actor_id        INTEGER NOT NULL REFERENCES users(id),
  group_id        INTEGER REFERENCES groups(id) ON DELETE CASCADE,
  target_user_id  INTEGER REFERENCES users(id),
  data            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX activity_by_group ON activity(group_id);
