import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { ParticipantView, PredictionKey, TaskId, TrialResponse } from "../../shared/types";
import { PREDICTION_QUESTIONS, TASK_IDS, TASK_TITLES } from "../../shared/types";
import { api, ApiError, participantKey, store } from "../api";
import { Trial, usePrefetch } from "../components/Trials";
import { useLive } from "../live";
import { Report } from "./Report";

const TASK_INTROS: Record<TaskId, { lead: string; steps: string[]; scoredCount: number; noun: string }> = {
  faces: {
    lead: "You'll see grainy, cloud-like grey images. Some have a faint face hidden in them; others don't.",
    steps: ["If you see a face, tap where it is. If not, press “No face”.", "Then say how sure you are.", "Go with your perception — about 5 seconds per image."],
    scoredCount: 20, noun: "images",
  },
  sequences: {
    lead: "Each card shows 20 coin flips. Some sequences come from an ordinary fair coin. Others come from a coin with a hidden rule — a mechanism that makes it tend to repeat, or tend to switch.",
    steps: ["Decide: fair coin — or a coin with a hidden rule?", "Then say how sure you are."],
    scoredCount: 12, noun: "sequences",
  },
  charts: {
    lead: "Each chart shows 30 branches of a fictional retail company (synthetic data; variable names are illustrative). In some charts the two measures are genuinely related; in others they are not.",
    steps: ["Decide whether there is a real relationship — one that would still appear across many more branches.", "Then say how sure you are."],
    scoredCount: 12, noun: "charts",
  },
};

export function ParticipantPage() {
  const { code = "" } = useParams();
  const CODE = code.toUpperCase();
  const [token, setToken] = useState<string | null>(() => store.get(participantKey(CODE)));
  if (!token) return <JoinForm code={CODE} onJoined={(t) => { store.set(participantKey(CODE), t); setToken(t); }} />;
  return <ParticipantSession code={CODE} token={token} onLost={() => { store.del(participantKey(CODE)); setToken(null); }} />;
}

/* ------------------------------------------------------------------ join */
function JoinForm({ code, onJoined }: { code: string; onJoined: (token: string) => void }) {
  const [info, setInfo] = useState<{ title: string; joinable: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nick, setNick] = useState("");
  const [consent, setConsent] = useState(true);
  const [research, setResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ title: string; joinable: boolean }>("GET", `/api/lookup/${encodeURIComponent(code)}`).then(setInfo).catch((e) => setErr(e.message));
  }, [code]);
  const join = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ token: string }>("POST", "/api/join", { code, nickname: nick, consent, researchConsent: research });
      onJoined(r.token);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <div className="page narrow">
      <div className="card join-card">
        <div className="eyebrow">Perception Lab · code {code}</div>
        <h1>{info?.title ?? "Join the activity"}</h1>
        {info && !info.joinable && <p className="alert">This activity is closed to new participants.</p>}
        {err && <p className="alert">{err}</p>}
        <p className="muted">Three short perception and judgment activities (about 8 minutes). Nothing is graded. You won't see any answers until the instructor reveals them together at the end.</p>
        <label className="field">Nickname (shown to the instructor; may appear on an optional leaderboard)
          <input value={nick} maxLength={24} onChange={(e) => setNick(e.target.value)} placeholder="e.g. Blue Heron" autoFocus data-testid="nickname" onKeyDown={(e) => e.key === "Enter" && nick.trim() && join()} />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
          <span>Include my anonymous responses in the class statistics. (Optional — you can take part either way.)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} data-testid="research-consent" />
          <span>Also allow my anonymous responses to be used for teaching research. (Optional, off by default.)</span>
        </label>
        <details className="privacy">
          <summary>How your responses are handled</summary>
          <ul>
            <li>No login, email or tracking. We store only your nickname and your answers for this class session.</li>
            <li>Your individual results are shown only to you (and to the instructor). Class charts show averages only.</li>
            <li>A leaderboard is optional and, if used, shows nicknames — pick a pseudonym if you prefer.</li>
            <li>These activities are teaching demonstrations, not psychological tests. They say nothing about personality, intelligence or mental health.</li>
          </ul>
        </details>
        <button className="btn primary big" disabled={!nick.trim() || busy || (info !== null && !info.joinable)} onClick={join} data-testid="join-btn">
          {busy ? "Joining…" : "Join"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ session */
function ParticipantSession({ code, token, onLost }: { code: string; token: string; onLost: () => void }) {
  const headers = { "x-participant-token": token };
  const fetcher = useCallback(() => api<ParticipantView>("GET", "/api/p/me", undefined, headers), [token]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: serverView, setData, error, refresh } = useLive(fetcher, `/api/events?role=participant&t=${encodeURIComponent(token)}`, 6000);
  const [busy, setBusy] = useState(false);
  const [netIssue, setNetIssue] = useState(false);
  /*
   * Optimistic advance: the next stimulus is already known (and preloaded), so after an answer the next item
   * is shown immediately while answers are saved in order in the background. Students far from the server
   * (e.g. 300–400 ms away) would otherwise wait ~0.7 s after every answer. The server still enforces order
   * and de-duplicates retries, so this cannot skip or double-count anything.
   */
  const [local, setLocal] = useState<ParticipantView | null>(null);
  const queue = useRef<{ trialKey: string; response: TrialResponse; rtMs: number }[]>([]);
  const draining = useRef(false);
  // Anything other than "testing" on the server (e.g. the instructor locked) always wins over local state.
  const view = local && serverView?.phase === "testing" ? local : serverView;
  usePrefetch(view?.upcoming ?? []);

  useEffect(() => { if (error instanceof ApiError && error.status === 401) onLost(); }, [error, onLost]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const drain = async () => {
    if (draining.current) return;
    draining.current = true;
    let last: ParticipantView | null = null;
    while (queue.current.length) {
      const body = queue.current[0];
      let done = false;
      for (let attempt = 0; !done; attempt++) {
        try {
          const out = await api<{ view: ParticipantView }>("POST", "/api/p/respond", body, headers);
          last = out.view; done = true; setNetIssue(false);
          // Merge the server's look-ahead into what is on screen, so the page can keep advancing instantly.
          setLocal((cur) => {
            if (!cur?.current) return cur;
            const ahead = [out.view.current, ...out.view.upcoming].filter((t): t is NonNullable<typeof t> => !!t);
            const at = ahead.findIndex((t) => t.key === cur.current!.key);
            if (at < 0) return cur;
            const upcoming = ahead.slice(at + 1);
            return upcoming.length > cur.upcoming.length ? { ...cur, upcoming, next: upcoming[0] ?? null } : cur;
          });
        } catch (e) {
          if (e instanceof ApiError && (e.body.view || e.status < 500)) {
            // Out of sync (e.g. test locked, or answered on another tab): drop pending answers and resync.
            queue.current = [];
            if (e.body.view) setData(e.body.view as ParticipantView);
            setLocal(null); setBusy(false); draining.current = false;
            void refresh();
            return;
          }
          setNetIssue(true);
          await new Promise((res) => setTimeout(res, Math.min(8000, 500 * 2 ** attempt))); // retries are safe: the server de-duplicates
        }
      }
      queue.current.shift();
    }
    draining.current = false;
    if (last) setData(last);
    setLocal(null);
    setBusy(false);
  };

  const submit = (r: TrialResponse, rtMs: number) => {
    const v = view;
    if (!v?.current || busy) return;
    queue.current.push({ trialKey: v.current.key, response: r, rtMs });
    if (v.upcoming.length) {
      const task = v.current.task;
      const [nextItem, ...rest] = v.upcoming;
      setLocal({
        ...v,
        current: nextItem,
        upcoming: rest,
        next: rest[0] ?? null,
        me: { ...v.me, answered: v.me.answered + 1 },
        progress: { ...v.progress, [task]: { ...v.progress[task], answered: v.progress[task].answered + 1 } },
      });
    } else {
      setBusy(true); // last item (or look-ahead used up): wait for the server before moving on
    }
    void drain();
  };

  if (!view) return <div className="page narrow"><div className="card"><p>{error ? error.message : "Connecting…"}</p></div></div>;

  return (
    <div className="participant">
      <header className="p-header">
        <div><b>{view.session.title}</b><span className="muted"> · {view.me.nickname}</span></div>
        {view.phase === "testing" && <Progress view={view} />}
      </header>
      {netIssue && <div className="banner warn">Connection problem — retrying. Your answers are safe.</div>}
      {/* Instructor messages reach every student while the test is open, including those who have already finished. */}
      {view.notice && (
        <div className="banner notice" role="status" aria-live="polite" data-testid="notice" key={view.notice}>
          <span className="notice-label">Message from your instructor</span> {view.notice}
          {view.phase === "finished-waiting" && <span className="notice-done"> You've already finished — nothing more to do.</span>}
        </div>
      )}
      <main className="p-main">
        {view.phase === "lobby" && <Lobby view={view} token={token} onUpdate={setData} />}
        {view.phase === "testing" && view.current && <Testing view={view} busy={busy} onSubmit={submit} />}
        {view.phase === "finished-waiting" && (
          <Waiting icon="✓" title="You've completed all the activities." text="Please wait while the rest of the class finishes." testId="finished-waiting">
            <Predict view={view} token={token} onUpdate={setData} />
          </Waiting>
        )}
        {view.phase === "locked-waiting" && (
          <Waiting icon="🔒" title="Your responses have been submitted."
            text="The activity is now closed. The instructor will talk you through the activities and reveal the answers shortly. Please keep this page open."
            extra={!view.me.finished ? "You didn't reach the end of every activity — the parts you completed are saved." : undefined}
            testId="locked-waiting">
            <Predict view={view} token={token} onUpdate={setData} />
          </Waiting>
        )}
        {view.phase === "results" && <Report token={token} />}
      </main>
      <footer className="p-footer muted">Session {code}</footer>
    </div>
  );
}

function Progress({ view }: { view: ParticipantView }) {
  return (
    <div className="p-progress">
      {TASK_IDS.map((t, i) => {
        const pr = view.progress[t];
        return (
          <div key={t} className={`p-step ${view.current?.task === t ? "active" : pr.answered >= pr.total ? "done" : ""}`}>
            <span>{i + 1}</span>
            <div className="p-step-bar"><div style={{ width: `${(pr.answered / pr.total) * 100}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function Lobby({ view, token, onUpdate }: { view: ParticipantView; token: string; onUpdate: (v: ParticipantView) => void }) {
  const toggle = async () => {
    const v = await api<ParticipantView>("POST", "/api/p/consent", { consent: !view.me.consent }, { "x-participant-token": token });
    onUpdate(v);
  };
  return (
    <div className="card center-card" data-testid="lobby">
      <div className="pulse-dot" />
      <h2>You're in, {view.me.nickname}.</h2>
      <p>Waiting for the instructor to start. Keep this page open.</p>
      <div className="expect">
        {TASK_IDS.map((t, i) => <div key={t} className="expect-item"><span>{i + 1}</span>{TASK_TITLES[t]}</div>)}
      </div>
      <p className="muted small">You won't receive feedback during the activities. Answers are discussed together afterwards.</p>
      <label className="check small">
        <input type="checkbox" checked={view.me.consent} onChange={toggle} />
        <span>Include my anonymous responses in class statistics</span>
      </label>
    </div>
  );
}

function Testing({ view, busy, onSubmit }: { view: ParticipantView; busy: boolean; onSubmit: (r: TrialResponse, rt: number) => void }) {
  const t = view.current!;
  const introKey = `apl:intro:${view.me.id}:${t.task}:${t.practice ? "practice" : "scored"}`;
  const needsIntro = t.index === 0 && !store.get(introKey);
  const [, force] = useState(0);
  const intro = TASK_INTROS[t.task];
  const taskNo = TASK_IDS.indexOf(t.task) + 1;
  if (needsIntro) {
    const dismiss = () => { store.set(introKey, "1"); force((n) => n + 1); };
    return t.practice ? (
      <div className="card intro-card" data-testid="task-intro">
        <div className="eyebrow">Activity {taskNo} of 3</div>
        <h2>{TASK_TITLES[t.task]}</h2>
        <p>{intro.lead}</p>
        <ol>{intro.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="muted">First, {t.blockSize === 1 ? "one practice item" : `${t.blockSize} practice items`} to get used to the controls (not scored).</p>
        <button className="btn primary big" onClick={dismiss} data-testid="start-practice">Start practice</button>
      </div>
    ) : (
      <div className="card intro-card" data-testid="scored-intro">
        <div className="eyebrow">{TASK_TITLES[t.task]}</div>
        <h2>Practice done. Now the real ones.</h2>
        <p>{t.blockSize} {intro.noun}. You won't get feedback along the way — the answers are revealed together at the end.</p>
        <button className="btn primary big" onClick={dismiss} data-testid="start-scored">Begin</button>
      </div>
    );
  }
  return (
    <div className="card trial-card">
      <div className="trial-meta">
        <span className="eyebrow">{TASK_TITLES[t.task]}</span>
        <span className={`tag ${t.practice ? "tag-practice" : ""}`}>{t.practice ? `Practice ${t.index + 1} of ${t.blockSize} · not scored` : `${t.index + 1} of ${t.blockSize}`}</span>
      </div>
      <Trial trial={t} busy={busy} onSubmit={onSubmit} />
    </div>
  );
}

function Waiting({ icon, title, text, extra, testId, children }: { icon: string; title: string; text: string; extra?: string; testId: string; children?: ReactNode }) {
  return (
    <div className="card center-card waiting" data-testid={testId}>
      <div className="big-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
      {extra && <p className="muted">{extra}</p>}
      {children}
    </div>
  );
}

/** A quick guess while waiting. After release, the report compares it with the truth. */
function Predict({ view, token, onUpdate }: { view: ParticipantView; token: string; onUpdate: (v: ParticipantView) => void }) {
  const keys = Object.keys(PREDICTION_QUESTIONS) as PredictionKey[];
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, view.me.predictions[k]?.toString() ?? ""])));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(keys.every((k) => view.me.predictions[k] != null) ? "saved" : "idle");
  const valid = keys.every((k) => draft[k] !== "" && Number.isInteger(Number(draft[k])) && Number(draft[k]) >= 0 && Number(draft[k]) <= PREDICTION_QUESTIONS[k].max);
  const save = async () => {
    setState("saving");
    try {
      const v = await api<ParticipantView>("POST", "/api/p/predict", Object.fromEntries(keys.map((k) => [k, Number(draft[k])])), { "x-participant-token": token });
      onUpdate(v); setState("saved");
    } catch { setState("error"); }
  };
  return (
    <div className="predict" data-testid="predict">
      <h3>While you wait: two quick guesses</h3>
      {keys.map((k) => (
        <label key={k} className="predict-row">{PREDICTION_QUESTIONS[k].label}
          <input type="number" inputMode="numeric" min={0} max={PREDICTION_QUESTIONS[k].max} value={draft[k]} data-testid={`predict-${k}`}
            onChange={(e) => { setDraft({ ...draft, [k]: e.target.value }); setState("idle"); }} />
        </label>
      ))}
      <button className="btn primary" disabled={!valid || state === "saving"} onClick={save} data-testid="predict-save">
        {state === "saved" ? "Saved ✓ (you can change it)" : state === "saving" ? "Saving…" : "Save my guesses"}
      </button>
      {state === "error" && <p className="alert small">Couldn't save — please try again.</p>}
    </div>
  );
}
