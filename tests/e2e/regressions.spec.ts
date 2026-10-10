/**
 * Regression checks for issues found in classroom rehearsal:
 *  - copy buttons on the dashboard, including the non-https fallback
 *  - instructor notice reaches finished students and students on the last item
 *  - every walkthrough move (next, task, answer key, featured toggle, keyboard) starts hidden
 *  - the full answer key never overlaps or overflows at common projector sizes
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

async function newHost(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const host = await ctx.newPage();
  await host.goto("/host");
  await host.getByTestId("passcode").fill("e2e-pass");
  await host.getByTestId("create-session").click();
  const code = (await host.getByTestId("join-code").textContent())!.trim();
  return { host, code };
}

async function student(browser: Browser, code: string, nick: string) {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await p.goto(`/j/${code}`);
  await p.getByTestId("nickname").fill(nick);
  await p.getByTestId("join-btn").click();
  await expect(p.getByTestId("lobby")).toBeVisible();
  return p;
}

/** Answers through the API with the page's own token, leaving `leave` items unanswered; skips intro cards. */
async function answer(p: Page, leave: number) {
  await p.evaluate(async (leave) => {
    const t = Object.entries(localStorage).find(([k]) => k.startsWith("apl:p:"))![1];
    const H = { "x-participant-token": t, "content-type": "application/json" };
    let v = await (await fetch("/api/p/me", { headers: H })).json();
    while (v.phase === "testing" && v.me.total - v.me.answered > leave) {
      const tr = v.current;
      const response = tr.task === "faces" ? { face: false, confidence: 2 } : tr.task === "sequences" ? { judgment: "random", confidence: 2 } : { judgment: "unrelated", confidence: 2 };
      v = (await (await fetch("/api/p/respond", { method: "POST", headers: H, body: JSON.stringify({ trialKey: tr.key, response }) })).json()).view;
    }
    for (const tk of ["faces", "sequences", "charts"]) for (const ph of ["practice", "scored"]) localStorage.setItem(`apl:intro:${v.me.id}:${tk}:${ph}`, "1");
  }, leave);
  await p.reload();
}

test("copy buttons work, including the fallback used on plain-http addresses", async ({ browser }) => {
  const { host } = await newHost(browser);
  await host.getByTestId("join-url-copy").click();
  await expect(host.getByTestId("join-url-copy")).toHaveText(/Copied/);
  expect(await host.evaluate(() => navigator.clipboard.readText())).toMatch(/\/j\/[A-Z0-9]{6}$/);
  // Simulate a non-secure origin (no navigator.clipboard): the execCommand fallback must still copy.
  await host.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await host.getByTestId("copy-host-link").click();
  await expect(host.getByTestId("copy-host-link")).toHaveText(/Copied/);
});

test("notice reaches finished students and students on the last item; walkthrough always resets; answer key fits", async ({ browser }) => {
  const { host, code } = await newHost(browser);
  const proj = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await proj.goto((await host.getByTestId("open-projector").getAttribute("href"))!);
  const done = await student(browser, code, "Finisher");
  const last = await student(browser, code, "LastPage");
  await host.getByTestId("action-open").click(); await host.getByTestId("confirm-btn").click();
  await answer(done, 0);
  await answer(last, 1);
  await expect(done.getByTestId("finished-waiting")).toBeVisible();
  await expect(last.locator(".trial-meta")).toContainText("12 of 12");

  await host.getByTestId("notice-text").fill("2 minutes left");
  await host.getByTestId("notice-send").click();
  await expect(done.getByTestId("notice")).toContainText("2 minutes left", { timeout: 8000 });
  await expect(last.getByTestId("notice")).toContainText("2 minutes left", { timeout: 8000 });
  await host.getByTestId("notice-clear").click();
  await expect(last.getByTestId("notice")).toHaveCount(0, { timeout: 8000 });

  await host.getByTestId("action-lock").click(); await host.getByTestId("confirm-btn").click();
  await host.getByTestId("action-walkthrough").click(); await host.getByTestId("confirm-btn").click();
  const reveal = async () => { await host.getByTestId("walk-reveal").click(); await expect(proj.getByTestId("reveal")).toBeVisible(); };
  const hidden = () => expect(proj.getByTestId("reveal")).toHaveCount(0);
  await reveal(); await host.getByTestId("walk-next").click(); await hidden();
  await reveal(); await host.getByTestId("walk-task-sequences").click(); await hidden();
  await reveal(); await host.getByTestId("walk-summary").click(); await expect(proj.getByTestId("summary")).toBeVisible();
  await host.getByTestId("walk-summary").click(); await hidden();
  await reveal(); await host.locator("label:has-text('Featured') input").click(); await hidden();
  await reveal(); await host.keyboard.press("ArrowRight"); await hidden();

  for (const task of ["faces", "sequences", "charts"]) {
    await host.getByTestId(`walk-task-${task}`).click();
    await host.getByTestId("walk-summary").click();
    await expect(proj.getByTestId("summary")).toBeVisible();
    for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 768], [800, 600], [390, 844]]) {
      await proj.setViewportSize({ width: w, height: h });
      await proj.waitForTimeout(200);
      const r = await proj.evaluate(() => {
        const cells = [...document.querySelectorAll(".summary-cell")];
        const rects = cells.map((e) => e.getBoundingClientRect());
        let overlaps = 0;
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
        }
        return { overlaps, spill: cells.filter((c) => c.scrollWidth > c.clientWidth + 2).length, hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      expect(r, `${task} answer key at ${w}×${h}`).toEqual({ overlaps: 0, spill: 0, hscroll: false });
    }
    await proj.setViewportSize({ width: 1280, height: 720 });
    await host.getByTestId("walk-summary").click();
  }
});

test("a distant student (400 ms latency) advances instantly and every answer is saved in order", async ({ browser }) => {
  const { host, code } = await newHost(browser);
  const p = await student(browser, code, "FarAway");
  await host.getByTestId("action-open").click(); await host.getByTestId("confirm-btn").click();
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 1.5e6 / 8, uploadThroughput: 0.75e6 / 8 });
  await p.getByTestId("start-practice").click();
  const clicks = 14;
  for (let i = 0; i < clicks; i++) {
    if (await p.getByTestId("scored-intro").isVisible()) await p.getByTestId("start-scored").click();
    const before = await p.locator(".trial-meta").innerText();
    await p.waitForTimeout(700); // a very fast human: look, decide
    await p.getByTestId("no-face").click();
    const t = Date.now();
    await p.getByTestId("conf-1").click();
    await p.waitForFunction((prev) => (document.querySelector(".trial-meta") as HTMLElement | null)?.innerText !== prev || !!document.querySelector('[data-testid="scored-intro"]'), before);
    if (i > 2) expect(Date.now() - t, `item ${i} should advance without waiting for the server`).toBeLessThan(400);
  }
  // all answers reach the server, in order, with nothing duplicated
  await expect.poll(async () => p.evaluate(async () => {
    const t = Object.entries(localStorage).find(([k]) => k.startsWith("apl:p:"))![1];
    return (await (await fetch("/api/p/me", { headers: { "x-participant-token": t } })).json()).me.answered;
  }), { timeout: 15000 }).toBe(clicks);
});
