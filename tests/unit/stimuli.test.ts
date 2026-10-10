/**
 * Verifies the stimulus manifests against the files and the documented generating processes,
 * and that regeneration from the fixed seeds is byte-identical (reproducibility).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { alternations, longestRun, pearson } from "../../src/shared/rng";

const ROOT = resolve(__dirname, "../..");
const STIM = join(ROOT, "stimuli");
const faces = JSON.parse(readFileSync(join(STIM, "faces_manifest.json"), "utf8"));
const battery = JSON.parse(readFileSync(join(STIM, "battery.json"), "utf8"));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Dimensions of a lossy WebP (RIFF / "VP8 " chunk) without decoding it. */
function webpSize(p: string) {
  const b = readFileSync(p);
  expect(b.subarray(0, 4).toString()).toBe("RIFF");
  expect(b.subarray(8, 16).toString()).toBe("WEBPVP8 ");
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}

describe("faces-in-noise stimuli", () => {
  it("has 20 scored images (5 faces, 15 noise) and 2 practice images, all present and 420×420 WebP", () => {
    expect(faces.scored).toHaveLength(20);
    expect(faces.scored.filter((e: { hasFace: boolean }) => e.hasFace)).toHaveLength(5);
    expect(faces.practice).toHaveLength(2);
    for (const e of [...faces.scored, ...faces.practice]) {
      const p = join(STIM, e.file);
      expect(existsSync(p), p).toBe(true);
      expect(webpSize(p)).toEqual({ w: 420, h: 420 });
    }
  });

  it("every face item has a location inside the image and a private reveal image; noise items have none", () => {
    for (const e of faces.scored) {
      const reveal = join(STIM, "private_faces", `${e.id}-face.webp`);
      if (e.hasFace) {
        expect(e.face.cx - e.face.rx).toBeGreaterThan(0);
        expect(e.face.cx + e.face.rx).toBeLessThan(1);
        expect(e.face.cy - e.face.ry).toBeGreaterThan(0);
        expect(e.face.cy + e.face.ry).toBeLessThan(1);
        expect(existsSync(reveal)).toBe(true);
      } else {
        expect(e.face).toBeUndefined();
        expect(existsSync(reveal)).toBe(false);
      }
    }
  });

  it("public file names are opaque (no information about condition)", () => {
    for (const e of faces.scored) expect(e.file).toMatch(/^faces\/[0-9a-f]{12}\.webp$/);
    const publicFiles = readdirSync(join(STIM, "faces"));
    expect(publicFiles).toHaveLength(22);
  });

  const py = spawnSync("python3", ["-c", "import numpy, PIL"]);
  it.skipIf(py.status !== 0)("regenerates identically from the fixed seed", () => {
    const out = mkdtempSync(join(tmpdir(), "faces-"));
    execFileSync("python3", [join(ROOT, "scripts/stimuli/generate_faces.py")], { env: { ...process.env, STIMULI_OUT: out } });
    const lf = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    expect(lf(join(out, "faces_manifest.json"))).toBe(lf(join(STIM, "faces_manifest.json")));
    // Same libwebp => byte-identical. A different libwebp build may encode slightly differently,
    // so fall back to comparing decoded pixels (the images themselves must be the same).
    const differ = faces.scored.filter((e: { file: string }) => sha(join(out, e.file)) !== sha(join(STIM, e.file)));
    if (differ.length) {
      const cmp = "import sys,numpy as n;from PIL import Image as I;a,b=sys.argv[1:3];d=n.abs(n.asarray(I.open(a).convert('L'),int)-n.asarray(I.open(b).convert('L'),int));print(d.mean())";
      for (const e of differ) {
        const meanDiff = Number(execFileSync("python3", ["-c", cmp, join(out, e.file), join(STIM, e.file)]).toString());
        expect(meanDiff).toBeLessThan(2);
      }
    }
  });
});

describe("coin sequences", () => {
  const seqs = battery.sequences.scored as { id: string; flips: string; process: string; pAlternate: number; alternations: number; longestRun: number; heads: number; truth: string }[];
  it("has 6 fair, 3 switchy and 3 streaky sequences of 20 flips", () => {
    expect(seqs).toHaveLength(12);
    const count = (p: string) => seqs.filter((s) => s.process === p).length;
    expect([count("fair"), count("switchy"), count("streaky")]).toEqual([6, 3, 3]);
    for (const s of seqs) expect(s.flips).toMatch(/^[HT]{20}$/);
  });
  it("stored statistics match the sequences and the pre-registered representativeness rule", () => {
    for (const s of seqs) {
      expect(alternations(s.flips)).toBe(s.alternations);
      expect(longestRun(s.flips)).toBe(s.longestRun);
      expect([...s.flips].filter((c) => c === "H").length).toBe(s.heads);
      const mean = 19 * s.pAlternate, sd = Math.sqrt(19 * s.pAlternate * (1 - s.pAlternate));
      expect(Math.abs(s.alternations - mean)).toBeLessThanOrEqual(sd);
      expect(s.heads).toBeGreaterThanOrEqual(7);
      expect(s.heads).toBeLessThanOrEqual(13);
      expect(s.truth).toBe(s.process === "fair" ? "random" : "rule");
    }
  });
});

describe("business charts", () => {
  const charts = battery.charts.scored as { id: string; points: [number, number][]; category: string; truth: string; sampleR: number; trueRho: number; replication: { points: [number, number][]; r: number } }[];
  it("has 4 planted, 4 independent and 4 cherry-picked charts with 30 points each", () => {
    const count = (c: string) => charts.filter((x) => x.category === c).length;
    expect([count("planted"), count("independent"), count("selected")]).toEqual([4, 4, 4]);
    for (const c of charts) {
      expect(c.points).toHaveLength(30);
      expect(c.truth).toBe(c.category === "planted" ? "related" : "unrelated");
      expect(Math.abs(c.trueRho)).toBe(c.category === "planted" ? 0.5 : 0);
    }
  });
  it("stored sample and replication correlations match the data", () => {
    for (const c of charts) {
      expect(pearson(c.points.map((p) => p[0]), c.points.map((p) => p[1]))).toBeCloseTo(c.sampleR, 2);
      expect(pearson(c.replication.points.map((p) => p[0]), c.replication.points.map((p) => p[1]))).toBeCloseTo(c.replication.r, 2);
    }
  });
  it("cherry-picked nulls look stronger than typical nulls but do not replicate; planted relationships do", () => {
    const sel = charts.filter((c) => c.category === "selected"), ind = charts.filter((c) => c.category === "independent"), pl = charts.filter((c) => c.category === "planted");
    expect(Math.min(...sel.map((c) => Math.abs(c.sampleR)))).toBeGreaterThan(Math.max(...ind.map((c) => Math.abs(c.sampleR))));
    for (const c of sel) expect(Math.abs(c.replication.r)).toBeLessThan(0.2);
    for (const c of pl) expect(Math.sign(c.replication.r)).toBe(Math.sign(c.trueRho));
    for (const c of pl) expect(Math.abs(c.replication.r)).toBeGreaterThan(0.35);
  });
  it("regenerates byte-identically from the fixed seed", () => {
    const out = join(mkdtempSync(join(tmpdir(), "battery-")), "battery.json");
    // Run tsx's CLI through the current Node binary: node_modules/.bin/tsx is a shell script that Windows cannot exec directly.
    execFileSync(process.execPath, [join(ROOT, "node_modules/tsx/dist/cli.mjs"), join(ROOT, "scripts/generate-battery.ts")], { env: { ...process.env, BATTERY_OUT: out } });
    // Compare content, not line endings (git may check the file out with CRLF on Windows).
    const lf = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    expect(lf(out)).toBe(lf(join(STIM, "battery.json")));
  });
});
