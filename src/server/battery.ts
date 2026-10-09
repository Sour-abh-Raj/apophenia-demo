/**
 * Loads the stimulus manifests (with answer keys) on the server only. Participant-facing
 * views are built here and never include ground truth.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashSeed, mulberry32, shuffle } from "../shared/rng.js";
import type { ChartKeyItem, FaceKeyItem, KeyItem, SequenceKeyItem } from "../shared/scoring.js";
import { probLongestRunAtLeast } from "../shared/stats.js";
import type { Stimulus, TaskId, TrialView, Variable } from "../shared/types.js";
import { TASK_IDS } from "../shared/types.js";

export const STIMULI_DIR = resolve(process.env.STIMULI_DIR ?? "stimuli");

interface FaceManifestEntry { id: string; file: string; index: number; hasFace: boolean; face?: FaceKeyItem["face"] }
interface ChartItemRaw {
  id: string; x: Variable; y: Variable; points: [number, number][]; category: ChartKeyItem["category"]; truth: ChartKeyItem["truth"];
  trueRho: number; sampleR: number; selection: string | null; poolMedianAbsR: number | null;
  replication: { n: number; points: [number, number][]; r: number };
}

export interface BatteryItem { key: KeyItem; stimulus: Stimulus; raw: unknown }
export interface Battery {
  practice: Record<TaskId, { id: string; stimulus: Stimulus }[]>;
  scored: Record<TaskId, BatteryItem[]>;
  meta: { faces: unknown; sequences: { description: string; length: number }; charts: { description: string; nPoints: number } };
}

let cached: Battery | null = null;

export function loadBattery(): Battery {
  if (cached) return cached;
  const faces = JSON.parse(readFileSync(resolve(STIMULI_DIR, "faces_manifest.json"), "utf8"));
  const bat = JSON.parse(readFileSync(resolve(STIMULI_DIR, "battery.json"), "utf8"));
  const faceStim = (e: FaceManifestEntry): Stimulus => ({ kind: "face", imageUrl: `/stim/faces/${e.id}.png` });
  const chartStim = (c: { x: Variable; y: Variable; points: [number, number][] }): Stimulus => ({ kind: "chart", x: c.x, y: c.y, points: c.points });
  cached = {
    practice: {
      faces: faces.practice.map((e: FaceManifestEntry) => ({ id: e.id, stimulus: faceStim(e) })),
      sequences: [{ id: bat.sequences.practice.id, stimulus: { kind: "sequence", flips: bat.sequences.practice.flips } }],
      charts: [{ id: bat.charts.practice.id, stimulus: chartStim(bat.charts.practice) }],
    },
    scored: {
      faces: faces.scored.map((e: FaceManifestEntry) => ({
        key: { task: "faces", id: e.id, hasFace: e.hasFace, face: e.face } satisfies FaceKeyItem,
        stimulus: faceStim(e), raw: e,
      })),
      sequences: bat.sequences.scored.map((s: SequenceKeyItem & { id: string }) => ({
        key: {
          task: "sequences", id: s.id, flips: s.flips, process: s.process, truth: s.truth, alternations: s.alternations,
          longestRun: s.longestRun, heads: s.heads, idealPosteriorFair: s.idealPosteriorFair, pAlternate: s.pAlternate,
        } satisfies SequenceKeyItem,
        stimulus: { kind: "sequence", flips: s.flips } as Stimulus, raw: s,
      })),
      charts: bat.charts.scored.map((c: ChartItemRaw) => ({
        key: { task: "charts", id: c.id, category: c.category, truth: c.truth, sampleR: c.sampleR, trueRho: c.trueRho } satisfies ChartKeyItem,
        stimulus: chartStim(c), raw: c,
      })),
    },
    meta: { faces: { noise: faces.noise, size: faces.size }, sequences: bat.sequences, charts: bat.charts },
  };
  return cached;
}

export const keyFor = (task: TaskId) => loadBattery().scored[task].map((i) => i.key);

/* ------------------------------ trial ordering ------------------------------ */
/** Trial key = "<task>|<p|s>|<itemId>". Practice first (fixed order), scored items shuffled per participant. */
export function buildTrialOrder(participantId: string): string[] {
  const b = loadBattery();
  const keys: string[] = [];
  for (const task of TASK_IDS) {
    for (const p of b.practice[task]) keys.push(`${task}|p|${p.id}`);
    const rand = mulberry32(hashSeed(`${participantId}:${task}`));
    for (const it of shuffle(b.scored[task], rand)) keys.push(`${task}|s|${it.key.id}`);
  }
  return keys;
}

export function parseTrialKey(key: string): { task: TaskId; practice: boolean; itemId: string } | null {
  const [task, ps, itemId] = key.split("|");
  if (!TASK_IDS.includes(task as TaskId) || (ps !== "p" && ps !== "s") || !itemId) return null;
  return { task: task as TaskId, practice: ps === "p", itemId };
}

export function trialView(order: string[], position: number): TrialView | null {
  const key = order[position];
  if (!key) return null;
  const parsed = parseTrialKey(key);
  if (!parsed) return null;
  const b = loadBattery();
  const { task, practice, itemId } = parsed;
  const block = order.filter((k) => k.startsWith(`${task}|${practice ? "p" : "s"}|`));
  const stimulus = practice
    ? b.practice[task].find((p) => p.id === itemId)!.stimulus
    : b.scored[task].find((i) => i.key.id === itemId)!.stimulus;
  return { key, task, practice, index: block.indexOf(key), blockSize: block.length, stimulus };
}

/* ------------------------------ walkthrough content ------------------------------ */
export interface RevealContent {
  headline: string;
  signal: boolean;
  truthLabel: string;
  explanation: string[];
  facts: { label: string; value: string }[];
  faceOverlay?: { cx: number; cy: number; rx: number; ry: number };
  faceImageUrl?: string;
  replication?: { n: number; points: [number, number][]; r: number };
  sequenceDetail?: { longestRun: number; alternations: number; process: string };
}

export interface WalkthroughItem {
  task: TaskId; itemId: string; number: number; featured: boolean; stimulus: Stimulus;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Canonical walkthrough order and the default "featured" short path (fixed in advance, never response-driven). */
export function walkthroughItems(task: TaskId): WalkthroughItem[] {
  const b = loadBattery();
  const items = b.scored[task];
  let featured: Set<string>;
  if (task === "faces") {
    const fk = items.map((i) => i.key as FaceKeyItem);
    featured = new Set([...fk.filter((k) => k.hasFace).map((k) => k.id), ...fk.filter((k) => !k.hasFace).slice(0, 3).map((k) => k.id)]);
  } else if (task === "sequences") {
    const sk = items.map((i) => i.key as SequenceKeyItem);
    const fair = sk.filter((k) => k.process === "fair").sort((a, z) => z.longestRun - a.longestRun).slice(0, 2);
    featured = new Set([...fair, sk.find((k) => k.process === "switchy")!, sk.find((k) => k.process === "streaky")!].map((k) => k.id));
  } else {
    const ck = items.map((i) => i.key as ChartKeyItem);
    featured = new Set([
      ...ck.filter((k) => k.category === "planted").slice(0, 2),
      ...ck.filter((k) => k.category === "independent").slice(0, 1),
      ...ck.filter((k) => k.category === "selected"),
    ].map((k) => k.id));
  }
  return items.map((it, i) => ({ task, itemId: it.key.id, number: i + 1, featured: featured.has(it.key.id), stimulus: it.stimulus }));
}

export function revealContent(task: TaskId, itemId: string, assetBase: string): RevealContent | null {
  const item = loadBattery().scored[task].find((i) => i.key.id === itemId);
  if (!item) return null;
  const k = item.key;
  if (k.task === "faces") {
    if (k.hasFace && k.face) {
      return {
        headline: "A face was hidden here",
        signal: true, truthLabel: "Face present",
        explanation: [
          `A face was embedded at ${k.face.difficulty} contrast. Faint faces are easy to miss — and once you know where to look, hard to "unsee".`,
          "That shift is top-down perception: knowledge and expectation change what the same pixels look like.",
        ],
        facts: [{ label: "Difficulty", value: k.face.difficulty }, { label: "Embedding contrast", value: k.face.contrast.toFixed(2) }],
        faceOverlay: { cx: k.face.cx, cy: k.face.cy, rx: k.face.rx, ry: k.face.ry },
        faceImageUrl: `${assetBase}/${k.id}-face.png`,
      };
    }
    return {
      headline: "No face — pure noise",
      signal: false, truthLabel: "Noise only",
      explanation: [
        "This image is random 1/f visual noise. There is no face anywhere in it.",
        "Any face you saw was assembled by your own visual system from random dark and light blobs — noise pareidolia.",
        "Face perception is tuned to fire on very little evidence (two dark spots above a third can be enough). Missing a real face is costly; a false alarm is usually cheap.",
      ],
      facts: [{ label: "Generating process", value: "1/f noise, independent random phases" }],
    };
  }
  if (k.task === "sequences") {
    const pRun = probLongestRunAtLeast(20, k.longestRun);
    const common = [
      `Switches: ${k.alternations} of 19 (a fair coin averages 9.5).`,
      `Longest run: ${k.longestRun}. In 20 fair flips, a run this long or longer happens ${pct(pRun)} of the time.`,
      `An ideal statistician who knew the three possible processes would rate this sequence ${pct(k.idealPosteriorFair)} likely to be a fair coin.`,
    ];
    const head =
      k.process === "fair"
        ? { headline: "Fair coin — no hidden rule", truthLabel: "Random (fair coin)", lead: "Every flip was independent: the coin had no memory and no rule. Streaks like these are normal in genuine randomness." }
        : k.process === "switchy"
          ? { headline: "Hidden rule: it tends to SWITCH", truthLabel: "Rule (switches 70%)", lead: "This coin switched sides 70% of the time. Over-alternating sequences like this are what people typically judge as the MOST random (Falk & Konold, 1997)." }
          : { headline: "Hidden rule: it tends to REPEAT", truthLabel: "Rule (repeats 70%)", lead: "This coin repeated its previous result 70% of the time, producing long streaks." };
    return {
      headline: head.headline, signal: k.truth === "rule", truthLabel: head.truthLabel,
      explanation: [head.lead, ...common],
      facts: [
        { label: "P(switch) in generating process", value: k.pAlternate.toFixed(1) },
        { label: "Heads / tails", value: `${k.heads} / ${20 - k.heads}` },
      ],
      sequenceDetail: { longestRun: k.longestRun, alternations: k.alternations, process: k.process },
    };
  }
  const raw = item.raw as ChartItemRaw;
  const labelNote = `The labels "${raw.x.name}" and "${raw.y.name}" were assigned at random — any story linking them came from us, not the data.`;
  if (k.category === "planted") {
    return {
      headline: "Real relationship", signal: true, truthLabel: "Related (planted)",
      explanation: [
        `These variables were generated with a true correlation of ρ = ${k.trueRho > 0 ? "+" : ""}${k.trueRho}.`,
        `In this sample of 30 branches r = ${k.sampleR.toFixed(2)}. In 300 fresh branches from the same process, r = ${raw.replication.r.toFixed(2)} — the pattern holds up.`,
        "Even so, a genuine association is not evidence that one variable causes the other.",
      ],
      facts: [{ label: "True ρ", value: String(k.trueRho) }, { label: "Sample r (n = 30)", value: k.sampleR.toFixed(2) }, { label: "Replication r (n = 300)", value: raw.replication.r.toFixed(2) }],
      replication: raw.replication,
    };
  }
  if (k.category === "independent") {
    return {
      headline: "No relationship", signal: false, truthLabel: "Unrelated (independent)",
      explanation: [
        "The two variables were generated independently (ρ = 0). This is simply the first random draw.",
        `The sample still shows r = ${k.sampleR.toFixed(2)} by chance alone; in 300 fresh branches r = ${raw.replication.r.toFixed(2)}.`,
        labelNote,
      ],
      facts: [{ label: "True ρ", value: "0" }, { label: "Sample r (n = 30)", value: k.sampleR.toFixed(2) }, { label: "Replication r (n = 300)", value: raw.replication.r.toFixed(2) }],
      replication: raw.replication,
    };
  }
  return {
    headline: "No relationship — cherry-picked", signal: false, truthLabel: "Unrelated (selected from 100)",
    explanation: [
      "The variables are independent (ρ = 0). But this chart was the MOST striking of 100 independent datasets we generated — exactly what an analyst finds by scanning many variable pairs.",
      `Its sample r = ${k.sampleR.toFixed(2)} looked convincing (a typical candidate had |r| ≈ ${raw.poolMedianAbsR?.toFixed(2)}). In 300 fresh branches it collapses to r = ${raw.replication.r.toFixed(2)}.`,
      labelNote,
    ],
    facts: [
      { label: "True ρ", value: "0" }, { label: "Candidates screened", value: "100" },
      { label: "Sample r (n = 30)", value: k.sampleR.toFixed(2) }, { label: "Replication r (n = 300)", value: raw.replication.r.toFixed(2) },
    ],
    replication: raw.replication,
  };
}

export const TASK_SUMMARY_NOTES: Record<TaskId, string[]> = {
  faces: [
    "5 of the 20 images contained a faint face; 15 were pure 1/f noise.",
    "Adapted from the Noise Pareidolia Test (Yokoi et al., 2014; Mamiya et al., 2016). Classroom adaptation with newly generated stimuli — not the validated clinical instrument.",
  ],
  sequences: [
    "6 sequences came from a fair coin, 3 from a coin that tends to switch (70%), 3 from a coin that tends to repeat (70%).",
    "Any particular 20-flip sequence is equally likely from a fair coin (1 in 1,048,576). But categories differ: sequences with 8–11 switches are far more common than ones with 14+, and a run of 4 or more appears in about 77% of fair sequences.",
  ],
  charts: [
    "4 charts had a real (planted) relationship; 4 were independent random draws; 4 were independent but cherry-picked as the most striking of 100 candidates.",
    "Labels were shuffled independently of the truth. What separates a real pattern from a chance one is not how convincing it looks, but whether it replicates in new data.",
  ],
};
