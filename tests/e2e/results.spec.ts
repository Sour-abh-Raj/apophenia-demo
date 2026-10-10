/**
 * Results must be correct and live: the projector switches to the real class averages as soon as the
 * instructor releases results; every report matches an independent recomputation from the raw CSV;
 * a change after release (excluding a student) updates the projector and open reports without a refresh.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const SIGNAL = new Set(["face", "switchy", "streaky", "planted"]);
const N: Record<string, number> = { faces: 20, sequences: 12, charts: 12 };

async function student(browser: Browser, code: string, nick: string) {
  const p = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  await p.goto(`/j/${code}`);
  await p.getByTestId("nickname").fill(nick);
  await p.getByTestId("join-btn").click();
  await expect(p.getByTestId("lobby")).toBeVisible();
  return p;
}

/** Answers every item through the page's own API token. `yes(i)` decides each answer from its position. */
async function answerAll(p: Page, pattern: "all" | "none" | "alternate") {
  await p.evaluate(async (pattern) => {
    const t = Object.entries(localStorage).find(([k]) => k.startsWith("apl:p:"))![1];
    const H = { "x-participant-token": t, "content-type": "application/json" };
    let v = await (await fetch("/api/p/me", { headers: H })).json();
    let i = 0;
    while (v.phase === "testing") {
      const tr = v.current, yes = pattern === "all" || (pattern === "alternate" && i % 2 === 0);
      const response = tr.task === "faces" ? (yes ? { face: true, x: 0.5, y: 0.5, confidence: 2 } : { face: false, confidence: 2 })
        : tr.task === "sequences" ? { judgment: yes ? "rule" : "random", confidence: 2 } : { judgment: yes ? "related" : "unrelated", confidence: 2 };
      v = (await (await fetch("/api/p/respond", { method: "POST", headers: H, body: JSON.stringify({ trialKey: tr.key, response }) })).json()).view;
      i++;
    }
  }, pattern);
}

/** Independent recomputation of individual and class rates from the CSV export. */
function expected(csv: string, excluded: string[] = []) {
  const [head, ...lines] = csv.trim().split("\n");
  const cols = head.split(",");
  const rows = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
  const indiv: Record<string, Record<string, { acc: number; hr: number; far: number }>> = {};
  for (const task of Object.keys(N)) {
    for (const nick of [...new Set(rows.map((r) => r.nickname))]) {
      const rs = rows.filter((r) => r.nickname === nick && r.task === task);
      if (rs.length !== N[task]) continue;
      const said = (r: Record<string, string>) => ["face", "rule", "related"].includes(r.response);
      const sig = rs.filter((r) => SIGNAL.has(r.truth)), noise = rs.filter((r) => !SIGNAL.has(r.truth));
      const hits = sig.filter(said).length, fas = noise.filter(said).length;
      (indiv[nick] ??= {})[task] = { acc: (hits + noise.length - fas) / rs.length, hr: hits / sig.length, far: fas / noise.length };
    }
  }
  const cls = (task: string) => {
    const inc = Object.entries(indiv).filter(([n, t]) => t[task] && !excluded.includes(n)).map(([, t]) => t[task]);
    const m = (k: "acc" | "hr" | "far") => inc.reduce((s, x) => s + x[k], 0) / inc.length;
    return { n: inc.length, acc: m("acc"), hr: m("hr"), far: m("far") };
  };
  return { indiv, cls };
}

test("results on the projector and in every report are correct, immediate and live", async ({ browser }) => {
  const hctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hctx.newPage();
  await host.goto("/host");
  await host.getByTestId("passcode").fill("e2e-pass");
  await host.getByTestId("create-session").click();
  const code = (await host.getByTestId("join-code").textContent())!.trim();
  const sid = host.url().split("/host/")[1];
  const hostKey = await host.evaluate((sid) => localStorage.getItem(`apl:host:${sid}`), sid);

  await expect(host.getByTestId("projector-status")).toContainText("No projector window open");
  const proj = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await proj.goto((await host.getByTestId("open-projector").getAttribute("href"))!);
  await expect(host.getByTestId("projector-status")).toContainText("open (1)");

  const students = { Alpha: await student(browser, code, "Alpha"), Bravo: await student(browser, code, "Bravo"), Charlie: await student(browser, code, "Charlie") };
  await host.getByTestId("action-open").click(); await host.getByTestId("confirm-btn").click();
  await answerAll(students.Alpha, "all");
  await answerAll(students.Bravo, "none");
  await answerAll(students.Charlie, "alternate");
  await expect(host.getByTestId("tile-finished")).toContainText("3");

  await host.getByTestId("action-lock").click(); await host.getByTestId("confirm-btn").click();
  await host.getByTestId("action-walkthrough").click(); await host.getByTestId("confirm-btn").click();
  await expect(proj.getByTestId("stage")).toBeVisible();

  // Release: the projector (open all along) must switch to the real results within a few seconds.
  await host.getByTestId("action-release").click();
  const t0 = Date.now();
  await host.getByTestId("confirm-btn").click();
  await expect(proj.getByTestId("pj-results")).toBeVisible({ timeout: 6000 });
  expect(Date.now() - t0).toBeLessThan(6000);
  await expect(proj.getByTestId("pj-fresh")).toContainText(`Session ${code}`);

  const csv = await (await host.request.get(`/api/host/${sid}/export.csv?k=${hostKey}&nicknames=1`)).text();
  const { indiv, cls } = expected(csv);
  const cards = proj.locator(".pj-grid3 > .pj-card");
  for (const [i, task] of ["faces", "sequences", "charts"].entries()) {
    const c = cls(task);
    await expect(cards.nth(i)).toContainText(`n = ${c.n}`);
    await expect(cards.nth(i).locator(".hbar-val").nth(0)).toHaveText(pct(c.hr));
    await expect(cards.nth(i).locator(".hbar-val").nth(1)).toHaveText(pct(c.far));
  }
  // Every student's report: own numbers and class numbers, for every task.
  for (const [nick, page] of Object.entries(students)) {
    await expect(page.getByTestId("report")).toBeVisible();
    for (const task of ["faces", "sequences", "charts"]) {
      const card = page.getByTestId(`report-${task}`), c = cls(task), me = indiv[nick][task];
      await expect(card).toContainText(`n = ${c.n}`);
      const vals = card.locator(".cmp > .cmp-row").nth(0).locator(".cmp-bar b"); // Accuracy: You, Class
      await expect(vals.nth(0)).toHaveText(pct(me.acc));
      await expect(vals.nth(1)).toHaveText(pct(c.acc));
      const hr = card.locator(".cmp > .cmp-row").nth(1).locator(".cmp-bar b");
      await expect(hr.nth(0)).toHaveText(pct(me.hr));
      await expect(hr.nth(1)).toHaveText(pct(c.hr));
    }
  }

  // Live after release: excluding Charlie updates the projector and open reports without any reload.
  await host.getByTestId("participant-row").filter({ hasText: "Charlie" }).getByRole("button", { name: "Exclude" }).click();
  const after = expected(csv, ["Charlie"]).cls("faces");
  await expect(proj.locator(".pj-grid3 > .pj-card").nth(0)).toContainText(`n = ${after.n}`, { timeout: 8000 });
  await expect(proj.locator(".pj-grid3 > .pj-card").nth(0).locator(".hbar-val").nth(0)).toHaveText(pct(after.hr));
  const alphaFaces = students.Alpha.getByTestId("report-faces");
  await expect(alphaFaces).toContainText(`n = ${after.n}`, { timeout: 12000 });
  await expect(alphaFaces.locator(".cmp > .cmp-row").nth(0).locator(".cmp-bar b").nth(1)).toHaveText(pct(after.acc));
  await expect(students.Charlie.getByTestId("report")).toContainText("not included in the class averages", { timeout: 12000 });
});
