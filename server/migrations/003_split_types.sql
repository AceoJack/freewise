-- Freewise schema v3: percentage and exact-amount splits, and deletable groups.

-- Deleted groups are hidden rather than erased, so their activity stays readable.
ALTER TABLE groups ADD COLUMN deleted_at TEXT;

-- What each person was given in a percentage split (hundredths of a percent) or
-- an exact split (cents), so editing shows the same numbers. NULL for other splits.
ALTER TABLE expense_shares ADD COLUMN split_value INTEGER;

-- SQLite can't change a CHECK constraint in place, so rebuild expenses to allow
-- the new split types. expense_shares refers to "expenses" by name and picks up
-- the new table once it is renamed.
CREATE TABLE expenses_new (
  id             INTEGER PRIMARY KEY,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  description    TEXT NOT NULL CHECK (length(trim(description)) > 0),
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  paid_by        INTEGER NOT NULL REFERENCES users(id),
  split_type     TEXT NOT NULL CHECK (split_type IN ('equal', 'full', 'percent', 'exact')),
  spent_on       TEXT NOT NULL CHECK (spent_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT,
  deleted_at     TEXT,
  -- NULL while on the group's current ledger; set when a settle-up archives it.
  settlement_id  INTEGER REFERENCES settlements(id)
);
INSERT INTO expenses_new (id, group_id, description, amount_cents, paid_by, split_type, spent_on,
                          created_by, created_at, updated_at, deleted_at, settlement_id)
  SELECT id, group_id, description, amount_cents, paid_by, split_type, spent_on,
         created_by, created_at, updated_at, deleted_at, settlement_id
  FROM expenses;
DROP TABLE expenses;
ALTER TABLE expenses_new RENAME TO expenses;
CREATE INDEX expenses_active ON expenses(group_id) WHERE settlement_id IS NULL AND deleted_at IS NULL;
CREATE INDEX expenses_by_settlement ON expenses(settlement_id);
