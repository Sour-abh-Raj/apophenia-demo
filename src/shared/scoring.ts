/**
 * Task-specific scoring. Pure functions shared by server (authoritative) and tests.
 * There is deliberately NO combined "apophenia score": each task is scored on its own
 * signal-detection terms (see docs/DESIGN.md §Scoring).
 */
import { mean, sdt } from "./stats.js";
import type { ChartResponse, FaceResponse, RankingConfig, SequenceResponse, TaskId, TrialResponse } from "./types.js";

/* ---------------- answer-key item types (server-side only at runtime) ---------------- */
export interface FaceKeyItem {
  task: "faces"; id: string; hasFace: boolean;
  face?: { cx: number; cy: number; rx: number; ry: number; contrast: number; difficulty: string };
}
export interface SequenceKeyItem {
  task: "sequences"; id: string; flips: string; process: "fair" | "switchy" | "streaky"; truth: "random" | "rule";
  alternations: number; longestRun: number; heads: number; idealPosteriorFair: number; pAlternate: number;
}
export interface ChartKeyItem {
  task: "charts"; id: string; category: "planted" | "independent" | "selected"; truth: "related" | "unrelated";
  sampleR: number; trueRho: number;
}
export type KeyItem = FaceKeyItem | SequenceKeyItem | ChartKeyItem;

export interface ScoredResponse { itemId: string; task: TaskId; response: TrialResponse }

/** Localisation tolerance: a click counts as "on the face" within 1.3x the face ellipse. */
export const LOCALISATION_TOLERANCE = 1.3;

export function isSignal(item: KeyItem): boolean {
  if (item.task === "faces") return item.hasFace;
  if (item.task === "sequences") return item.truth === "rule";
  return item.truth === "related";
}
export function saidSignal(task: TaskId, r: TrialResponse): boolean {
  if (task === "faces") return (r as FaceResponse).face;
  if (task === "sequences") return (r as SequenceResponse).judgment === "rule";
  return (r as ChartResponse).judgment === "related";
}
export function faceClickOnTarget(item: FaceKeyItem, r: FaceResponse): boolean {
  if (!item.face || !r.face || r.x == null || r.y == null) return false;
  const dx = (r.x - item.face.cx) / item.face.rx, dy = (r.y - item.face.cy) / item.face.ry;
  return Math.sqrt(dx * dx + dy * dy) <= LOCALISATION_TOLERANCE;
}

export interface TaskScore {
  task: TaskId;
  complete: boolean;
  answered: number;
  nTrials: number;
  nSignal: number;
  nNoise: number;
  hits: number; misses: number; falseAlarms: number; correctRejections: number;
  accuracy: number | null;
  hitRate: number | null;
  falseAlarmRate: number | null;
  dPrime: number | null;
  criterion: number | null;
  meanConfidence: number | null;
  meanConfCorrect: number | null;
  meanConfIncorrect: number | null;
  /** task-specific extras */
  localizationRate?: number | null; localized?: number;
  ruleRateByProcess?: Record<"fair" | "switchy" | "streaky", number | null>;
  faRateIndependent?: number | null; faRateSelected?: number | null;
  items: { itemId: string; signal: boolean; saidSignal: boolean; correct: boolean; confidence: number; onTarget?: boolean }[];
}

export function scoreTask(task: TaskId, key: KeyItem[], responses: ScoredResponse[]): TaskScore {
  const byId = new Map(responses.filter((r) => r.task === task).map((r) => [r.itemId, r.response]));
  const items: TaskScore["items"] = [];
  let hits = 0, misses = 0, fas = 0, crs = 0, localized = 0;
  const nSignal = key.filter(isSignal).length, nNoise = key.length - nSignal;
  for (const item of key) {
    const r = byId.get(item.id);
    if (!r) continue;
    const sig = isSignal(item), said = saidSignal(task, r);
    if (sig && said) hits++; else if (sig) misses++; else if (said) fas++; else crs++;
    const row: TaskScore["items"][number] = { itemId: item.id, signal: sig, saidSignal: said, correct: sig === said, confidence: r.confidence };
    if (item.task === "faces" && sig && said) {
      row.onTarget = faceClickOnTarget(item, r as FaceResponse);
      if (row.onTarget) localized++;
    }
    items.push(row);
  }
  const answered = items.length;
  const complete = answered === key.length;
  const conf = (rows: typeof items) => mean(rows.map((x) => x.confidence));
  const score: TaskScore = {
    task, complete, answered, nTrials: key.length, nSignal, nNoise,
    hits, misses, falseAlarms: fas, correctRejections: crs,
    accuracy: complete ? (hits + crs) / key.length : null,
    hitRate: complete ? hits / nSignal : null,
    falseAlarmRate: complete ? fas / nNoise : null,
    dPrime: null, criterion: null,
    meanConfidence: conf(items),
    meanConfCorrect: conf(items.filter((x) => x.correct)),
    meanConfIncorrect: conf(items.filter((x) => !x.correct)),
    items,
  };
  if (complete) Object.assign(score, sdt(hits, nSignal, fas, nNoise));
  if (task === "faces") {
    score.localized = localized;
    score.localizationRate = complete && hits > 0 ? localized / hits : null;
  }
  if (task === "sequences") {
    const rate = (proc: string) => {
      const ids = new Set((key as SequenceKeyItem[]).filter((k) => k.process === proc).map((k) => k.id));
      const rows = items.filter((x) => ids.has(x.itemId));
      return complete && rows.length ? rows.filter((x) => x.saidSignal).length / rows.length : null;
    };
    score.ruleRateByProcess = { fair: rate("fair"), switchy: rate("switchy"), streaky: rate("streaky") };
  }
  if (task === "charts") {
    const rate = (cat: string) => {
      const ids = new Set((key as ChartKeyItem[]).filter((k) => k.category === cat).map((k) => k.id));
      const rows = items.filter((x) => ids.has(x.itemId));
      return complete && rows.length ? rows.filter((x) => x.saidSignal).length / rows.length : null;
    };
    score.faRateIndependent = rate("independent");
    score.faRateSelected = rate("selected");
  }
  return score;
}

/* ---------------------------- metric catalogue ---------------------------- */
export interface MetricDef {
  key: keyof TaskScore;
  label: string;
  better: "higher" | "lower";
  format: "pct" | "num";
  explain: string;
}

export const METRICS: Record<TaskId, MetricDef[]> = {
  faces: [
    { key: "accuracy", label: "Accuracy", better: "higher", format: "pct", explain: "Share of all 20 images judged correctly." },
    { key: "hitRate", label: "Face detection rate (hits)", better: "higher", format: "pct", explain: "Of the images that really contained a face, the share you said 'face'." },
    { key: "falseAlarmRate", label: "False-alarm rate", better: "lower", format: "pct", explain: "Of the pure-noise images, the share where you reported a face." },
    { key: "dPrime", label: "Sensitivity d′", better: "higher", format: "num", explain: "Signal-detection sensitivity: how well 'face' answers separate real faces from noise (0 = chance)." },
    { key: "localizationRate", label: "Localisation accuracy", better: "higher", format: "pct", explain: "Of your hits, the share where you clicked on the actual face." },
  ],
  sequences: [
    { key: "accuracy", label: "Accuracy", better: "higher", format: "pct", explain: "Share of all 12 sequences classified correctly as fair coin vs. hidden rule." },
    { key: "hitRate", label: "Rule detection rate (hits)", better: "higher", format: "pct", explain: "Of the sequences with a hidden rule, the share you labelled 'hidden rule'." },
    { key: "falseAlarmRate", label: "False-alarm rate", better: "lower", format: "pct", explain: "Of the fair-coin sequences, the share you labelled 'hidden rule'." },
    { key: "dPrime", label: "Sensitivity d′", better: "higher", format: "num", explain: "How well your answers separate rule-based from fair-coin sequences (0 = chance)." },
  ],
  charts: [
    { key: "accuracy", label: "Accuracy", better: "higher", format: "pct", explain: "Share of all 12 charts judged correctly." },
    { key: "hitRate", label: "Real-relationship detection (hits)", better: "higher", format: "pct", explain: "Of the charts with a genuine (planted) relationship, the share you said 'real'." },
    { key: "falseAlarmRate", label: "False-alarm rate (all unrelated charts)", better: "lower", format: "pct", explain: "Of the 8 charts where the variables were independent, the share you said 'real'." },
    { key: "faRateSelected", label: "False alarms on cherry-picked charts", better: "lower", format: "pct", explain: "Of the 4 independent charts chosen as the most striking of 100 candidates, the share you said 'real'." },
    { key: "dPrime", label: "Sensitivity d′", better: "higher", format: "num", explain: "How well your answers separate related from unrelated charts (0 = chance)." },
  ],
};

export function metricDef(task: TaskId, key: string): MetricDef | undefined {
  return METRICS[task].find((m) => m.key === key);
}

/* -------------------------------- rankings -------------------------------- */
export interface RankRow { participantId: string; nickname: string; value: number; rank: number }

/**
 * Standard competition ranking ("1224"): tied values share a rank. "Better" depends on the
 * metric's direction. Selections that cut through a tie include every tied participant.
 */
export function rankParticipants(rows: { participantId: string; nickname: string; value: number }[], better: "higher" | "lower"): RankRow[] {
  const sign = better === "higher" ? -1 : 1;
  const sorted = rows.slice().sort((a, b) => sign * (a.value - b.value) || a.nickname.localeCompare(b.nickname));
  const EPS = 1e-9;
  return sorted.map((r) => ({ ...r, rank: 1 + sorted.filter((o) => (better === "higher" ? o.value > r.value + EPS : o.value < r.value - EPS)).length }));
}

export function selectRanking(ranked: RankRow[], cfg: RankingConfig): RankRow[] {
  const n = ranked.length;
  if (!n || cfg.mode === "none") return [];
  // bottom rank: 1 = worst. Computed the same way on the reversed direction.
  const worstFirstRank = (r: RankRow) => 1 + ranked.filter((o) => o.rank > r.rank).length;
  switch (cfg.mode) {
    case "all": return ranked;
    case "top1": return ranked.filter((r) => r.rank <= 1);
    case "top3": return ranked.filter((r) => r.rank <= 3);
    case "topN": return ranked.filter((r) => r.rank <= Math.max(1, cfg.n ?? 1));
    case "bottom1": return ranked.filter((r) => worstFirstRank(r) <= 1);
    case "bottom3": return ranked.filter((r) => worstFirstRank(r) <= 3);
    case "bottomN": return ranked.filter((r) => worstFirstRank(r) <= Math.max(1, cfg.n ?? 1));
    case "rank": return ranked.filter((r) => r.rank === cfg.rank);
    case "range": {
      const lo = Math.min(cfg.from ?? 1, cfg.to ?? 1), hi = Math.max(cfg.from ?? 1, cfg.to ?? 1);
      return ranked.filter((r) => r.rank >= lo && r.rank <= hi);
    }
    default: return [];
  }
}
