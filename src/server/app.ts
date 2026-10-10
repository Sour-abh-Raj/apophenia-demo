/**
 * HTTP API. Three roles, each with its own credential and its own server-shaped view:
 *   participant  -> x-participant-token  (own progress, current stimulus; own report only after release)
 *   screen       -> x-screen-key         (projector-safe aggregate view; host key also accepted)
 *   host         -> x-host-key           (full dashboard and all controls)
 * Answer keys and scores never leave the server except through the views below, each
 * of which is gated on the authoritative session state.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import { CONCLUSION_POINTS, DISCUSSION_QUESTIONS } from "../shared/content.js";
import { METRICS } from "../shared/scoring.js";
import { acceptsJoins, acceptsResponses, applyTransition, atLeast, resultsVisibleToParticipants, TRANSITIONS } from "../shared/stateMachine.js";
import type {
  ParticipantPhase, ParticipantView, ProjectorResultsMode, RankingConfig, RankingMode, SessionState, TaskId, TrialResponse, WalkthroughPointer,
} from "../shared/types.js";
import { PREDICTION_QUESTIONS, TASK_IDS, type PredictionKey, type Predictions } from "../shared/types.js";
import { mean } from "../shared/stats.js";
import { buildTrialOrder, loadBattery, parseTrialKey, revealContent, STIMULI_DIR, TASK_SUMMARY_NOTES, trialView, walkthroughItems } from "./battery.js";
import { openDb, tx, type DB } from "./db.js";
import { EventHub } from "./events.js";
import { computeResults, personalItemReview, rankingFor, type ResultsSnapshot } from "./results.js";

/* ------------------------------------------------------------------ helpers */
const now = () => new Date().toISOString();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const newSecret = () => randomBytes(24).toString("base64url");
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

interface SessionRow {
  id: string; code: string; title: string; state: SessionState; instructor_key_hash: string; projector_key_hash: string;
  walkthrough: string; projector_mode: ProjectorResultsMode; ranking: string | null; ranking_preview: string | null; notice: string | null;
  discussion_index: number; version: number;
  created_at: string; updated_at: string; opened_at: string | null; locked_at: string | null; released_at: string | null; closed_at: string | null;
}
interface ParticipantRow {
  id: string; session_id: string; nickname: string; consent: number; excluded: number; trial_order: string; cursor: number;
  joined_at: string; last_seen_at: string; finished_at: string | null; research_consent: number; predictions: string | null;
}

const DEFAULT_WALKTHROUGH: WalkthroughPointer = { task: "faces", index: 0, revealed: false, view: "item", featuredOnly: true, showClass: false };
const RANK_MODES: RankingMode[] = ["none", "top1", "top3", "bottom1", "bottom3", "topN", "bottomN", "rank", "range", "all"];

export interface AppOptions { dbPath: string; passcode: string; clientDir?: string; disableSse?: boolean; publicUrl?: string }

export function createApp(opts: AppOptions) {
  const db: DB = openDb(opts.dbPath);
  const hub = new EventHub();
  loadBattery(); // fail fast if stimuli are missing
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  // gzip everything except the live-update stream (compression would buffer Server-Sent Events).
  app.use(compression({ filter: (req, res) => req.path !== "/api/events" && compression.filter(req, res) }));
  app.use(express.json({ limit: "32kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  /* ----------------------------------------------------------- data access */
  const getSession = (id: string) => db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as SessionRow | undefined;
  const getSessionByCode = (code: string) => db.prepare("SELECT * FROM sessions WHERE code = ?").get(code.toUpperCase()) as unknown as SessionRow | undefined;
  const participantsOf = (sid: string) => db.prepare("SELECT * FROM participants WHERE session_id = ? ORDER BY joined_at").all(sid) as unknown as ParticipantRow[];
  const bump = (sid: string, fields: Record<string, unknown> = {}) => {
    const keys = Object.keys(fields);
    const sets = keys.map((k) => `${k} = ?`).concat(["version = version + 1", "updated_at = ?"]).join(", ");
    db.prepare(`UPDATE sessions SET ${sets} WHERE id = ?`).run(...(keys.map((k) => fields[k]) as never[]), now(), sid);
  };
  const audit = (sid: string, action: string, detail?: unknown) =>
    db.prepare("INSERT INTO audit_log (session_id, at, action, detail) VALUES (?, ?, ?, ?)").run(sid, now(), action, detail == null ? null : JSON.stringify(detail));
  const getSnapshot = (sid: string): ResultsSnapshot | null => {
    const row = db.prepare("SELECT payload FROM results WHERE session_id = ?").get(sid) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  };
  const storeSnapshot = (sid: string) => {
    const snap = computeResults(db, sid);
    db.prepare("INSERT INTO results (session_id, computed_at, payload) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET computed_at = excluded.computed_at, payload = excluded.payload")
      .run(sid, snap.computedAt, JSON.stringify(snap));
    return snap;
  };

  /* ----------------------------------------------------------- auth */
  const credential = (req: Request, header: string, query: string) => (req.header(header) ?? (typeof req.query[query] === "string" ? (req.query[query] as string) : "")) || "";

  const param = (req: Request, name: string) => String((req.params as Record<string, string>)[name] ?? "");
  function hostAuth(req: Request, sid = param(req, "sid")): SessionRow {
    const s = getSession(sid);
    const key = credential(req, "x-host-key", "k");
    if (!s || !key || !safeEq(sha(key), s.instructor_key_hash)) throw new HttpError(s ? 403 : 404, s ? "Invalid instructor key" : "Session not found");
    return s;
  }
  function screenAuth(req: Request, sid = param(req, "sid")): SessionRow {
    const s = getSession(sid);
    const key = credential(req, "x-screen-key", "k");
    if (!s || !key || !(safeEq(sha(key), s.projector_key_hash) || safeEq(sha(key), s.instructor_key_hash))) throw new HttpError(s ? 403 : 404, s ? "Invalid projector key" : "Session not found");
    return s;
  }
  function participantAuth(req: Request): { p: ParticipantRow; s: SessionRow } {
    const token = credential(req, "x-participant-token", "t");
    if (!token) throw new HttpError(401, "Missing participant token");
    const p = db.prepare("SELECT * FROM participants WHERE token_hash = ?").get(sha(token)) as unknown as ParticipantRow | undefined;
    if (!p) throw new HttpError(401, "Unknown participant");
    db.prepare("UPDATE participants SET last_seen_at = ? WHERE id = ?").run(now(), p.id);
    return { p, s: getSession(p.session_id)! };
  }

  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) { next(e); }
  };

  /* Simple fixed-window rate limiter for unauthenticated endpoints. Limits are generous because many students
     can share ONE public IP address (VPNs, mobile carriers, shared networks). Old windows are pruned every minute. */
  const hits = new Map<string, { n: number; t: number }>();
  setInterval(() => { const cutoff = Date.now() - 60_000; for (const [k, h] of hits) if (h.t < cutoff) hits.delete(k); }, 60_000).unref();
  const limit = (max: number) => (req: Request, _res: Response, next: NextFunction) => {
    const k = `${req.path}:${req.ip}`, t = Date.now();
    const h = hits.get(k);
    if (!h || t - h.t > 60_000) hits.set(k, { n: 1, t });
    else if (++h.n > max) return next(new HttpError(429, "Too many requests — please wait a minute"));
    next();
  };

  /* ----------------------------------------------------------- participant view */
  function participantView(p: ParticipantRow, s: SessionRow): ParticipantView {
    const order: string[] = JSON.parse(p.trial_order);
    const finished = p.cursor >= order.length;
    let phase: ParticipantPhase;
    if (s.state === "LOBBY") phase = "lobby";
    else if (s.state === "TESTING_OPEN") phase = finished ? "finished-waiting" : "testing";
    else if (s.state === "TEST_LOCKED_AWAITING_DEBRIEF" || s.state === "ANSWER_WALKTHROUGH") phase = "locked-waiting";
    else phase = "results";
    const progress = Object.fromEntries(TASK_IDS.map((t) => {
      const keys = order.map((k, i) => ({ k, i })).filter(({ k }) => k.startsWith(`${t}|`));
      return [t, { answered: keys.filter(({ i }) => i < p.cursor).length, total: keys.length }];
    })) as ParticipantView["progress"];
    return {
      session: { title: s.title, code: s.code, state: s.state },
      me: { id: p.id, nickname: p.nickname, consent: p.consent === 1, researchConsent: p.research_consent === 1, finished, answered: p.cursor, total: order.length,
        predictions: parsePredictions(p.predictions) },
      notice: s.state === "TESTING_OPEN" ? s.notice : null,
      phase,
      current: phase === "testing" ? trialView(order, p.cursor) : null,
      next: phase === "testing" ? trialView(order, p.cursor + 1) : null,
      // A few items ahead (stimuli only, never answers) so the page can advance instantly for distant students.
      upcoming: phase === "testing" ? [1, 2, 3, 4, 5].map((k) => trialView(order, p.cursor + k)).filter((t): t is NonNullable<typeof t> => !!t) : [],
      progress,
    };
  }

  /* ----------------------------------------------------------- host view */
  function participantRows(s: SessionRow) {
    const connected = hub.connectedParticipants(s.id);
    const t = Date.now();
    return participantsOf(s.id).map((p) => {
      const order: string[] = JSON.parse(p.trial_order);
      const cur = order[p.cursor] ? parseTrialKey(order[p.cursor]) : null;
      const isConnected = connected.has(p.id) || t - Date.parse(p.last_seen_at) < 12_000;
      const finished = p.cursor >= order.length;
      const status = s.state === "LOBBY" ? "lobby" : finished ? "finished" : atLeast(s.state, "TEST_LOCKED_AWAITING_DEBRIEF") ? "incomplete" : p.cursor > 0 ? "in-progress" : "joined";
      return {
        id: p.id, nickname: p.nickname, consent: p.consent === 1, excluded: p.excluded === 1, connected: isConnected,
        answered: p.cursor, total: order.length, finished, status,
        currentTask: cur?.task ?? null, currentPractice: cur?.practice ?? false,
        taskProgress: Object.fromEntries(TASK_IDS.map((tk) => {
          const idx = order.map((k, i) => ({ k, i })).filter(({ k }) => k.startsWith(`${tk}|`));
          return [tk, { answered: idx.filter(({ i }) => i < p.cursor).length, total: idx.length }];
        })),
        lastSeenSecondsAgo: Math.round((t - Date.parse(p.last_seen_at)) / 1000),
      };
    });
  }

  function aggregateCounts(s: SessionRow) {
    const rows = participantRows(s);
    // Excluded entries (test devices, abandoned duplicates) are not class members: they stay in the
    // participant table but are left out of every count, the lock warning and the projector.
    const members = rows.filter((r) => !r.excluded);
    const perTask = Object.fromEntries(TASK_IDS.map((tk) => [tk, {
      started: members.filter((r) => r.taskProgress[tk].answered > 0).length,
      completed: members.filter((r) => r.taskProgress[tk].answered >= r.taskProgress[tk].total).length,
    }])) as Record<TaskId, { started: number; completed: number }>;
    const unfinished = members.filter((r) => !r.finished);
    const counts = {
      joined: members.length,
      notStarted: s.state === "TESTING_OPEN" ? members.filter((r) => r.answered === 0).length : 0,
      takingTest: members.filter((r) => r.status === "in-progress").length,
      finished: members.filter((r) => r.finished).length,
      incomplete: atLeast(s.state, "TEST_LOCKED_AWAITING_DEBRIEF") ? unfinished.length : 0,
      notFinishedYet: unfinished.length,
      connected: members.filter((r) => r.connected).length,
      disconnected: members.filter((r) => !r.connected).length,
      declined: members.filter((r) => !r.consent).length,
      excluded: rows.length - members.length,
    };
    return { rows, counts, perTask, unfinishedNames: unfinished.map((r) => r.nickname) };
  }

  function sessionMeta(s: SessionRow) {
    return {
      id: s.id, code: s.code, title: s.title, state: s.state, version: s.version,
      walkthrough: JSON.parse(s.walkthrough) as WalkthroughPointer,
      projectorMode: s.projector_mode, ranking: s.ranking ? (JSON.parse(s.ranking) as RankingConfig) : null, discussionIndex: s.discussion_index,
      createdAt: s.created_at, openedAt: s.opened_at, lockedAt: s.locked_at, releasedAt: s.released_at, closedAt: s.closed_at,
    };
  }

  function walkthroughPayload(s: SessionRow, forHost: boolean) {
    const ptr = JSON.parse(s.walkthrough) as WalkthroughPointer;
    const all = walkthroughItems(ptr.task);
    const list = ptr.featuredOnly ? all.filter((i) => i.featured) : all;
    const idx = Math.min(Math.max(0, ptr.index), list.length - 1);
    const item = list[idx];
    const assetBase = `/api/screen/${s.id}/asset`;
    const base = {
      pointer: { ...ptr, index: idx }, total: list.length, totalAll: all.length,
      item: { number: item.number, itemId: item.itemId, stimulus: item.stimulus, featured: item.featured },
      reveal: ptr.revealed ? revealContent(ptr.task, item.itemId, assetBase) : null,
      classAnswer: ptr.revealed && ptr.showClass ? classAnswerFor(s.id, ptr.task, item.itemId) : null,
      summary: ptr.view === "summary"
        ? { notes: TASK_SUMMARY_NOTES[ptr.task], items: all.map((w) => ({ number: w.number, stimulus: w.stimulus, reveal: revealContent(ptr.task, w.itemId, assetBase) })) }
        : null,
    };
    if (!forHost) return base;
    // The instructor additionally sees the answer for the current item before revealing it, and the navigation list.
    return {
      ...base,
      preview: revealContent(ptr.task, item.itemId, assetBase),
      list: list.map((w, i) => ({ i, number: w.number, featured: w.featured, truth: revealContent(ptr.task, w.itemId, assetBase)?.truthLabel })),
    };
  }

  /** How the (included) class answered one item: aggregate only, from the snapshot frozen at lock. */
  function classAnswerFor(sid: string, task: TaskId, itemId: string) {
    const it = getSnapshot(sid)?.classResults[task].items.find((i) => i.itemId === itemId);
    if (!it || it.pctSaidSignal == null) return null;
    return { n: it.n, saidSignal: Math.round(it.pctSaidSignal * it.n), pctSaidSignal: it.pctSaidSignal };
  }

  /** Class predictions (consenting, non-excluded participants) next to the truth. */
  function predictionSummary(sid: string) {
    const rows = participantsOf(sid).filter((p) => p.consent === 1 && p.excluded === 0);
    return Object.fromEntries((Object.keys(PREDICTION_QUESTIONS) as PredictionKey[]).map((k) => {
      const vals = rows.map((p) => parsePredictions(p.predictions)[k]).filter((v): v is number => Number.isInteger(v)).sort((a, b) => a - b);
      return [k, { n: vals.length, mean: mean(vals), median: vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null, truth: PREDICTION_QUESTIONS[k].truth, max: PREDICTION_QUESTIONS[k].max }];
    }));
  }

  /* ----------------------------------------------------------- routes: public */
  app.get("/api/health", (_req, res) => { res.json({ ok: true }); });

  app.post("/api/sessions", limit(20), wrap((req) => {
    const { title, passcode } = req.body ?? {};
    if (typeof passcode !== "string" || !safeEq(sha(passcode), sha(opts.passcode))) throw new HttpError(403, "Incorrect instructor passcode");
    const t = typeof title === "string" && title.trim() ? title.trim().slice(0, 80) : "Perception & Judgment Lab";
    const id = randomUUID(), hostKey = newSecret(), screenKey = newSecret();
    let code = newCode();
    while (getSessionByCode(code)) code = newCode();
    const ts = now();
    db.prepare(`INSERT INTO sessions (id, code, title, state, instructor_key_hash, projector_key_hash, walkthrough, created_at, updated_at)
                VALUES (?, ?, ?, 'LOBBY', ?, ?, ?, ?, ?)`).run(id, code, t, sha(hostKey), sha(screenKey), JSON.stringify(DEFAULT_WALKTHROUGH), ts, ts);
    audit(id, "create", { title: t });
    return { sessionId: id, code, hostKey, screenKey };
  }));

  app.get("/api/lookup/:code", limit(1200), wrap((req) => {
    const s = getSessionByCode(String(req.params.code));
    if (!s) throw new HttpError(404, "No session with that code. Check the code, or ask your instructor for the current link.");
    return { title: s.title, joinable: acceptsJoins(s.state), state: s.state };
  }));

  app.post("/api/join", limit(400), wrap((req) => {
    const { code, nickname, consent, researchConsent } = req.body ?? {};
    const s = typeof code === "string" ? getSessionByCode(code.trim()) : undefined;
    if (!s) throw new HttpError(404, "No session with that code. Check the code, or ask your instructor for the current link.");
    if (!acceptsJoins(s.state)) throw new HttpError(409, "This activity is closed to new participants");
    let nick = typeof nickname === "string" ? nickname.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24) : "";
    if (!nick) throw new HttpError(400, "Please choose a nickname");
    const taken = new Set(participantsOf(s.id).map((p) => p.nickname.toLowerCase()));
    if (taken.has(nick.toLowerCase())) {
      let k = 2;
      while (taken.has(`${nick} ${k}`.toLowerCase())) k++;
      nick = `${nick} ${k}`;
    }
    const id = randomUUID(), token = newSecret(), ts = now();
    db.prepare(`INSERT INTO participants (id, session_id, token_hash, nickname, consent, research_consent, trial_order, joined_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, s.id, sha(token), nick, consent === false ? 0 : 1, researchConsent === true ? 1 : 0, JSON.stringify(buildTrialOrder(id)), ts, ts);
    hub.notify(s.id, "staff");
    return { participantId: id, token, nickname: nick };
  }));

  /* ----------------------------------------------------------- routes: participant */
  app.get("/api/p/me", wrap((req) => {
    const { p, s } = participantAuth(req);
    return participantView(p, s);
  }));

  app.post("/api/p/consent", wrap((req) => {
    const { p, s } = participantAuth(req);
    if (!acceptsJoins(s.state)) throw new HttpError(409, "The activity is locked; consent can no longer be changed here — ask the instructor.");
    db.prepare("UPDATE participants SET consent = ? WHERE id = ?").run(req.body?.consent ? 1 : 0, p.id);
    hub.notify(s.id, "staff");
    return participantView({ ...p, consent: req.body?.consent ? 1 : 0 }, s);
  }));

  /** Prediction while waiting: open once a participant has finished (or the test is locked), until results are released. */
  app.post("/api/p/predict", wrap((req) => {
    const { p, s } = participantAuth(req);
    const finished = p.cursor >= (JSON.parse(p.trial_order) as string[]).length;
    const open = (s.state === "TESTING_OPEN" && finished) || s.state === "TEST_LOCKED_AWAITING_DEBRIEF" || s.state === "ANSWER_WALKTHROUGH";
    if (!open) throw new HttpError(409, "Predictions are not open right now");
    const cur = parsePredictions(p.predictions);
    for (const k of Object.keys(PREDICTION_QUESTIONS) as PredictionKey[]) {
      const v = req.body?.[k];
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < 0 || v > PREDICTION_QUESTIONS[k].max) throw new HttpError(400, "Invalid prediction");
      cur[k] = v;
    }
    db.prepare("UPDATE participants SET predictions = ? WHERE id = ?").run(JSON.stringify(cur), p.id);
    hub.notify(s.id, "staff");
    return participantView({ ...p, predictions: JSON.stringify(cur) }, s);
  }));

  app.post("/api/p/respond", wrap((req) => {
    const { p, s } = participantAuth(req);
    const { trialKey, response, rtMs } = req.body ?? {};
    if (!acceptsResponses(s.state)) throw new HttpError(409, "The activity is not accepting responses", { view: participantView(p, s) });
    const order: string[] = JSON.parse(p.trial_order);
    if (typeof trialKey !== "string") throw new HttpError(400, "Missing trialKey");
    const existing = db.prepare("SELECT 1 FROM responses WHERE participant_id = ? AND trial_key = ?").get(p.id, trialKey);
    if (existing) return { duplicate: true, view: participantView(p, s) }; // retry after a dropped connection: idempotent
    if (order[p.cursor] !== trialKey) throw new HttpError(409, "Out-of-order response", { view: participantView(p, s) });
    const parsed = parseTrialKey(trialKey)!;
    const clean = validateResponse(parsed.task, response);
    if (!clean) throw new HttpError(400, "Invalid response");
    const rt = Number.isFinite(rtMs) ? Math.max(0, Math.min(600_000, Math.round(rtMs))) : null;
    const updated = tx(db, () => {
      db.prepare(`INSERT INTO responses (participant_id, session_id, trial_key, task, practice, item_id, payload, rt_ms, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, s.id, trialKey, parsed.task, parsed.practice ? 1 : 0, parsed.itemId, JSON.stringify(clean), rt, now());
      const cursor = p.cursor + 1;
      db.prepare("UPDATE participants SET cursor = ?, finished_at = ? WHERE id = ?").run(cursor, cursor >= order.length ? now() : null, p.id);
      return { ...p, cursor };
    });
    hub.notify(s.id, "staff"); // participant progress changes only the staff views — never the session state
    return { duplicate: false, view: participantView(updated, s) };
  }));

  app.get("/api/p/report", wrap((req) => {
    const { p, s } = participantAuth(req);
    if (!resultsVisibleToParticipants(s.state)) throw new HttpError(403, "Results have not been released yet");
    const snap = getSnapshot(s.id);
    if (!snap) throw new HttpError(500, "Results unavailable");
    const mine = snap.participants[p.id];
    return {
      nickname: p.nickname,
      consent: p.consent === 1,
      excluded: p.excluded === 1,
      predictions: { mine: parsePredictions(p.predictions), class: predictionSummary(s.id) },
      tasks: TASK_IDS.map((task) => {
        const sc = mine.scores[task];
        const cls = snap.classResults[task];
        const { items: _omit, ...scoreNoItems } = sc;
        return {
          task,
          includedInClass: mine.includedTasks.includes(task),
          score: scoreNoItems,
          review: personalItemReview(sc, task),
          classN: cls.n,
          classMeans: cls.means,
          classMetricN: cls.metricN,
          classConfidence: cls.confidence,
          classRuleRateByProcess: cls.ruleRateByProcess ?? null,
          metrics: METRICS[task],
        };
      }),
    };
  }));

  /* ----------------------------------------------------------- routes: host */
  app.get("/api/host/:sid", wrap((req) => {
    const s = hostAuth(req);
    const { rows, counts, perTask, unfinishedNames } = aggregateCounts(s);
    const snap = atLeast(s.state, "TEST_LOCKED_AWAITING_DEBRIEF") ? getSnapshot(s.id) : null;
    const ranking = s.ranking && snap ? rankingFor(snap, JSON.parse(s.ranking)) : null;
    const rankingPreview = s.ranking_preview && snap ? rankingFor(snap, JSON.parse(s.ranking_preview)) : null;
    return {
      session: { ...sessionMeta(s), notice: s.notice, publicUrl: opts.publicUrl ?? null },
      counts, perTask, participants: rows, unfinishedNames, rankingPreview, predictions: predictionSummary(s.id),
      results: snap ? { classResults: snap.classResults, counts: snap.counts, computedAt: snap.computedAt,
        participants: Object.values(snap.participants).map((p) => ({
          id: p.id, nickname: p.nickname, includedTasks: p.includedTasks, finished: p.finished, consent: p.consent, excluded: p.excluded,
          scores: Object.fromEntries(TASK_IDS.map((t) => { const { items: _i, ...rest } = p.scores[t]; return [t, rest]; })),
        })) } : null,
      ranking,
      metrics: METRICS,
      walkthrough: s.state === "ANSWER_WALKTHROUGH" || atLeast(s.state, "ANSWER_WALKTHROUGH") ? walkthroughPayload(s, true) : null,
      transitions: TRANSITIONS,
      discussion: DISCUSSION_QUESTIONS, conclusion: CONCLUSION_POINTS,
    };
  }));

  app.post("/api/host/:sid/transition", wrap((req) => {
    const s = hostAuth(req);
    const action = String(req.body?.action ?? "");
    const r = applyTransition(s.state, action);
    if (!r.ok) throw new HttpError(409, r.error, { state: r.state });
    if (r.changed) {
      tx(db, () => {
        const fields: Record<string, unknown> = { state: r.state };
        if (action === "open") fields.opened_at = now();
        if (action === "lock") fields.locked_at = now();
        if (action === "reopen") { fields.locked_at = null; db.prepare("DELETE FROM results WHERE session_id = ?").run(s.id); }
        if (action === "beginWalkthrough") fields.walkthrough = JSON.stringify(DEFAULT_WALKTHROUGH);
        if (action === "releaseResults") { fields.released_at = now(); fields.projector_mode = "results"; fields.ranking = null; }
        if (action === "close") { fields.closed_at = now(); fields.projector_mode = "conclusion"; }
        bump(s.id, fields);
        // Freeze the submission set and compute scores at lock time (stored privately; not displayed).
        if (action === "lock") storeSnapshot(s.id);
        audit(s.id, action);
      });
      hub.notify(s.id, "all");
    }
    return { ok: true, changed: r.changed, state: r.state };
  }));

  app.post("/api/host/:sid/walkthrough", wrap((req) => {
    const s = hostAuth(req);
    if (s.state !== "ANSWER_WALKTHROUGH") throw new HttpError(409, "Walkthrough is only available during the ANSWER_WALKTHROUGH phase");
    const cur = JSON.parse(s.walkthrough) as WalkthroughPointer;
    const b = req.body ?? {};
    const next: WalkthroughPointer = {
      task: TASK_IDS.includes(b.task) ? b.task : cur.task,
      index: Number.isInteger(b.index) ? Math.max(0, b.index) : cur.index,
      revealed: typeof b.revealed === "boolean" ? b.revealed : cur.revealed,
      view: b.view === "summary" || b.view === "item" ? b.view : cur.view,
      featuredOnly: typeof b.featuredOnly === "boolean" ? b.featuredOnly : cur.featuredOnly,
      showClass: typeof b.showClass === "boolean" ? b.showClass : !!cur.showClass,
    };
    if (next.task !== cur.task && !Number.isInteger(b.index)) next.index = 0;
    // Any move (another item, task, list, or back from the answer key) starts hidden; only an explicit "Reveal" shows the answer.
    const moved = next.task !== cur.task || next.index !== cur.index || next.view !== cur.view || next.featuredOnly !== cur.featuredOnly;
    if (moved && typeof b.revealed !== "boolean") next.revealed = false;
    const len = (next.featuredOnly ? walkthroughItems(next.task).filter((i) => i.featured) : walkthroughItems(next.task)).length;
    next.index = Math.min(next.index, len - 1);
    bump(s.id, { walkthrough: JSON.stringify(next) });
    hub.notify(s.id, "staff");
    return { ok: true, walkthrough: next };
  }));

  app.post("/api/host/:sid/projector", wrap((req) => {
    const s = hostAuth(req);
    if (!resultsVisibleToParticipants(s.state)) throw new HttpError(409, "Projector result modes are available after results are released");
    const mode = req.body?.mode as ProjectorResultsMode;
    if (!["results", "rankings", "discussion", "conclusion"].includes(mode)) throw new HttpError(400, "Invalid mode");
    if (mode === "rankings" && !s.ranking) throw new HttpError(409, "Choose a ranking first");
    const di = Number.isInteger(req.body?.discussionIndex) ? Math.max(0, Math.min(DISCUSSION_QUESTIONS.length - 1, req.body.discussionIndex)) : s.discussion_index;
    bump(s.id, { projector_mode: mode, discussion_index: di });
    hub.notify(s.id, "staff");
    return { ok: true };
  }));

  app.post("/api/host/:sid/ranking", wrap((req) => {
    const s = hostAuth(req);
    if (s.state !== "RESULTS_RELEASED") throw new HttpError(409, "Rankings can only be disclosed after results are released");
    const cfg = req.body?.config as RankingConfig | null;
    if (cfg == null || cfg.mode === "none") {
      bump(s.id, { ranking: null, ranking_preview: null, projector_mode: s.projector_mode === "rankings" ? "results" : s.projector_mode });
      hub.notify(s.id, "staff");
      return { ok: true, ranking: null };
    }
    if (!RANK_MODES.includes(cfg.mode) || !TASK_IDS.includes(cfg.task) || !METRICS[cfg.task].some((m) => m.key === cfg.metric)) throw new HttpError(400, "Invalid ranking configuration");
    const clean: RankingConfig = { mode: cfg.mode, task: cfg.task, metric: cfg.metric };
    for (const k of ["n", "rank", "from", "to"] as const) if (Number.isInteger(cfg[k]) && (cfg[k] as number) > 0) clean[k] = cfg[k];
    // "Preview privately" only changes the dashboard copy; whatever the projector shows stays as it is.
    if (req.body?.show === false) bump(s.id, { ranking_preview: JSON.stringify(clean) });
    else bump(s.id, { ranking: JSON.stringify(clean), ranking_preview: null, projector_mode: "rankings" });
    audit(s.id, req.body?.show === false ? "ranking-preview" : "ranking", clean);
    hub.notify(s.id, "staff");
    return { ok: true, ranking: clean };
  }));

  /** "Please finish up" notice on students' screens (testing only). An empty text clears it. */
  app.post("/api/host/:sid/notice", wrap((req) => {
    const s = hostAuth(req);
    if (s.state !== "TESTING_OPEN") throw new HttpError(409, "Notices can only be sent while the test is open");
    const text = typeof req.body?.text === "string" ? req.body.text.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 140) : "";
    bump(s.id, { notice: text || null });
    audit(s.id, "notice", { text: text || null });
    hub.notify(s.id, "all");
    return { ok: true, notice: text || null };
  }));

  app.post("/api/host/:sid/participants/:pid/exclude", wrap((req) => {
    const s = hostAuth(req);
    const pid = param(req, "pid");
    const p = db.prepare("SELECT id FROM participants WHERE id = ? AND session_id = ?").get(pid, s.id);
    if (!p) throw new HttpError(404, "Participant not found");
    db.prepare("UPDATE participants SET excluded = ? WHERE id = ?").run(req.body?.excluded ? 1 : 0, pid);
    if (atLeast(s.state, "TEST_LOCKED_AWAITING_DEBRIEF")) storeSnapshot(s.id);
    audit(s.id, "exclude", { pid, excluded: !!req.body?.excluded });
    bump(s.id);
    hub.notify(s.id, "all");
    return { ok: true };
  }));

  app.get("/api/host/:sid/export.csv", (req, res, next) => {
    try {
      const s = hostAuth(req);
      const withNick = req.query.nicknames === "1";
      const parts = participantsOf(s.id);
      const code = new Map(parts.map((p, i) => [p.id, `P${String(i + 1).padStart(2, "0")}`]));
      const pmap = new Map(parts.map((p) => [p.id, p]));
      const numbers = new Map<string, number>();
      for (const t of TASK_IDS) for (const w of walkthroughItems(t)) numbers.set(`${t}|${w.itemId}`, w.number);
      const b = loadBattery();
      const rows = db.prepare("SELECT * FROM responses WHERE session_id = ? AND practice = 0 ORDER BY participant_id, created_at").all(s.id) as unknown as
        { participant_id: string; task: TaskId; item_id: string; payload: string; rt_ms: number | null }[];
      const header = ["participant", ...(withNick ? ["nickname"] : []), "consent", "research_consent", "excluded", "finished", "task", "item_number", "item_id", "truth", "response", "confidence",
        "click_x", "click_y", "rt_ms", "prediction_faces", "prediction_charts", "session_code", "session_opened_at"];
      const esc = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
      const lines = [header.join(",")];
      for (const r of rows) {
        const p = pmap.get(r.participant_id)!;
        const k = b.scored[r.task].find((i) => i.key.id === r.item_id)!.key;
        const truth = k.task === "faces" ? (k.hasFace ? "face" : "noise") : k.task === "sequences" ? k.process : k.category;
        const resp = JSON.parse(r.payload) as TrialResponse & { face?: boolean; judgment?: string; x?: number; y?: number };
        const answer = r.task === "faces" ? (resp.face ? "face" : "no face") : resp.judgment;
        const pred = parsePredictions(p.predictions);
        lines.push([code.get(p.id), ...(withNick ? [p.nickname] : []), p.consent, p.research_consent, p.excluded, p.finished_at ? 1 : 0, r.task, numbers.get(`${r.task}|${r.item_id}`), r.item_id, truth, answer, resp.confidence,
          resp.x != null ? resp.x.toFixed(3) : "", resp.y != null ? resp.y.toFixed(3) : "", r.rt_ms, pred.faces ?? "", pred.charts ?? "", s.code, s.opened_at ?? ""].map(esc).join(","));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="apophenia-lab-${s.code}.csv"`);
      res.send(lines.join("\n") + "\n");
    } catch (e) { next(e); }
  });

  app.post("/api/host/:sid/reset", wrap((req) => {
    const s = hostAuth(req);
    if (req.body?.confirm !== "RESET") throw new HttpError(400, "Confirmation required");
    tx(db, () => {
      db.prepare("DELETE FROM participants WHERE session_id = ?").run(s.id);
      db.prepare("DELETE FROM results WHERE session_id = ?").run(s.id);
      bump(s.id, { state: "LOBBY", walkthrough: JSON.stringify(DEFAULT_WALKTHROUGH), ranking: null, ranking_preview: null, notice: null, projector_mode: "results", discussion_index: 0,
        opened_at: null, locked_at: null, released_at: null, closed_at: null });
      audit(s.id, "reset");
    });
    hub.notify(s.id, "all");
    return { ok: true };
  }));

  app.delete("/api/host/:sid", wrap((req) => {
    const s = hostAuth(req);
    if (req.body?.confirm !== "DELETE") throw new HttpError(400, "Confirmation required");
    tx(db, () => {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
      db.prepare("DELETE FROM audit_log WHERE session_id = ?").run(s.id);
    });
    hub.notify(s.id, "all");
    setTimeout(() => hub.closeSession(s.id), 200);
    return { ok: true };
  }));

  /* ----------------------------------------------------------- routes: projector */
  app.get("/api/screen/:sid", wrap((req) => {
    const s = screenAuth(req);
    const { counts, perTask } = aggregateCounts(s);
    const base = {
      session: { title: s.title, code: s.code, state: s.state, projectorMode: s.projector_mode, discussionIndex: s.discussion_index, publicUrl: opts.publicUrl ?? null },
      counts: { joined: counts.joined, notStarted: counts.notStarted, takingTest: counts.takingTest, finished: counts.finished, connected: counts.connected, incomplete: counts.incomplete },
      perTask,
    };
    if (s.state === "ANSWER_WALKTHROUGH") return { ...base, walkthrough: walkthroughPayload(s, false) };
    if (resultsVisibleToParticipants(s.state)) {
      const snap = getSnapshot(s.id)!;
      const ranking = s.ranking && s.projector_mode === "rankings" ? rankingFor(snap, JSON.parse(s.ranking)) : null;
      return { ...base, results: { classResults: snap.classResults, counts: snap.counts }, predictions: predictionSummary(s.id), metrics: METRICS, ranking,
        discussion: DISCUSSION_QUESTIONS, conclusion: CONCLUSION_POINTS };
    }
    return base;
  }));

  /** Reveal-only images (the hidden face without noise). Only after the walkthrough has begun. */
  app.get("/api/screen/:sid/asset/:file", (req, res, next) => {
    try {
      const s = screenAuth(req);
      if (!atLeast(s.state, "ANSWER_WALKTHROUGH")) throw new HttpError(403, "Not available yet");
      const f = String(req.params.file);
      if (!/^[0-9a-f]{12}-face\.webp$/.test(f)) throw new HttpError(404, "Not found");
      const path = resolve(STIMULI_DIR, "private_faces", f);
      if (!existsSync(path)) throw new HttpError(404, "Not found");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.sendFile(path);
    } catch (e) { next(e); }
  });

  /* ----------------------------------------------------------- live updates */
  app.get("/api/events", (req, res, next) => {
    // 204 tells EventSource not to reconnect; clients then rely on polling (useful behind tunnels with connection limits).
    if (opts.disableSse) { res.status(204).end(); return; }
    try {
      const role = String(req.query.role);
      if (role === "participant") {
        const { p, s } = participantAuth(req);
        hub.add(s.id, { res, role, participantId: p.id });
      } else if (role === "host") {
        const s = hostAuth(req, String(req.query.sid));
        hub.add(s.id, { res, role });
      } else if (role === "screen") {
        const s = screenAuth(req, String(req.query.sid));
        hub.add(s.id, { res, role });
      } else throw new HttpError(400, "Unknown role");
    } catch (e) { next(e); }
  });

  /* ----------------------------------------------------------- static */
  app.use("/stim/faces", express.static(resolve(STIMULI_DIR, "faces"), { maxAge: "1h", index: false }));
  if (opts.clientDir && existsSync(opts.clientDir)) {
    // Vite gives built files content-hashed names, so they can be cached "forever". The HTML shell must
    // always be revalidated, otherwise a browser could keep loading an old version after a redeploy.
    app.use(express.static(opts.clientDir, {
      index: false,
      setHeaders: (res, path) => res.setHeader("Cache-Control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache"),
    }));
    app.get(/^\/(?!api\/|stim\/).*/, (_req, res) => { res.setHeader("Cache-Control", "no-cache"); res.sendFile(resolve(opts.clientDir!, "index.html")); });
  }

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
    if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON" });
    console.error(err);
    res.status(500).json({ error: "Internal error" });
  });

  return { app, db, hub };
}

/* ------------------------------------------------------------------ validation */
function parsePredictions(raw: string | null): Predictions {
  if (!raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

function validateResponse(task: TaskId, r: unknown): TrialResponse | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const conf = o.confidence;
  if (conf !== 1 && conf !== 2 && conf !== 3) return null;
  if (task === "faces") {
    if (typeof o.face !== "boolean") return null;
    if (!o.face) return { face: false, confidence: conf };
    const x = Number(o.x), y = Number(o.y);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
    return { face: true, x, y, confidence: conf };
  }
  if (task === "sequences") return o.judgment === "random" || o.judgment === "rule" ? { judgment: o.judgment, confidence: conf } : null;
  return o.judgment === "related" || o.judgment === "unrelated" ? { judgment: o.judgment, confidence: conf } : null;
}
