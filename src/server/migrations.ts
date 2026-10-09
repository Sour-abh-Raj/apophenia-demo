/**
 * Ordered schema migrations (applied once each, recorded in schema_migrations).
 * Access control is enforced by the API layer (see docs/SECURITY.md); the database
 * file itself must never be served or exposed.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
CREATE TABLE sessions (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  title                TEXT NOT NULL,
  state                TEXT NOT NULL DEFAULT 'LOBBY',
  instructor_key_hash  TEXT NOT NULL,
  projector_key_hash   TEXT NOT NULL,
  walkthrough          TEXT NOT NULL,           -- JSON WalkthroughPointer
  projector_mode       TEXT NOT NULL DEFAULT 'results',
  ranking              TEXT,                    -- JSON RankingConfig or NULL (= hidden)
  discussion_index     INTEGER NOT NULL DEFAULT 0,
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  opened_at            TEXT,
  locked_at            TEXT,
  released_at          TEXT,
  closed_at            TEXT
);

CREATE TABLE participants (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  nickname      TEXT NOT NULL,
  consent       INTEGER NOT NULL DEFAULT 1,   -- 1 = include anonymised responses in class statistics
  excluded      INTEGER NOT NULL DEFAULT 0,   -- set by instructor (e.g. a test device)
  trial_order   TEXT NOT NULL,                -- JSON array of trial keys
  cursor        INTEGER NOT NULL DEFAULT 0,   -- index of next trial
  joined_at     TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  finished_at   TEXT,
  UNIQUE (session_id, nickname)
);
CREATE INDEX participants_session ON participants(session_id);

CREATE TABLE responses (
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  trial_key      TEXT NOT NULL,
  task           TEXT NOT NULL,
  practice       INTEGER NOT NULL,
  item_id        TEXT NOT NULL,
  payload        TEXT NOT NULL,                -- JSON TrialResponse
  rt_ms          INTEGER,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (participant_id, trial_key)      -- one answer per trial: duplicates impossible
);
CREATE INDEX responses_session ON responses(session_id);

CREATE TABLE results (
  session_id   TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  computed_at  TEXT NOT NULL,
  payload      TEXT NOT NULL                   -- JSON snapshot computed from the locked submission set
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  at          TEXT NOT NULL,
  action      TEXT NOT NULL,
  detail      TEXT
);
`,
  },
  {
    version: 2,
    name: "private ranking preview, finish-up notice, research consent, predictions",
    sql: `
ALTER TABLE sessions ADD COLUMN ranking_preview TEXT;          -- JSON RankingConfig shown only on the dashboard
ALTER TABLE sessions ADD COLUMN notice TEXT;                   -- instructor's "please finish up" message (testing only)
ALTER TABLE participants ADD COLUMN research_consent INTEGER NOT NULL DEFAULT 0;  -- separate, opt-in
ALTER TABLE participants ADD COLUMN predictions TEXT;          -- JSON Predictions, asked while waiting
`,
  },
];
