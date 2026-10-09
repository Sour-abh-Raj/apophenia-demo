/**
 * Generates stimuli/battery.json: the coin-sequence task and the business-data task.
 * Every item records its data-generating process, seed and selection rule, so the
 * answer key is fixed BEFORE any participant responds (see docs/DESIGN.md).
 *
 *   npm run generate:battery        # rewrites stimuli/battery.json deterministically
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { alternations, hashSeed, longestRun, mulberry32, normal, pearson, shuffle } from "../src/shared/rng.js";

const MASTER_SEED = 20261009;
const OUT = process.env.BATTERY_OUT ?? resolve(import.meta.dirname, "..", "stimuli", "battery.json");

/* ------------------------------------------------------------------ *
 * Task 2: coin sequences (Falk & Konold, 1997; Bar-Hillel & Wagenaar, 1991)
 * ------------------------------------------------------------------ */
const SEQ_LEN = 20;
type Proc = "fair" | "switchy" | "streaky";
const P_ALT: Record<Proc, number> = { fair: 0.5, switchy: 0.7, streaky: 0.3 };
const PRIOR: Record<Proc, number> = { fair: 0.5, switchy: 0.25, streaky: 0.25 }; // matches the 6/3/3 design

function genSequence(proc: Proc, rand: () => number): string {
  let s = rand() < 0.5 ? "H" : "T";
  for (let i = 1; i < SEQ_LEN; i++) {
    const prev = s[i - 1];
    const alt = rand() < P_ALT[proc];
    s += alt ? (prev === "H" ? "T" : "H") : prev;
  }
  return s;
}

/** Representative-example rule, fixed in advance: alternation count within ±1 SD of the
 *  process mean, and 7–13 heads (so no item is identifiable from a lopsided H/T count). */
function isRepresentative(seq: string, proc: Proc): boolean {
  const n = SEQ_LEN - 1, p = P_ALT[proc];
  const mean = n * p, sd = Math.sqrt(n * p * (1 - p));
  const a = alternations(seq);
  const heads = [...seq].filter((c) => c === "H").length;
  return Math.abs(a - mean) <= sd && heads >= 7 && heads <= 13;
}

/** Posterior P(fair | sequence) for an ideal observer who knows the three processes and their base rates. */
function idealPosteriorFair(seq: string): number {
  const n = SEQ_LEN - 1, a = alternations(seq);
  const lik = (p: number) => Math.pow(p, a) * Math.pow(1 - p, n - a);
  const num = PRIOR.fair * lik(0.5);
  const den = num + PRIOR.switchy * lik(0.7) + PRIOR.streaky * lik(0.3);
  return num / den;
}

function buildSequences() {
  const rand = mulberry32(hashSeed(`seq:${MASTER_SEED}`));
  // Plan order is shuffled so that item ids carry no information about the answer.
  const plan: Proc[] = shuffle(["fair", "fair", "fair", "fair", "fair", "fair", "switchy", "switchy", "switchy", "streaky", "streaky", "streaky"] as Proc[], rand);
  const items = plan.map((proc, i) => {
    let seq = "", draws = 0;
    do { seq = genSequence(proc, rand); draws++; } while (!isRepresentative(seq, proc));
    return {
      id: `seq-${String(i + 1).padStart(2, "0")}`,
      flips: seq,
      process: proc,
      pAlternate: P_ALT[proc],
      truth: proc === "fair" ? "random" : "rule",
      alternations: alternations(seq),
      expectedAlternationsIfFair: (SEQ_LEN - 1) / 2,
      longestRun: longestRun(seq),
      heads: [...seq].filter((c) => c === "H").length,
      idealPosteriorFair: Number(idealPosteriorFair(seq).toFixed(3)),
      drawsUntilAccepted: draws,
    };
  });
  const practice = { id: "seq-practice", flips: genSequence("fair", rand), process: "fair (practice, unscored)" };
  return {
    description:
      "20 flips per sequence. 'fair' = independent fair coin (P(switch)=0.5). 'switchy' = Markov process that switches face with P=0.7. " +
      "'streaky' = Markov process that switches with P=0.3. First flip is 50/50. Items drawn from a seeded PRNG; the first draw meeting the " +
      "pre-registered representativeness rule (alternations within ±1 SD of the process mean; 7–13 heads) was kept.",
    seed: `seq:${MASTER_SEED}`,
    length: SEQ_LEN,
    priors: PRIOR,
    practice,
    scored: items,
  };
}

/* ------------------------------------------------------------------ *
 * Task 3: business scatterplots (illusory correlation / selection effects)
 * ------------------------------------------------------------------ */
interface Variable { name: string; unit: string; mean: number; sd: number; decimals: number }
const v = (name: string, unit: string, mean: number, sd: number, decimals = 0): Variable => ({ name, unit, mean, sd, decimals });

// Label pairs are assigned to datasets by a seeded shuffle that is independent of the
// ground truth, so the plausibility of a "story" carries no information about the answer.
const LABEL_POOL: [Variable, Variable][] = [
  [v("Team meetings per week", "meetings", 6, 1.5, 1), v("Customer satisfaction", "score 0–100", 72, 8)],
  [v("Store floor area", "m²", 1800, 350), v("Staff turnover", "% per year", 24, 6, 1)],
  [v("Manager tenure", "years", 6, 2, 1), v("Average basket value", "$", 48, 7, 2)],
  [v("Training hours per employee", "hours/year", 22, 6), v("Product return rate", "%", 8, 2, 1)],
  [v("Distance to city centre", "km", 9, 3, 1), v("Online review rating", "stars (1–5)", 3.9, 0.3, 2)],
  [v("Average staff age", "years", 34, 4, 1), v("Weekly footfall", "thousand visitors", 12, 3, 1)],
  [v("Marketing emails sent", "per month", 14, 4), v("Repeat-purchase rate", "%", 31, 6, 1)],
  [v("Parking spaces", "spaces", 120, 30), v("Sales per employee", "$ thousand", 210, 35)],
  [v("Opening hours", "hours/week", 70, 8), v("Inventory shrinkage", "% of sales", 1.6, 0.4, 2)],
  [v("Part-time staff share", "%", 38, 9, 1), v("Net Promoter Score", "NPS", 28, 10)],
  [v("Days since last store refit", "days", 900, 250), v("Conversion rate", "%", 22, 4, 1)],
  [v("Local unemployment rate", "%", 6.5, 1.5, 1), v("Gift-card sales", "$ thousand/month", 40, 9, 1)],
];
const PRACTICE_LABELS: [Variable, Variable] = [v("Checkout lanes", "lanes", 8, 2), v("Average queue time", "minutes", 4.5, 1.2, 1)];

const N_POINTS = 30;      // branches per chart
const N_REPLICATION = 300; // fresh sample from the same process, shown only in the walkthrough
const RHO_PLANTED = 0.5;  // true population correlation for planted relationships
const POOL_SIZE = 100;    // candidate independent datasets screened for each "selected" chart

function sampleZ(n: number, rho: number, rand: () => number): [number[], number[]] {
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = normal(rand), b = normal(rand);
    xs.push(a);
    ys.push(rho * a + Math.sqrt(1 - rho * rho) * b);
  }
  return [xs, ys];
}

const toScale = (zs: number[], vr: Variable) => zs.map((z) => Number((vr.mean + vr.sd * z).toFixed(vr.decimals)));

type Category = "planted" | "independent" | "selected";

function buildCharts() {
  const rand = mulberry32(hashSeed(`charts:${MASTER_SEED}`));
  const plan: { cat: Category; rho: number }[] = shuffle([
    { cat: "planted", rho: RHO_PLANTED }, { cat: "planted", rho: RHO_PLANTED },
    { cat: "planted", rho: -RHO_PLANTED }, { cat: "planted", rho: -RHO_PLANTED },
    { cat: "independent", rho: 0 }, { cat: "independent", rho: 0 }, { cat: "independent", rho: 0 }, { cat: "independent", rho: 0 },
    { cat: "selected", rho: 0 }, { cat: "selected", rho: 0 }, { cat: "selected", rho: 0 }, { cat: "selected", rho: 0 },
  ] as { cat: Category; rho: number }[], rand); // shuffled so ids carry no information
  const labels = shuffle(LABEL_POOL, mulberry32(hashSeed(`labels:${MASTER_SEED}`)));
  const items = plan.map((p, i) => {
    const [xv, yv] = labels[i];
    let zx: number[], zy: number[], poolNote: string | null = null, poolAbsRs: number[] | null = null;
    if (p.cat === "selected") {
      // Data-dredging simulation: draw POOL_SIZE independent datasets, keep the most correlated one.
      let best: [number[], number[]] | null = null, bestAbs = -1;
      poolAbsRs = [];
      for (let k = 0; k < POOL_SIZE; k++) {
        const cand = sampleZ(N_POINTS, 0, rand);
        const r = Math.abs(pearson(cand[0], cand[1]));
        poolAbsRs.push(r);
        if (r > bestAbs) { bestAbs = r; best = cand; }
      }
      [zx, zy] = best!;
      poolNote = `Most correlated of ${POOL_SIZE} independent candidate datasets`;
    } else {
      [zx, zy] = sampleZ(N_POINTS, p.rho, rand);
    }
    const xs = toScale(zx, xv), ys = toScale(zy, yv);
    const [rx, ry] = sampleZ(N_REPLICATION, p.rho, rand);
    const rxs = toScale(rx, xv), rys = toScale(ry, yv);
    const sortedPool = poolAbsRs ? poolAbsRs.slice().sort((a, b) => a - b) : null;
    return {
      id: `chart-${String(i + 1).padStart(2, "0")}`,
      x: xv, y: yv,
      points: xs.map((x, j) => [x, ys[j]]),
      category: p.cat,
      truth: p.cat === "planted" ? "related" : "unrelated",
      trueRho: p.rho,
      sampleR: Number(pearson(xs, ys).toFixed(3)),
      selection: poolNote,
      poolMedianAbsR: sortedPool ? Number(sortedPool[Math.floor(POOL_SIZE / 2)].toFixed(3)) : null,
      replication: { n: N_REPLICATION, points: rxs.map((x, j) => [x, rys[j]]), r: Number(pearson(rxs, rys).toFixed(3)) },
    };
  });
  const [px, py] = sampleZ(N_POINTS, 0, rand);
  const practice = {
    id: "chart-practice", x: PRACTICE_LABELS[0], y: PRACTICE_LABELS[1],
    points: toScale(px, PRACTICE_LABELS[0]).map((x, j) => [x, toScale(py, PRACTICE_LABELS[1])[j]]),
  };
  return {
    description:
      `Each chart shows ${N_POINTS} branches of a fictional retailer (synthetic data). 'planted' = bivariate normal with population ρ = ±${RHO_PLANTED}. ` +
      `'independent' = ρ = 0, first draw kept. 'selected' = ρ = 0, but the most correlated of ${POOL_SIZE} candidate draws was kept (selection effect). ` +
      `Variable labels were assigned by a seeded shuffle independent of the ground truth. Axes use the same padding rule for every chart; no trend lines or statistics are shown during testing.`,
    seed: `charts:${MASTER_SEED}`,
    nPoints: N_POINTS,
    practice,
    scored: items,
  };
}

const battery = {
  generatedBy: "scripts/generate-battery.ts",
  masterSeed: MASTER_SEED,
  sequences: buildSequences(),
  charts: buildCharts(),
};
writeFileSync(OUT, JSON.stringify(battery, null, 1) + "\n");
console.log("sequences:", battery.sequences.scored.map((s) => `${s.process}:${s.flips} A=${s.alternations} P(fair)=${s.idealPosteriorFair}`).join("\n  "));
console.log("charts:", battery.charts.scored.map((c) => `${c.category} r=${c.sampleR} rep=${c.replication.r} [${c.x.name} vs ${c.y.name}]`).join("\n  "));
