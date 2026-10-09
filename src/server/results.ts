/** Computes the results snapshot from the locked submission set. Same rules for reports, class view and rankings. */
import { mean } from "../shared/stats.js";
import { METRICS, rankParticipants, scoreTask, selectRanking, type FaceKeyItem, type ScoredResponse, type TaskScore } from "../shared/scoring.js";
import type { FaceResponse, RankingConfig, TaskId, TrialResponse } from "../shared/types.js";
import { TASK_IDS } from "../shared/types.js";
import { keyFor, loadBattery, walkthroughItems } from "./battery.js";
import type { DB } from "./db.js";

export interface ParticipantResult {
  id: string; nickname: string; consent: boolean; excluded: boolean; finished: boolean;
  includedTasks: TaskId[];
  scores: Record<TaskId, TaskScore>;
}

export interface ItemStat {
  itemId: string; number: number; signal: boolean; group: string; n: number;
  pctSaidSignal: number | null; meanConfidence: number | null;
}

export interface ClassTaskResult {
  task: TaskId;
  n: number;
  means: Record<string, number | null>;
  metricN: Record<string, number>;
  confidence: { correct: number | null; incorrect: number | null };
  items: ItemStat[];
  faceClicksOnNoise?: { itemId: string; x: number; y: number }[];
  ruleRateByProcess?: Record<string, number | null>;
}

export interface ResultsSnapshot {
  computedAt: string;
  participants: Record<string, ParticipantResult>;
  classResults: Record<TaskId, ClassTaskResult>;
  counts: { joined: number; finished: number; incomplete: number; excluded: number; declined: number };
}

interface ParticipantRow { id: string; nickname: string; consent: number; excluded: number; finished_at: string | null }

export function computeResults(db: DB, sessionId: string): ResultsSnapshot {
  const parts = db.prepare("SELECT id, nickname, consent, excluded, finished_at FROM participants WHERE session_id = ? ORDER BY joined_at").all(sessionId) as unknown as ParticipantRow[];
  const resp = db.prepare("SELECT participant_id, task, item_id, payload FROM responses WHERE session_id = ? AND practice = 0").all(sessionId) as unknown as
    { participant_id: string; task: TaskId; item_id: string; payload: string }[];
  const byP = new Map<string, ScoredResponse[]>();
  for (const r of resp) {
    if (!byP.has(r.participant_id)) byP.set(r.participant_id, []);
    byP.get(r.participant_id)!.push({ itemId: r.item_id, task: r.task, response: JSON.parse(r.payload) as TrialResponse });
  }
  const participants: Record<string, ParticipantResult> = {};
  for (const p of parts) {
    const mine = byP.get(p.id) ?? [];
    const scores = Object.fromEntries(TASK_IDS.map((t) => [t, scoreTask(t, keyFor(t), mine)])) as Record<TaskId, TaskScore>;
    const eligible = p.consent === 1 && p.excluded === 0;
    participants[p.id] = {
      id: p.id, nickname: p.nickname, consent: p.consent === 1, excluded: p.excluded === 1, finished: !!p.finished_at,
      includedTasks: eligible ? TASK_IDS.filter((t) => scores[t].complete) : [],
      scores,
    };
  }

  const classResults = {} as Record<TaskId, ClassTaskResult>;
  for (const task of TASK_IDS) {
    const inc = Object.values(participants).filter((p) => p.includedTasks.includes(task));
    const means: Record<string, number | null> = {}, metricN: Record<string, number> = {};
    for (const m of METRICS[task]) {
      const vals = inc.map((p) => p.scores[task][m.key] as number | null).filter((v): v is number => v != null);
      means[m.key as string] = mean(vals);
      metricN[m.key as string] = vals.length;
    }
    const confC = inc.map((p) => p.scores[task].meanConfCorrect).filter((v): v is number => v != null);
    const confI = inc.map((p) => p.scores[task].meanConfIncorrect).filter((v): v is number => v != null);
    const wItems = walkthroughItems(task);
    const keyById = new Map(keyFor(task).map((k) => [k.id, k]));
    const items: ItemStat[] = wItems.map((w) => {
      const rows = inc.map((p) => p.scores[task].items.find((x) => x.itemId === w.itemId)).filter((x) => !!x);
      const k = keyById.get(w.itemId)!;
      const group = k.task === "faces" ? (k.hasFace ? "face" : "noise") : k.task === "sequences" ? k.process : k.category;
      return {
        itemId: w.itemId, number: w.number, signal: rows[0]?.signal ?? (group === "face" || group === "switchy" || group === "streaky" || group === "planted"),
        group, n: rows.length,
        pctSaidSignal: rows.length ? rows.filter((r) => r.saidSignal).length / rows.length : null,
        meanConfidence: mean(rows.map((r) => r.confidence)),
      };
    });
    const out: ClassTaskResult = { task, n: inc.length, means, metricN, confidence: { correct: mean(confC), incorrect: mean(confI) }, items };
    if (task === "faces") {
      const noiseIds = new Set(keyFor("faces").filter((k) => !(k as FaceKeyItem).hasFace).map((k) => k.id));
      const incIds = new Set(inc.map((p) => p.id));
      out.faceClicksOnNoise = resp
        .filter((r) => r.task === "faces" && incIds.has(r.participant_id) && noiseIds.has(r.item_id))
        .map((r) => ({ itemId: r.item_id, resp: JSON.parse(r.payload) as FaceResponse }))
        .filter(({ resp }) => resp.face && resp.x != null && resp.y != null)
        .map(({ itemId, resp }) => ({ itemId, x: resp.x!, y: resp.y! }));
    }
    if (task === "sequences") {
      out.ruleRateByProcess = Object.fromEntries((["fair", "switchy", "streaky"] as const).map((proc) =>
        [proc, mean(inc.map((p) => p.scores.sequences.ruleRateByProcess?.[proc]).filter((v): v is number => v != null))]));
    }
    classResults[task] = out;
  }
  const all = Object.values(participants);
  return {
    computedAt: new Date().toISOString(),
    participants,
    classResults,
    counts: {
      joined: all.length,
      finished: all.filter((p) => p.finished).length,
      incomplete: all.filter((p) => !p.finished).length,
      excluded: all.filter((p) => p.excluded).length,
      declined: all.filter((p) => !p.consent).length,
    },
  };
}

export function rankingFor(snapshot: ResultsSnapshot, cfg: RankingConfig) {
  const def = METRICS[cfg.task].find((m) => m.key === cfg.metric);
  if (!def) return null;
  const rows = Object.values(snapshot.participants)
    .filter((p) => p.includedTasks.includes(cfg.task))
    .map((p) => ({ participantId: p.id, nickname: p.nickname, value: p.scores[cfg.task][def.key] as number | null }))
    .filter((r): r is { participantId: string; nickname: string; value: number } => r.value != null);
  const ranked = rankParticipants(rows, def.better);
  return {
    config: cfg, metricLabel: def.label, better: def.better, format: def.format, nRanked: ranked.length,
    rows: selectRanking(ranked, cfg).map((r) => ({ rank: r.rank, nickname: r.nickname, value: r.value })),
  };
}

/** Item-by-item review for one participant (only served after results are released). */
export function personalItemReview(score: TaskScore, task: TaskId) {
  const numbers = new Map(walkthroughItems(task).map((w) => [w.itemId, w.number]));
  const b = loadBattery();
  return score.items
    .map((it) => {
      const k = b.scored[task].find((i) => i.key.id === it.itemId)!.key;
      const group = k.task === "faces" ? (k.hasFace ? "face" : "noise") : k.task === "sequences" ? k.process : k.category;
      return { number: numbers.get(it.itemId)!, group, signal: it.signal, saidSignal: it.saidSignal, correct: it.correct, confidence: it.confidence, onTarget: it.onTarget };
    })
    .sort((a, b2) => a.number - b2.number);
}
