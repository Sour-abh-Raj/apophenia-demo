import { describe, expect, it } from "vitest";
import { faceClickOnTarget, rankParticipants, scoreTask, selectRanking, type ChartKeyItem, type FaceKeyItem, type ScoredResponse, type SequenceKeyItem } from "../../src/shared/scoring";
import { normInv, probLongestRunAtLeast, sdt } from "../../src/shared/stats";
import { longestRun } from "../../src/shared/rng";

const face = (id: string, has: boolean): FaceKeyItem => ({ task: "faces", id, hasFace: has, face: has ? { cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.15, contrast: 1, difficulty: "x" } : undefined });

describe("signal-detection scoring", () => {
  const key = [face("a", true), face("b", true), face("c", false), face("d", false), face("e", false)];
  const r = (id: string, f: boolean, x = 0.5, y = 0.5, c: 1 | 2 | 3 = 2): ScoredResponse => ({ itemId: id, task: "faces", response: f ? { face: true, x, y, confidence: c } : { face: false, confidence: c } });

  it("counts hits, misses, false alarms and correct rejections", () => {
    const s = scoreTask("faces", key, [r("a", true), r("b", false), r("c", true, 0.1, 0.1, 3), r("d", false), r("e", false)]);
    expect([s.hits, s.misses, s.falseAlarms, s.correctRejections]).toEqual([1, 1, 1, 2]);
    expect(s.hitRate).toBe(0.5);
    expect(s.falseAlarmRate).toBeCloseTo(1 / 3);
    expect(s.accuracy).toBe(3 / 5);
    expect(s.localizationRate).toBe(1);
    expect(s.complete).toBe(true);
    expect(s.dPrime).toBeCloseTo(sdt(1, 2, 1, 3).dPrime);
  });

  it("does not compute rates for incomplete tasks (no unequal denominators)", () => {
    const s = scoreTask("faces", key, [r("a", true), r("c", true)]);
    expect(s.complete).toBe(false);
    expect(s.hitRate).toBeNull();
    expect(s.accuracy).toBeNull();
    expect(s.dPrime).toBeNull();
  });

  it("scores localisation against the face ellipse", () => {
    expect(faceClickOnTarget(key[0], { face: true, x: 0.52, y: 0.55, confidence: 1 })).toBe(true);
    expect(faceClickOnTarget(key[0], { face: true, x: 0.9, y: 0.9, confidence: 1 })).toBe(false);
  });

  it("sequence and chart extras are per-category rates", () => {
    const sk: SequenceKeyItem[] = (["fair", "fair", "switchy", "streaky"] as const).map((p, i) => ({
      task: "sequences", id: `s${i}`, flips: "", process: p, truth: p === "fair" ? "random" : "rule", alternations: 0, longestRun: 0, heads: 10, idealPosteriorFair: 0.5, pAlternate: 0.5,
    }));
    const resp = (id: string, j: "random" | "rule"): ScoredResponse => ({ itemId: id, task: "sequences", response: { judgment: j, confidence: 2 } });
    const s = scoreTask("sequences", sk, [resp("s0", "rule"), resp("s1", "random"), resp("s2", "random"), resp("s3", "rule")]);
    expect(s.ruleRateByProcess).toEqual({ fair: 0.5, switchy: 0, streaky: 1 });
    const ck: ChartKeyItem[] = (["planted", "independent", "selected", "selected"] as const).map((c, i) => ({ task: "charts", id: `c${i}`, category: c, truth: c === "planted" ? "related" : "unrelated", sampleR: 0, trueRho: 0 }));
    const cr = (id: string, j: "related" | "unrelated"): ScoredResponse => ({ itemId: id, task: "charts", response: { judgment: j, confidence: 2 } });
    const c = scoreTask("charts", ck, [cr("c0", "related"), cr("c1", "unrelated"), cr("c2", "related"), cr("c3", "unrelated")]);
    expect(c.faRateSelected).toBe(0.5);
    expect(c.faRateIndependent).toBe(0);
    expect(c.falseAlarmRate).toBeCloseTo(1 / 3);
  });
});

describe("statistics", () => {
  it("normInv matches known quantiles", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 8);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.01)).toBeCloseTo(-2.326348, 5);
  });

  it("log-linear d′ stays finite at perfect scores", () => {
    const { dPrime } = sdt(5, 5, 0, 15);
    expect(Number.isFinite(dPrime)).toBe(true);
    expect(dPrime).toBeGreaterThan(2);
    expect(sdt(2, 4, 6, 12).dPrime).toBeCloseTo(0, 1);
  });

  it("longest-run probability matches brute-force enumeration and the 77% claim used in the debrief", () => {
    for (const [n, k] of [[8, 3], [10, 4], [12, 5]] as const) {
      let count = 0;
      for (let m = 0; m < 2 ** n; m++) {
        const s = m.toString(2).padStart(n, "0").replace(/0/g, "H").replace(/1/g, "T");
        if (longestRun(s) >= k) count++;
      }
      expect(probLongestRunAtLeast(n, k)).toBeCloseTo(count / 2 ** n, 10);
    }
    expect(probLongestRunAtLeast(20, 4)).toBeGreaterThan(0.76);
    expect(probLongestRunAtLeast(20, 4)).toBeLessThan(0.78);
  });
});

describe("rankings", () => {
  const rows = [
    { participantId: "1", nickname: "A", value: 0.9 },
    { participantId: "2", nickname: "B", value: 0.7 },
    { participantId: "3", nickname: "C", value: 0.7 },
    { participantId: "4", nickname: "D", value: 0.4 },
    { participantId: "5", nickname: "E", value: 0.1 },
  ];
  it("uses competition ranking with ties (higher is better)", () => {
    expect(rankParticipants(rows, "higher").map((r) => `${r.nickname}${r.rank}`)).toEqual(["A1", "B2", "C2", "D4", "E5"]);
  });
  it("respects 'lower is better' metrics (e.g. false-alarm rate)", () => {
    expect(rankParticipants(rows, "lower")[0].nickname).toBe("E");
  });
  it("selects every disclosure mode correctly", () => {
    const r = rankParticipants(rows, "higher");
    const names = (mode: Parameters<typeof selectRanking>[1]) => selectRanking(r, mode).map((x) => x.nickname).join("");
    const base = { task: "faces" as const, metric: "accuracy" };
    expect(names({ ...base, mode: "none" })).toBe("");
    expect(names({ ...base, mode: "top1" })).toBe("A");
    expect(names({ ...base, mode: "top3" })).toBe("ABC");
    expect(names({ ...base, mode: "topN", n: 2 })).toBe("ABC"); // tie at rank 2 is kept together
    expect(names({ ...base, mode: "bottom1" })).toBe("E");
    expect(names({ ...base, mode: "bottom3" })).toBe("BCDE"); // tie straddling the cut is included
    expect(names({ ...base, mode: "bottomN", n: 2 })).toBe("DE");
    expect(names({ ...base, mode: "rank", rank: 2 })).toBe("BC");
    expect(names({ ...base, mode: "range", from: 2, to: 4 })).toBe("BCD");
    expect(names({ ...base, mode: "all" })).toBe("ABCDE");
  });
});
