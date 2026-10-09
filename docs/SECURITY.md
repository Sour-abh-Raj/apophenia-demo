# State machine, access control and data handling

## Session state machine (server-authoritative)

Stored in `sessions.state`; transitions are implemented in `src/shared/stateMachine.ts` and applied only by `POST /api/host/:sid/transition`.

```
LOBBY ──open──▶ TESTING_OPEN ──lock──▶ TEST_LOCKED_AWAITING_DEBRIEF ──beginWalkthrough──▶ ANSWER_WALKTHROUGH
                     ▲                          │                                                 │
                     └──────────reopen──────────┘                                         releaseResults
                                                                                                  ▼
                                                        SESSION_CLOSED ◀──close── RESULTS_RELEASED
```

- **AWAITING_PARTICIPANTS** is a *participant* status (`finished-waiting`) shown inside TESTING_OPEN, not a stored session state. By design, nothing a participant does can move the session forward. Finishing the last trial sets that participant's `finished_at` and nothing else.
- **RANKINGS_REVEALED** is a separate field (`sessions.ranking`, null = hidden). It can only be set in RESULTS_RELEASED and is shown on the projector only when the projector mode is "rankings".
- Transitions are **idempotent**: re-sending an action that has already been applied returns `{ok: true, changed: false}` (double clicks, retries). Skipping a phase returns HTTP 409.
- `reopen` is allowed only before the walkthrough. Once answers have been shown, the test cannot be re-opened.
- The results snapshot is computed and stored at **lock**, never displayed by that action.

## Who can see what

| Data | Participant (token) | Projector (screen key) | Instructor (host key) |
|---|---|---|---|
| Own progress, current + next stimulus (no answer) | ✔ during TESTING_OPEN | — | — |
| Answer key / reveal text | ✖ never | only the **current** walkthrough item, only after "Reveal"; full task key only in "answer key" view | ✔ during walkthrough (navigation + private preview) |
| Hidden-face reveal images | ✖ | ✔ from ANSWER_WALKTHROUGH | ✔ from ANSWER_WALKTHROUGH |
| Own scores + class averages | ✔ only in RESULTS_RELEASED / SESSION_CLOSED | — | ✔ after lock (private panel) |
| Class aggregates | inside own report only, after release | ✔ only after release | ✔ after lock |
| Other participants' data | ✖ never | ✖ (only nicknames chosen for a ranking) | ✔ |
| Rankings | ✖ | ✔ only when the instructor shows them | ✔ preview |
| CSV export | ✖ | ✖ | ✔ (pseudonymous by default) |

How this is enforced:
- Each role has its own random credential (192-bit). The server stores only SHA-256 hashes and compares them in constant time. The projector key cannot call instructor routes.
- Participant payloads are built server-side (`participantView`). The browser receives one trial at a time (plus the next stimulus for prefetching). The answer key never leaves the server during testing. Files use opaque names.
- Responses must match the participant's next scheduled trial (no skipping). They are unique per (participant, trial), so retries are idempotent and duplicates are impossible.
- Reports are generated only by `GET /api/p/report`, which checks the session state on every call. Refreshing or guessing URLs during earlier phases returns 403.
- Session creation requires `INSTRUCTOR_PASSCODE`. Unauthenticated endpoints (`/api/sessions`, `/api/join`, `/api/lookup`) are rate-limited per IP.
- Verified by `tests/unit/api.test.ts` (direct API requests, forged tokens, wrong-role keys, cross-session keys, phase gating, leakage scan) and `tests/e2e/classroom.spec.ts` (network-level scan of every participant response for answer-key fields until release).

## Database

SQLite (Node's built-in `node:sqlite`), schema in `src/server/migrations.ts`, applied automatically at start-up and recorded in `schema_migrations`.

| Table | Contents |
|---|---|
| `sessions` | title, join code, state, key hashes, walkthrough pointer, projector mode, ranking config, timestamps |
| `participants` | random ID, token hash, nickname, consent flag, excluded flag, per-participant trial order, cursor, timestamps |
| `responses` | one row per answered trial (primary key participant + trial), response JSON, reaction time |
| `results` | snapshot computed at lock |
| `audit_log` | instructor actions (create, open, lock, reveal transitions, exclusions, rankings, reset) |

There is no row-level security as in Supabase: the database file is only ever accessed by the server process and must not be exposed. Back it up or delete it like any other confidential file.

## Data minimisation and privacy

- No login, email, IP logging, cookies, analytics or third-party requests. Fonts are system fonts.
- Stored per participant: a self-chosen nickname, answers, reaction times, timestamps.
- The CSV export uses `P01, P02…` codes; nicknames are included only with an explicit second export.
- Participants may opt out of class statistics; they still receive their personal report.
- "Delete session" removes all rows for that session. "Reset" removes participants and responses but keeps the session (useful after rehearsal).
