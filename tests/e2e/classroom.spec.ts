/**
 * End-to-end rehearsal of a full class with real browsers: one instructor, one projector
 * window and three independent participants (separate browser contexts = separate devices).
 * Screenshots go to test-results/screenshots; set UPDATE_SCREENSHOTS=1 to refresh docs/screenshots for the README.
 */
import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

const SHOTS = process.env.UPDATE_SCREENSHOTS ? "docs/screenshots" : "test-results/screenshots";
mkdirSync(SHOTS, { recursive: true });
/** Words that would give the lesson away before the debrief (kept in step with tests/unit/concealment.test.ts). */
const GIVEAWAY = /\b(apophen\w*|pareidol\w*|noise|noisy|random\w*|illusion|illusory|phenomen\w*|cherry[- ]?pick\w*|patterns?|bias\w*|by chance|streak\w*|trick)\b/i;
const giveaways: string[] = [];
/** Records any give-away word in what a student or the projector can currently read. */
async function scanText(page: Page, where: string) {
  const t = await page.locator("body").innerText();
  const m = t.match(GIVEAWAY);
  if (m) giveaways.push(`${where}: "${m[0]}" in …${t.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 40).replace(/\n/g, " ")}…`);
}
const SECRET = ['"hasFace"', '"truth"', '"category"', '"process"', '"sampleR"', '"replication"', '"hitRate"', '"classResults"'];

async function participant(browser: Browser, code: string, nickname: string) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const leaks: string[] = [];
  let watching = true;
  page.on("response", async (r) => {
    if (!watching || !r.url().includes("/api/p/")) return;
    const body = await r.text().catch(() => "");
    for (const s of SECRET) if (body.includes(s)) leaks.push(`${r.url()} contains ${s}`);
  });
  await page.goto(`/j/${code}`);
  await page.getByTestId("nickname").waitFor();
  await scanText(page, "join form");
  await page.getByTestId("nickname").fill(nickname);
  await page.getByTestId("join-btn").click();
  await expect(page.getByTestId("lobby")).toBeVisible();
  await scanText(page, "lobby");
  return { page, leaks, stopWatching: () => { watching = false; } };
}

/** Plays trials through the UI. yes = always report the signal. Stops before `stopAtTask` begins. */
async function play(page: Page, yes: boolean, opts: { stopAtTask?: string; shots?: boolean } = {}) {
  const shot = new Set<string>();
  for (let i = 0; i < 200; i++) {
    if (await page.getByTestId("finished-waiting").isVisible()) { await scanText(page, "finished-waiting"); return; }
    const intro = page.getByTestId("task-intro");
    if (await intro.isVisible()) {
      await scanText(page, "task intro");
      if (opts.stopAtTask && (await intro.textContent())?.includes(opts.stopAtTask)) return;
      if (opts.shots && !shot.has("intro")) { shot.add("intro"); await page.screenshot({ path: `${SHOTS}/p-intro.png` }); }
      await page.getByTestId("start-practice").click();
      continue;
    }
    if (await page.getByTestId("scored-intro").isVisible()) { await page.getByTestId("start-scored").click(); continue; }
    const meta = page.locator(".trial-meta");
    if (!(await meta.isVisible())) { await page.waitForTimeout(100); continue; }
    const before = await meta.innerText();
    await scanText(page, `trial ${before.replace(/\n/g, " ")}`);
    if (await page.getByTestId("face-image").isVisible()) {
      if (yes) await page.getByTestId("face-image").click({ position: { x: 120, y: 130 } });
      else await page.getByTestId("no-face").click();
      if (opts.shots && !shot.has("face") && before.includes("1 of 20")) { shot.add("face"); await page.screenshot({ path: `${SHOTS}/p-faces.png`, fullPage: true }); }
    } else if (await page.getByTestId("judge-rule").isVisible()) {
      await page.getByTestId(yes ? "judge-rule" : "judge-random").click();
      if (opts.shots && !shot.has("seq") && before.includes("1 of 12")) { shot.add("seq"); await page.screenshot({ path: `${SHOTS}/p-sequences.png`, fullPage: true }); }
    } else {
      await page.getByTestId(yes ? "judge-related" : "judge-unrelated").click();
      if (opts.shots && !shot.has("chart") && before.includes("1 of 12")) { shot.add("chart"); await page.screenshot({ path: `${SHOTS}/p-charts.png`, fullPage: true }); }
    }
    await page.getByTestId(yes ? "conf-3" : "conf-1").click();
    await page.waitForFunction((prev) => { const m = document.querySelector(".trial-meta"); return !m || (m as HTMLElement).innerText !== prev; }, before);
  }
  throw new Error("did not finish");
}

test("full classroom flow with delayed, instructor-controlled reveal", async ({ browser }) => {
  /* ---------------- instructor creates a session ---------------- */
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostCtx.newPage();
  await host.goto("/host");
  await host.getByTestId("passcode").fill("e2e-pass");
  await host.getByTestId("create-session").click();
  const code = (await host.getByTestId("join-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  const state = () => host.getByTestId("session-state").getAttribute("data-state");
  const confirm = () => host.getByTestId("confirm-btn").click();

  const projCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const proj = await projCtx.newPage();
  await proj.goto((await host.getByTestId("open-projector").getAttribute("href"))!);
  await expect(proj.getByTestId("pj-code")).toHaveText(code);

  /* ---------------- three students join on separate devices ---------------- */
  const A = await participant(browser, code, "Alpha");
  const B = await participant(browser, code, "Bravo");
  const C = await participant(browser, code, "Charlie");
  await A.page.screenshot({ path: `${SHOTS}/p-lobby.png` });
  await expect(host.getByTestId("participant-row")).toHaveCount(3);
  const ids = await Promise.all([A, B, C].map((p) => p.page.evaluate(async () => {
    const t = Object.entries(localStorage).find(([k]) => k.startsWith("apl:p:"))![1];
    return (await (await fetch("/api/p/me", { headers: { "x-participant-token": t } })).json()).me.id;
  })));
  expect(new Set(ids).size).toBe(3);

  /* ---------------- testing ---------------- */
  await host.getByTestId("action-open").click(); await confirm();
  await expect.poll(state).toBe("TESTING_OPEN");
  await play(A.page, true, { shots: true });
  await expect(A.page.getByTestId("finished-waiting")).toBeVisible();
  await A.page.screenshot({ path: `${SHOTS}/p-finished-waiting.png` });

  // Bravo refreshes mid-way and resumes without losing progress
  await play(B.page, false, { stopAtTask: "Coin Sequences" });
  await B.page.reload();
  await expect(B.page.getByTestId("task-intro")).toContainText("Coin Sequences");
  await play(B.page, false);
  // Charlie only completes the faces activity
  await play(C.page, true, { stopAtTask: "Coin Sequences" });

  await expect(host.getByTestId("tile-finished")).toContainText("2");
  await expect(proj.locator(".pj-counter.accent b")).toHaveText("2");
  await scanText(proj, "projector during testing");
  await host.screenshot({ path: `${SHOTS}/host-testing.png`, fullPage: true });
  await proj.screenshot({ path: `${SHOTS}/projector-live.png` });
  await host.waitForTimeout(1500);
  expect(await state()).toBe("TESTING_OPEN"); // finishing never auto-locks
  await expect(A.page.getByTestId("report")).toHaveCount(0);

  /* ---------------- lock ---------------- */
  await host.getByTestId("action-lock").click();
  await expect(host.locator(".modal")).toContainText("1 participant(s) have not finished");
  await confirm();
  await expect.poll(state).toBe("TEST_LOCKED_AWAITING_DEBRIEF");
  for (const p of [A, B, C]) await expect(p.page.getByTestId("locked-waiting")).toBeVisible();
  await expect(C.page.getByTestId("locked-waiting")).toContainText("parts you completed are saved");
  for (const p of [A, B, C]) await scanText(p.page, "locked waiting screen");
  await C.page.screenshot({ path: `${SHOTS}/p-locked-waiting.png` });
  await expect(proj.getByText("Responses locked").first()).toBeVisible();
  await scanText(proj, "projector after lock");
  expect(giveaways, giveaways.join("\n")).toEqual([]); // nothing before the debrief named or hinted at the concept
  await proj.screenshot({ path: `${SHOTS}/projector-locked.png` });

  /* ---------------- walkthrough ---------------- */
  await host.getByTestId("action-walkthrough").click(); await confirm();
  await expect.poll(state).toBe("ANSWER_WALKTHROUGH");
  await expect(proj.getByTestId("stage")).toBeVisible();
  await expect(proj.getByTestId("reveal")).toHaveCount(0);
  await proj.screenshot({ path: `${SHOTS}/projector-walk-hidden.png` });
  await host.getByTestId("walk-reveal").click();
  await expect(proj.getByTestId("reveal")).toBeVisible();
  await expect(proj.getByTestId("reveal")).toContainText("No face"); // first featured item is a noise-only image
  await proj.screenshot({ path: `${SHOTS}/projector-walk-noise.png` });
  for (let i = 0; i < 5 && !(await proj.locator(".hidden-face img").isVisible()); i++) {
    await host.getByTestId("walk-next").click();
    await expect(proj.getByTestId("reveal")).toHaveCount(0); // each new item starts hidden
    await host.getByTestId("walk-reveal").click();
    await expect(proj.getByTestId("reveal")).toBeVisible();
  }
  await expect(proj.locator(".hidden-face img")).toBeVisible();
  await proj.screenshot({ path: `${SHOTS}/projector-walk-face.png` });
  await host.screenshot({ path: `${SHOTS}/host-walkthrough.png`, fullPage: true });
  for (const t of ["sequences", "charts"]) {
    await host.getByTestId(`walk-task-${t}`).click();
    await expect(proj.getByTestId("reveal")).toHaveCount(0); // new task starts hidden
    await host.getByTestId("walk-reveal").click();
    await expect(proj.getByTestId("reveal")).toBeVisible();
    await proj.screenshot({ path: `${SHOTS}/projector-walk-${t}.png` });
  }
  // walk to the first cherry-picked chart, if it is not the current item
  for (let i = 0; i < 6 && !(await proj.getByTestId("reveal").textContent())?.includes("cherry-picked"); i++) {
    await host.getByTestId("walk-next").click();
    await host.getByTestId("walk-reveal").click();
    await expect(proj.getByTestId("reveal")).toBeVisible();
  }
  await proj.screenshot({ path: `${SHOTS}/projector-walk-cherry-picked.png` });
  await host.getByTestId("walk-summary").click();
  await expect(proj.getByTestId("summary")).toBeVisible();
  await proj.screenshot({ path: `${SHOTS}/projector-walk-summary.png`, fullPage: true });
  // No scores anywhere during the walkthrough
  await expect(proj.getByTestId("pj-results")).toHaveCount(0);
  for (const p of [A, B, C]) {
    await expect(p.page.getByTestId("locked-waiting")).toBeVisible();
    await expect(p.page.getByTestId("report")).toHaveCount(0);
  }

  /* ---------------- release ---------------- */
  for (const p of [A, B, C]) { p.stopWatching(); expect(p.leaks, p.leaks.join("\n")).toEqual([]); }
  await host.getByTestId("action-release").click(); await confirm();
  await expect.poll(state).toBe("RESULTS_RELEASED");
  for (const p of [A, B, C]) await expect(p.page.getByTestId("report")).toBeVisible();
  await expect(A.page.getByTestId("report-faces")).toContainText("n = 3");
  await expect(A.page.getByTestId("report-sequences")).toContainText("n = 2");
  await expect(C.page.getByTestId("report")).toContainText("You answered 0 of 12");
  await A.page.screenshot({ path: `${SHOTS}/p-report.png`, fullPage: true });
  await expect(proj.getByTestId("pj-results")).toBeVisible();
  await expect(proj.getByTestId("pj-rankings")).toHaveCount(0); // rankings off by default
  await proj.screenshot({ path: `${SHOTS}/projector-results.png` });
  for (const tab of ["Faces in the Noise", "Coin Sequences", "Branch Data", "Confidence"]) {
    await proj.getByRole("button", { name: tab }).click();
    await proj.screenshot({ path: `${SHOTS}/projector-results-${tab.split(" ")[0].toLowerCase()}.png` });
  }
  // class average on projector: faces hit rate = (1 + 0 + 1) / 3
  await proj.getByRole("button", { name: "Overview" }).click();
  await expect(proj.locator(".pj-card").first()).toContainText("67%");

  /* ---------------- optional rankings ---------------- */
  await host.getByTestId("rank-task").selectOption("faces");
  await host.getByTestId("rank-metric").selectOption("falseAlarmRate");
  await host.getByTestId("rank-mode").selectOption("top1");
  await host.getByTestId("rank-show").click();
  await expect(proj.getByTestId("pj-rankings")).toContainText("Bravo");
  await expect(proj.getByTestId("pj-rankings")).toContainText("lower is better");
  await expect(proj.getByTestId("pj-rankings")).not.toContainText("Alpha");
  await proj.screenshot({ path: `${SHOTS}/projector-rankings.png` });
  await host.getByTestId("rank-hide").click();
  await expect(proj.getByTestId("pj-rankings")).toHaveCount(0);
  await host.screenshot({ path: `${SHOTS}/host-results.png`, fullPage: true });

  /* ---------------- discussion & close ---------------- */
  await host.getByTestId("proj-discussion").click();
  await expect(proj.getByTestId("pj-discussion")).toBeVisible();
  await proj.screenshot({ path: `${SHOTS}/projector-discussion.png` });
  await host.getByTestId("action-close").click(); await confirm();
  await expect.poll(state).toBe("SESSION_CLOSED");
  await expect(proj.getByTestId("pj-conclusion")).toBeVisible();
  await proj.screenshot({ path: `${SHOTS}/projector-conclusion.png` });
  await expect(A.page.getByTestId("report")).toBeVisible();
});
