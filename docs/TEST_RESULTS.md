# Test record

Latest run: 2026-10-10, build container (Linux, Node 22.22.0, Playwright 1.56.1 with its bundled Chromium).

| Check | Command | Result |
|---|---|---|
| Type checking (client + server) | `npm run typecheck` | ✅ no errors |
| Unit, stimulus-integrity, concealment and API-security tests | `npm test` | ✅ 46 / 46 passed |
| Production build | `npm run build` | ✅ |
| Browser tests: full class, regressions, results correctness | `npm run test:e2e` | ✅ 5 / 5 passed (≈1.5 min) |
| Results audit: 5 students (random answers, 1 incomplete, 1 opted out), every figure recomputed independently from the CSV | scripted (Python) | ✅ 0 mismatches across projector, dashboard and all reports |
| Render-like production run (`PORT`, `RENDER_EXTERNAL_URL`, no `.env`) | manual, see below | ✅ |
| Load test: 80 students answering simultaneously | scripted | ✅ 3,840 answers in 6 s, 0 errors |

## Performance (measured)

| | Before | After |
|---|---|---|
| Face images a student downloads (22 images) | 2.0 MB PNG | **0.7 MB WebP** |
| JavaScript a student downloads (gzip) | 113 KB (whole app) | **93 KB** (instructor/projector code split off) |
| App files on repeat visits | revalidated hourly | cached for a year (content-hashed names); page shell always fresh |
| API / JSON responses | uncompressed | gzip (live-update stream excluded so it still streams) |
| Answer submission under an 80-student burst | — | p50 117 ms, p95 170 ms |
| Locking + scoring 80 students | — | 25 ms |
| Distant student (400 ms latency, 1.5 Mbps): answer → next item | 0.7–0.8 s | **0.25–0.4 s** (next items preloaded; answers saved in order in the background) |
| Distant student: first page load / join → first task | — | 1.4 s / 1.3 s |

## What the automated tests cover

- **Experimental integrity:** manifest vs files (420×420 WebP, opaque names); faces have in-bounds locations and private reveal images; regeneration from seeds reproduces the manifest exactly and the images exactly (or, with another libwebp build, to within 2/255 mean pixel difference); coin and chart generating processes, selection rules and stored statistics; scoring, d′, exact run probabilities, rankings and all disclosure modes.
- **Concealment:** nothing students or the projector see before the walkthrough names or hints at the concept.
- **Delayed reveal & security:** passcode; wrong/forged/cross-role/cross-session keys rejected; no answer-key or score fields in any student payload before release; no auto-lock; idempotent and ordered responses; lock/walkthrough/release gating; walkthrough starts hidden after every move; correct per-student and class figures with incomplete, opted-out and excluded students; rankings; CSV; reset/delete; reconnection; polling-only mode; **150 students joining from one shared IP**.
- **Browser (real Chromium):** instructor + projector + three students through the whole class, including a mid-test reload and an incomplete student; network-level leak scan of every student response until release; copy buttons including the non-https fallback; the instructor notice reaching a finished student and a student on the last item; walkthrough reset on next / task switch / answer key / featured toggle / keyboard; the full answer key without overlap or horizontal scrolling at 1920×1080, 1280×720, 1024×768, 800×600 and phone width; a distant student (400 ms latency) advancing without waiting while every answer is stored in order; **results**: the projector, open from the lobby, switches to the class results within seconds of release and every number on it and in every student's report matches an independent recomputation from the CSV; excluding a student after release updates the projector and open reports live; the dashboard shows whether a projector window for this session is open.
- **Production build as Render runs it:** fresh clone → `npm ci` → build → `npm prune --omit=dev` → start with `NODE_ENV=production`, Render's `PORT` and a not-yet-existing database folder; 30-student run with 0 errors. (The Docker image itself could not be built here: no Docker engine in the build environment.)

## Render-like production run (manual)

`PORT=10000 RENDER_EXTERNAL_URL=https://perception-lab.onrender.com npm start`: the page shell is served `no-cache`; hashed assets `max-age=31536000, immutable` and gzip; images `image/webp`; the dashboard's join link and QR use the Render URL automatically; Server-Sent Events stream uncompressed.

## Not verified here

See [LIMITATIONS.md](LIMITATIONS.md): an actual Render deployment (render.com is unreachable from the build environment), real Windows machines, iOS/Safari, phones on cellular networks and a live Zoom screen share. Do the rehearsal in the README once it is deployed.
