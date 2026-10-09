/**
 * API-level tests of the delayed-reveal protocol and access control, using the real app
 * against an in-memory database. Simulates several independent participants.
 */
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";

let server: Server;
let B = "";
let hub: { closeAll: () => void };

beforeAll(async () => {
  const made = createApp({ dbPath: ":memory:", passcode: "pw" });
  hub = made.hub;
  server = made.app.listen(0);
  await new Promise((r) => server.once("listening", r));
  B = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { hub.closeAll(); server.close(); });

async function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(B + url, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = JSON.parse(text); } catch { /* csv etc */ }
  return { status: r.status, json, text };
}

// Words that only occur in answer keys / results; a participant must never receive them before release.
const SECRET_FIELDS = ['"hasFace"', '"truth"', '"category"', '"process"', '"sampleR"', '"trueRho"', '"idealPosteriorFair"', '"replication"', '"hitRate"', '"falseAlarmRate"', '"classResults"', '"face":{'];

async function newSession() {
  const s = (await req("POST", "/api/sessions", { title: "Test", passcode: "pw" })).json;
  return { ...s, H: { "x-host-key": s.hostKey }, S: { "x-screen-key": s.screenKey } };
}
async function join(code: string, nickname: string, consent = true) {
  const j = (await req("POST", "/api/join", { code, nickname, consent })).json;
  return { ...j, P: { "x-participant-token": j.token } };
}
const act = (sid: string, H: Record<string, string>, action: string) => req("POST", `/api/host/${sid}/transition`, { action }, H);

type Strategy = "yes" | "no";
/** Answers trials; "yes" always reports the signal, "no" never does. Returns the transcript of raw responses received. */
async function answer(P: Record<string, string>, strategy: Strategy, maxTrials = Infinity, onlyTask?: string) {
  const transcript: string[] = [];
  let me = await req("GET", "/api/p/me", undefined, P);
  transcript.push(me.text);
  let n = 0;
  while (me.json.phase === "testing" && n < maxTrials) {
    const t = me.json.current;
    if (onlyTask && t.task !== onlyTask) break;
    const yes = strategy === "yes";
    const response = t.task === "faces" ? (yes ? { face: true, x: 0.5, y: 0.5, confidence: 3 } : { face: false, confidence: 1 })
      : t.task === "sequences" ? { judgment: yes ? "rule" : "random", confidence: 2 } : { judgment: yes ? "related" : "unrelated", confidence: 2 };
    const r = await req("POST", "/api/p/respond", { trialKey: t.key, response, rtMs: 1000 }, P);
    expect(r.status).toBe(200);
    transcript.push(r.text);
    me = { ...r, json: r.json.view };
    n++;
  }
  return { transcript, view: me.json };
}

describe("authentication & session creation", () => {
  it("requires the instructor passcode", async () => {
    expect((await req("POST", "/api/sessions", { title: "x", passcode: "wrong" })).status).toBe(403);
    expect((await req("POST", "/api/sessions", { title: "x" })).status).toBe(403);
  });
  it("rejects wrong keys on host, projector and participant routes", async () => {
    const s = await newSession();
    expect((await req("GET", `/api/host/${s.sessionId}`)).status).toBe(403);
    expect((await req("GET", `/api/host/${s.sessionId}`, undefined, { "x-host-key": s.screenKey })).status).toBe(403); // projector key is not a host key
    expect((await req("GET", `/api/screen/${s.sessionId}`, undefined, { "x-screen-key": "nope" })).status).toBe(403);
    expect((await req("GET", `/api/host/not-a-session`, undefined, s.H)).status).toBe(404);
    expect((await req("GET", "/api/p/me", undefined, { "x-participant-token": "forged" })).status).toBe(401);
    expect((await req("GET", "/api/p/me")).status).toBe(401);
  });
  it("a participant token cannot operate host controls", async () => {
    const s = await newSession();
    const a = await join(s.code, "A");
    expect((await req("POST", `/api/host/${s.sessionId}/transition`, { action: "open" }, { "x-host-key": a.token })).status).toBe(403);
  });
});

describe("full delayed-reveal protocol with three participants", () => {
  it("never reveals answers or results before the explicit release, then reports correctly", async () => {
    const s = await newSession();
    const [a, b, c] = [await join(s.code, "Alpha"), await join(s.code, "Bravo"), await join(s.code, "Charlie")];
    const dup = await join(s.code, "alpha");
    expect(dup.nickname).toBe("alpha 2"); // unique pseudonyms
    expect(new Set([a.participantId, b.participantId, c.participantId, dup.participantId]).size).toBe(4);
    await req("POST", `/api/host/${s.sessionId}/participants/${dup.participantId}/exclude`, { excluded: true }, s.H);

    // Lobby: no responses accepted, no trials served.
    let me = (await req("GET", "/api/p/me", undefined, a.P)).json;
    expect(me.phase).toBe("lobby");
    expect(me.current).toBeNull();
    expect((await req("POST", "/api/p/respond", { trialKey: "faces|p|x", response: {} }, a.P)).status).toBe(409);

    expect((await act(s.sessionId, s.H, "open")).json.state).toBe("TESTING_OPEN");

    // Alpha finishes everything; Bravo too; Charlie only finishes the faces task (incomplete).
    const ra = await answer(a.P, "yes");
    const rb = await answer(b.P, "no");
    const rc = await answer(c.P, "yes", Infinity, "faces");
    expect(ra.view.phase).toBe("finished-waiting");
    expect(rc.view.phase).toBe("testing");

    // No participant payload during testing contains answer keys or scores.
    for (const t of [...ra.transcript, ...rb.transcript, ...rc.transcript]) for (const f of SECRET_FIELDS) expect(t).not.toContain(f);

    // Everyone-finished does not change session state: still open.
    let host = (await req("GET", `/api/host/${s.sessionId}`, undefined, s.H)).json;
    expect(host.session.state).toBe("TESTING_OPEN");
    expect(host.counts.finished).toBe(2);
    expect(host.results).toBeNull();
    // Projector monitoring view: aggregate progress only.
    let screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    expect(screen.json.counts.finished).toBe(2);
    for (const f of [...SECRET_FIELDS, "Alpha", "Bravo"]) expect(screen.text).not.toContain(f);
    // Reports are not available.
    expect((await req("GET", "/api/p/report", undefined, a.P)).status).toBe(403);

    // Duplicate submission (network retry) is idempotent and does not double count.
    const lastFaceKey = JSON.parse(rc.transcript[rc.transcript.length - 2]).view?.current?.key;
    if (lastFaceKey) {
      const d = await req("POST", "/api/p/respond", { trialKey: lastFaceKey, response: { face: false, confidence: 1 } }, c.P);
      expect(d.json.duplicate).toBe(true);
    }
    // Out-of-order submission (skipping ahead) is refused.
    expect((await req("POST", "/api/p/respond", { trialKey: "charts|s|chart-01", response: { judgment: "related", confidence: 1 } }, c.P)).status).toBe(409);

    // LOCK
    expect((await act(s.sessionId, s.H, "lock")).json.changed).toBe(true);
    expect((await act(s.sessionId, s.H, "lock")).json.changed).toBe(false); // double click
    for (const p of [a, b, c]) {
      me = (await req("GET", "/api/p/me", undefined, p.P)).json;
      expect(me.phase).toBe("locked-waiting");
      expect(me.current).toBeNull();
    }
    expect((await req("POST", "/api/join", { code: s.code, nickname: "Late" })).status).toBe(409);
    expect((await req("POST", "/api/p/respond", { trialKey: "x", response: {} }, c.P)).status).toBe(409);
    expect((await req("GET", "/api/p/report", undefined, a.P)).status).toBe(403);
    screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    for (const f of SECRET_FIELDS) expect(screen.text).not.toContain(f);
    host = (await req("GET", `/api/host/${s.sessionId}`, undefined, s.H)).json;
    expect(host.counts.incomplete).toBe(2); // Charlie + the excluded duplicate joiner (never started)
    expect(host.results.classResults.faces.n).toBe(3); // Charlie completed faces
    expect(host.results.classResults.sequences.n).toBe(2);
    // Rankings and projector result modes are unavailable before release.
    expect((await req("POST", `/api/host/${s.sessionId}/ranking`, { config: { mode: "all", task: "faces", metric: "accuracy" } }, s.H)).status).toBe(409);
    expect((await req("POST", `/api/host/${s.sessionId}/projector`, { mode: "results" }, s.H)).status).toBe(409);
    // Private reveal images are not served yet.
    const anyFace = (await import("../../stimuli/faces_manifest.json")).scored.find((e: { hasFace: boolean }) => e.hasFace)!;
    expect((await req("GET", `/api/screen/${s.sessionId}/asset/${anyFace.id}-face.png?k=${s.screenKey}`)).status).toBe(403);
    // Cannot skip the walkthrough.
    expect((await act(s.sessionId, s.H, "releaseResults")).status).toBe(409);

    // WALKTHROUGH
    await act(s.sessionId, s.H, "beginWalkthrough");
    screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    expect(screen.json.walkthrough.reveal).toBeNull(); // starts hidden
    expect(screen.json.walkthrough.summary).toBeNull();
    expect(screen.text).not.toContain('"classResults"');
    await req("POST", `/api/host/${s.sessionId}/walkthrough`, { revealed: true }, s.H);
    screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    expect(screen.json.walkthrough.reveal.headline).toBeTruthy();
    expect(screen.text).not.toContain('"classResults"');
    expect(screen.text).not.toContain('"hitRate"');
    // moving to the next item hides the answer again
    await req("POST", `/api/host/${s.sessionId}/walkthrough`, { index: 1 }, s.H);
    expect((await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S)).json.walkthrough.reveal).toBeNull();
    expect((await req("GET", `/api/screen/${s.sessionId}/asset/${anyFace.id}-face.png?k=${s.screenKey}`)).status).toBe(200);
    for (const p of [a, b, c]) expect((await req("GET", "/api/p/me", undefined, p.P)).json.phase).toBe("locked-waiting");
    expect((await req("GET", "/api/p/report", undefined, a.P)).status).toBe(403);

    // RELEASE
    await act(s.sessionId, s.H, "releaseResults");
    const repA = (await req("GET", "/api/p/report", undefined, a.P)).json;
    const repB = (await req("GET", "/api/p/report", undefined, b.P)).json;
    const repC = (await req("GET", "/api/p/report", undefined, c.P)).json;
    expect(repA.nickname).toBe("Alpha");
    expect(JSON.stringify(repA)).not.toContain("Bravo"); // no other participants' data
    const fa = repA.tasks.find((t: { task: string }) => t.task === "faces");
    const fb = repB.tasks.find((t: { task: string }) => t.task === "faces");
    expect([fa.score.hitRate, fa.score.falseAlarmRate]).toEqual([1, 1]); // always "face"
    expect([fb.score.hitRate, fb.score.falseAlarmRate]).toEqual([0, 0]); // never "face"
    // Class means use the same rule and denominators: faces n=3 (A,B,C), sequences n=2 (A,B).
    expect(fa.classN).toBe(3);
    expect(fa.classMeans.hitRate).toBeCloseTo(2 / 3);
    expect(fa.classMeans.falseAlarmRate).toBeCloseTo(2 / 3);
    const sa = repA.tasks.find((t: { task: string }) => t.task === "sequences");
    expect(sa.classN).toBe(2);
    expect(sa.classMeans.hitRate).toBeCloseTo(0.5);
    expect(repC.tasks.find((t: { task: string }) => t.task === "sequences").score.complete).toBe(false);
    // Excluded participant is not in the class aggregate.
    expect((await req("GET", "/api/p/report", undefined, dup.P)).json.excluded).toBe(true);

    // Rankings are off until set; the projector shows exactly the chosen selection.
    screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    expect(screen.json.ranking).toBeNull();
    expect(screen.json.results.classResults.faces.n).toBe(3);
    await req("POST", `/api/host/${s.sessionId}/ranking`, { config: { mode: "top1", task: "faces", metric: "falseAlarmRate" } }, s.H);
    screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    expect(screen.json.ranking.better).toBe("lower");
    expect(screen.json.ranking.rows).toEqual([{ rank: 1, nickname: "Bravo", value: 0 }]);
    await req("POST", `/api/host/${s.sessionId}/ranking`, { config: { mode: "bottom1", task: "faces", metric: "falseAlarmRate" } }, s.H);
    screen = await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S);
    expect(screen.json.ranking.rows.map((r: { nickname: string }) => r.nickname).sort()).toEqual(["Alpha", "Charlie"]); // tied
    await req("POST", `/api/host/${s.sessionId}/ranking`, { config: null }, s.H);
    expect((await req("GET", `/api/screen/${s.sessionId}`, undefined, s.S)).json.ranking).toBeNull();
    expect((await req("POST", `/api/host/${s.sessionId}/ranking`, { config: { mode: "all", task: "faces", metric: "madeUpScore" } }, s.H)).status).toBe(400);

    // CSV export: instructor only, pseudonymous by default.
    const csv = await req("GET", `/api/host/${s.sessionId}/export.csv?k=${s.hostKey}`);
    expect(csv.status).toBe(200);
    expect(csv.text.split("\n")[0]).toContain("participant,consent");
    expect(csv.text).not.toContain("Alpha");
    expect((await req("GET", `/api/host/${s.sessionId}/export.csv?k=${s.hostKey}&nicknames=1`)).text).toContain("Alpha");
    expect((await req("GET", `/api/host/${s.sessionId}/export.csv?k=${s.screenKey}`)).status).toBe(403);

    // Close
    await act(s.sessionId, s.H, "close");
    expect((await req("GET", "/api/p/me", undefined, a.P)).json.phase).toBe("results");
  });
});

describe("isolation, reconnection and reset", () => {
  it("participants resume where they left off and sessions are isolated", async () => {
    const s1 = await newSession(), s2 = await newSession();
    const a = await join(s1.code, "A");
    const b = await join(s2.code, "B");
    await act(s1.sessionId, s1.H, "open");
    await answer(a.P, "yes", 5);
    const resumed = (await req("GET", "/api/p/me", undefined, a.P)).json; // "refresh"
    expect(resumed.me.answered).toBe(5);
    expect(resumed.phase).toBe("testing");
    // s2 is still in the lobby and unaffected
    expect((await req("GET", "/api/p/me", undefined, b.P)).json.phase).toBe("lobby");
    // s1's host key cannot read s2
    expect((await req("GET", `/api/host/${s2.sessionId}`, undefined, s1.H)).status).toBe(403);
    expect((await req("GET", `/api/host/${s1.sessionId}`, undefined, s1.H)).json.participants.map((p: { nickname: string }) => p.nickname)).toEqual(["A"]);
  });

  it("trial order is randomised per participant but always covers the same items", async () => {
    const s = await newSession();
    const a = await join(s.code, "A"), b = await join(s.code, "B");
    await act(s.sessionId, s.H, "open");
    const ka = (await answer(a.P, "yes")).transcript.map((t) => JSON.parse(t)).map((j) => (j.view ?? j).current?.key).filter(Boolean);
    const kb = (await answer(b.P, "yes")).transcript.map((t) => JSON.parse(t)).map((j) => (j.view ?? j).current?.key).filter(Boolean);
    expect(ka).not.toEqual(kb);
    expect([...ka].sort()).toEqual([...kb].sort());
    expect(ka.length).toBe(48);
  });

  it("reset clears participants and returns to the lobby; delete removes the session", async () => {
    const s = await newSession();
    const a = await join(s.code, "A");
    expect((await req("POST", `/api/host/${s.sessionId}/reset`, {}, s.H)).status).toBe(400);
    await req("POST", `/api/host/${s.sessionId}/reset`, { confirm: "RESET" }, s.H);
    expect((await req("GET", "/api/p/me", undefined, a.P)).status).toBe(401);
    expect((await req("GET", `/api/host/${s.sessionId}`, undefined, s.H)).json.session.state).toBe("LOBBY");
    await req("DELETE", `/api/host/${s.sessionId}`, { confirm: "DELETE" }, s.H);
    expect((await req("GET", `/api/host/${s.sessionId}`, undefined, s.H)).status).toBe(404);
  });

  it("rejects malformed responses", async () => {
    const s = await newSession();
    const a = await join(s.code, "A");
    await act(s.sessionId, s.H, "open");
    const t = (await req("GET", "/api/p/me", undefined, a.P)).json.current;
    for (const bad of [{}, { face: true, confidence: 2 }, { face: "yes", confidence: 2 }, { face: false, confidence: 7 }, { face: true, x: 2, y: 0.5, confidence: 1 }]) {
      expect((await req("POST", "/api/p/respond", { trialKey: t.key, response: bad }, a.P)).status).toBe(400);
    }
  });
});

describe("polling-only mode", () => {
  it("DISABLE_SSE answers the event stream with 204 so clients fall back to polling", async () => {
    const { app, hub: h } = createApp({ dbPath: ":memory:", passcode: "pw", disableSse: true });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const r = await fetch(`http://127.0.0.1:${(srv.address() as { port: number }).port}/api/events?role=participant&t=x`);
    expect(r.status).toBe(204);
    h.closeAll(); srv.close();
  });
});
