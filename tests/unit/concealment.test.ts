/**
 * Concealment: before the debrief, nothing students or the projector see may name or hint at the
 * concept being taught — otherwise the walkthrough cannot deliver the "aha" moment.
 * The rendered pages are checked end-to-end in tests/e2e/classroom.spec.ts; this file checks the
 * shared strings and defaults those pages are built from.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { PREDICTION_QUESTIONS, TASK_TITLES } from "../../src/shared/types";

/** Words that give the lesson away. Exported shape mirrored in the e2e test. */
export const GIVEAWAY = /\b(apophen\w*|pareidol\w*|noise|noisy|random\w*|illusion|illusory|phenomen\w*|cherry[- ]?pick\w*|patterns?|bias\w*|by chance|streak\w*|trick)\b/i;

describe("concealment before the debrief", () => {
  it("task titles and prediction questions are neutral", () => {
    for (const t of Object.values(TASK_TITLES)) expect(t).not.toMatch(GIVEAWAY);
    for (const q of Object.values(PREDICTION_QUESTIONS)) expect(q.label).not.toMatch(GIVEAWAY);
  });

  it("default session titles are neutral (server default and the create form)", async () => {
    const { app, hub } = createApp({ dbPath: ":memory:", passcode: "pw" });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const s = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: "pw" }) })).json();
    const look = await (await fetch(`${base}/api/lookup/${s.code}`)).json();
    expect(look.title).not.toMatch(GIVEAWAY);
    hub.closeAll(); srv.close();
    const form = readFileSync(resolve(__dirname, "../../src/client/pages/HostCreate.tsx"), "utf8").match(/useState\("([^"]+)"\)/)![1];
    expect(form).not.toMatch(GIVEAWAY);
  });

  it("the browser tab title is neutral", () => {
    const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
    expect(html.match(/<title>([^<]*)<\/title>/)![1]).not.toMatch(GIVEAWAY);
  });
});
