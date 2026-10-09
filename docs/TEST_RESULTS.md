# Test record

Run on 2026-10-09 in the build container (Linux, Node 22.22.0, Playwright 1.56.1 with its bundled Chromium (build 1194)).

| Check | Command | Result |
|---|---|---|
| Type checking (client + server) | `npm run typecheck` | ✅ no errors |
| Unit, stimulus-integrity and API-security tests | `npm test` | ✅ 34 / 34 passed |
| Production build | `npm run build` | ✅ |
| End-to-end class rehearsal (real browsers) | `npm run test:e2e` | ✅ 1 / 1 passed (≈55 s) |
| Dev mode smoke test | `npm run dev` → `/api/health` via Vite proxy | ✅ |
| `.env` loading | server started with only a `.env` file present | ✅ passcode read from `.env` |

## What the automated tests cover

**Experimental integrity** (`tests/unit/stimuli.test.ts`, `scoring.test.ts`)
- Every image in the manifest exists, is a 420×420 PNG and has opaque file names. Faces have in-bounds locations and private reveal images; noise items have neither.
- Regeneration from the fixed seeds is **byte-identical** (Python face generator and TypeScript battery generator).
- Coin sequences: 6/3/3 design; stored alternations, runs and head counts match the sequences; every item satisfies the pre-registered representativeness rule.
- Charts: 4/4/4 design, 30 points each; stored sample and replication r match the data; cherry-picked nulls are stronger than typical nulls but do not replicate (|r| < .2), while planted relationships do (|r| > .35, correct sign).
- Scoring: hits, misses, false alarms and correct rejections; rates only for complete tasks; localisation tolerance; per-category extras; log-linear d′; `normInv` against known quantiles; the exact longest-run probability against brute-force enumeration (including the 77 % figure quoted in the debrief).
- Rankings: competition ranking with ties, metric direction, and all ten disclosure modes, including ties straddling a cut-off.

**Delayed reveal and security** (`tests/unit/api.test.ts`), with three simulated participants plus a duplicate joiner:
- Passcode required; wrong, forged and cross-role keys rejected (the projector key cannot act as host; a participant token cannot operate controls; one session's host key cannot read another session).
- Lobby accepts no responses. During testing, **no participant payload** contains answer-key or score fields.
- Everyone finishing does **not** change the session state. Reports return 403 before release, including during lock and walkthrough.
- Duplicate submissions are idempotent; out-of-order submissions are refused; malformed responses are rejected.
- Lock is idempotent, blocks late joins and responses, and computes results privately. The walkthrough cannot be skipped. Reveal images are blocked before the walkthrough.
- The walkthrough starts hidden; each newly selected item starts hidden; no class statistics appear on the projector.
- After release: correct individual rates for "always yes" and "always no" strategies; class means and n per task with an incomplete participant (faces n = 3, sequences n = 2); excluded participants are not counted; no other participant's data appears in a report.
- Rankings are hidden by default; top-1 by false-alarm rate (lower is better) and tied bottom-1 are correct; invalid metrics are rejected.
- CSV export is host-only and pseudonymous by default. Reset and delete work. Reconnection resumes progress. Trial order is randomised per participant over the same items. `DISABLE_SSE` returns 204.

**End-to-end** (`tests/e2e/classroom.spec.ts`): instructor, projector and three participants in separate browser contexts (independent storage = independent devices):
- Unique participant IDs; live dashboard and projector counts.
- A participant **reloads mid-test and resumes**; one participant stays incomplete.
- No auto-lock after everyone finishes. Lock dialog lists the unfinished participant. All screens switch to the waiting message, with the "parts you completed are saved" note for the incomplete participant.
- Walkthrough: items hidden until revealed; hidden-face image; sequence and chart reveals including the cherry-picked chart and replication; full answer key. Participants still waiting and no report visible.
- **Network-level leak scan:** every `/api/p/*` response in all three browsers, from join until release, contained no answer-key or score fields.
- Release: reports on all devices with correct n per task; projector class results (hit-rate mean 67 % = (1+0+1)/3); rankings hidden until shown, show/hide works; discussion; close → conclusion; reports remain.

Screenshots from this run are in [`docs/screenshots/`](screenshots/).

## Not verified here

See [LIMITATIONS.md](LIMITATIONS.md): real Windows machines, iOS/Safari, real phones over cellular networks, a live Zoom screen share, and Cloudflare tunnel behaviour were not tested in this environment.
