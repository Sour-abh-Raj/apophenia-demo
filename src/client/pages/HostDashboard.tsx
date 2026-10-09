import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import type { MetricDef } from "../../shared/scoring";
import type { RankingConfig, RankingMode, SessionState, TaskId, WalkthroughPointer } from "../../shared/types";
import { TASK_IDS, TASK_TITLES } from "../../shared/types";
import { api, ApiError, hostKey, hostSessions, screenKeyStore, store } from "../api";
import { num, pct } from "../components/Bars";
import { Confirm } from "../components/Confirm";
import { useLive } from "../live";
import { ItemStage, type RevealContent, type WalkItem } from "./WalkthroughStage";

/* ------------------------------------------------------------------ types */
interface PRow {
  id: string; nickname: string; consent: boolean; excluded: boolean; connected: boolean; answered: number; total: number;
  finished: boolean; status: string; currentTask: TaskId | null; currentPractice: boolean;
  taskProgress: Record<TaskId, { answered: number; total: number }>; lastSeenSecondsAgo: number;
}
interface ClassTask { n: number; means: Record<string, number | null>; confidence: { correct: number | null; incorrect: number | null } }
interface HostData {
  session: {
    id: string; code: string; title: string; state: SessionState; walkthrough: WalkthroughPointer; projectorMode: string;
    ranking: RankingConfig | null; discussionIndex: number; lockedAt: string | null;
  };
  counts: { joined: number; takingTest: number; finished: number; incomplete: number; notFinishedYet: number; connected: number; disconnected: number; declined: number; excluded: number };
  perTask: Record<TaskId, { started: number; completed: number }>;
  participants: PRow[];
  results: null | {
    classResults: Record<TaskId, ClassTask>; counts: Record<string, number>; computedAt: string;
    participants: { id: string; nickname: string; includedTasks: TaskId[]; scores: Record<TaskId, Record<string, number | null | boolean>> }[];
  };
  ranking: null | { metricLabel: string; better: string; format: string; nRanked: number; rows: { rank: number; nickname: string; value: number }[] };
  metrics: Record<TaskId, MetricDef[]>;
  walkthrough: null | {
    pointer: WalkthroughPointer; total: number; totalAll: number; item: WalkItem; reveal: RevealContent | null;
    preview: RevealContent | null; list: { i: number; number: number; featured: boolean; truth?: string }[];
  };
  discussion: string[];
  conclusion: string[];
}

const STATE_LABEL: Record<SessionState, { label: string; tone: string; hint: string }> = {
  LOBBY: { label: "Lobby", tone: "neutral", hint: "Students can join. Nobody can start yet." },
  TESTING_OPEN: { label: "Testing open", tone: "live", hint: "Students are working. Finishing does not close the test — you decide." },
  TEST_LOCKED_AWAITING_DEBRIEF: { label: "Locked · awaiting debrief", tone: "locked", hint: "Responses are frozen. Students see “waiting for results”. Introduce apophenia now." },
  ANSWER_WALKTHROUGH: { label: "Answer walkthrough", tone: "walk", hint: "Answers appear only on the projector, item by item. Students still see the waiting screen." },
  RESULTS_RELEASED: { label: "Results released", tone: "results", hint: "Students see personal reports. Projector shows class results. Rankings are optional." },
  SESSION_CLOSED: { label: "Closed & archived", tone: "neutral", hint: "Session archived. Students can still view their reports." },
};

type Pending = { title: string; body: ReactNode; label: string; run: () => Promise<unknown>; danger?: boolean; typeWord?: string };

export function HostDashboardPage() {
  const { sid = "" } = useParams();
  const [key] = useState(() => {
    const m = /k=([^&]+)/.exec(window.location.hash);
    if (m) { store.set(hostKey(sid), decodeURIComponent(m[1])); history.replaceState(null, "", window.location.pathname); }
    return store.get(hostKey(sid));
  });
  if (!key) return <div className="page narrow"><div className="card"><h2>Instructor key not found on this browser</h2><p>Open the instructor link that includes the key, or create a new session.</p><Link to="/host">Go to instructor home</Link></div></div>;
  return <Dashboard sid={sid} hkey={key} />;
}

function Dashboard({ sid, hkey }: { sid: string; hkey: string }) {
  const H = useMemo(() => ({ "x-host-key": hkey }), [hkey]);
  const fetcher = useCallback(() => api<HostData>("GET", `/api/host/${sid}`, undefined, H), [sid, H]);
  const { data, error, refresh, connected } = useLive(fetcher, `/api/events?role=host&sid=${sid}&k=${encodeURIComponent(hkey)}`, 4000);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const call = async (method: string, path: string, body?: unknown) => {
    try { await api(method, `/api/host/${sid}${path}`, body, H); await refresh(); }
    catch (e) { setToast((e as Error).message); setTimeout(() => setToast(null), 4000); throw e; }
  };
  const transition = (action: string) => call("POST", "/transition", { action });
  const confirmRun = async () => {
    if (!pending) return;
    setBusy(true);
    try { await pending.run(); setPending(null); } catch { /* toast shown */ } finally { setBusy(false); }
  };

  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return <div className="page narrow"><div className="card"><h2>{error.status === 404 ? "Session not found (deleted?)" : "Instructor key rejected"}</h2><Link to="/host">Instructor home</Link></div></div>;
  }
  if (!data) return <div className="page"><div className="card">Loading dashboard…</div></div>;

  const s = data.session, c = data.counts;
  const st = STATE_LABEL[s.state];
  const joinUrl = `${window.location.origin}/j/${s.code}`;
  const screenKey = store.get(screenKeyStore(sid)) ?? hkey;
  const screenUrl = `${window.location.origin}/screen/${sid}?k=${encodeURIComponent(screenKey)}`;
  const completion = c.joined ? c.finished / c.joined : 0;

  return (
    <div className="host">
      <header className={`host-top tone-${st.tone}`}>
        <div className="host-title">
          <div className="eyebrow">Instructor dashboard · private — do not screen-share</div>
          <h1>{s.title}</h1>
        </div>
        <div className="host-state" data-testid="session-state" data-state={s.state}>
          <span className={`state-badge tone-${st.tone}`}>{st.label}</span>
          <span className={`live-dot ${connected ? "on" : ""}`} title={connected ? "Live updates connected" : "Polling"} />
        </div>
      </header>

      <section className="host-share card">
        <div><span className="muted small">Join code</span><div className="join-code" data-testid="join-code">{s.code}</div></div>
        <div className="share-links">
          <CopyField label="Share in Zoom chat (students)" value={joinUrl} testId="join-url" />
          <div className="share-actions">
            <a className="btn" href={screenUrl} target="_blank" rel="noreferrer" data-testid="open-projector">Open projector view ↗</a>
            <CopyButton label="Copy instructor link (other device)" value={`${window.location.origin}/host/${sid}#k=${encodeURIComponent(hkey)}`} />
          </div>
        </div>
      </section>

      <section className="phase card">
        <div className="phase-hint">{st.hint}</div>
        <PhaseControls data={data} setPending={setPending} transition={transition} call={call} />
      </section>

      <section className="tiles host-tiles">
        <Tile label="Joined" value={c.joined} />
        <Tile label="Taking test" value={c.takingTest} />
        <Tile label="Finished" value={c.finished} tone="good" />
        <Tile label={s.state === "LOBBY" || s.state === "TESTING_OPEN" ? "Not finished yet" : "Incomplete"} value={s.state === "LOBBY" || s.state === "TESTING_OPEN" ? c.notFinishedYet : c.incomplete} tone="warn" />
        <Tile label="Disconnected" value={c.disconnected} tone={c.disconnected ? "warn" : undefined} />
        <Tile label="Opted out of stats" value={c.declined} />
      </section>
      <div className="completion">
        <div className="completion-bar"><div style={{ width: `${completion * 100}%` }} /></div>
        <span>{c.finished} of {c.joined} finished ({pct(completion)})</span>
        {s.state === "TESTING_OPEN" && c.joined > 0 && c.finished === c.joined && <b className="good"> Everyone appears finished — ask “Has everyone finished?” before locking.</b>}
      </div>
      <div className="per-task">
        {TASK_IDS.map((t) => (
          <div key={t}><span>{TASK_TITLES[t]}</span><b>{data.perTask[t].completed}</b><span className="muted"> / {c.joined} completed</span></div>
        ))}
      </div>

      {data.walkthrough && s.state === "ANSWER_WALKTHROUGH" && <WalkthroughControls data={data} call={call} />}
      {(s.state === "RESULTS_RELEASED" || s.state === "SESSION_CLOSED") && <ResultsControls data={data} call={call} />}
      {data.results && <PrivateResults data={data} />}

      <ParticipantTable data={data} call={call} />

      <section className="card danger-zone">
        <h3>Data</h3>
        <div className="row wrap">
          <a className="btn" href={`/api/host/${sid}/export.csv?k=${encodeURIComponent(hkey)}`} data-testid="export-csv">Export CSV (pseudonymous)</a>
          <a className="btn ghost" href={`/api/host/${sid}/export.csv?k=${encodeURIComponent(hkey)}&nicknames=1`}>Export CSV with nicknames</a>
          <button className="btn ghost" onClick={() => setPending({
            title: "Reset session?", danger: true, typeWord: "RESET", label: "Reset",
            body: <p>Removes all participants and responses and returns the session to the lobby (same join code). Useful after a rehearsal. This cannot be undone.</p>,
            run: () => call("POST", "/reset", { confirm: "RESET" }),
          })}>Reset session…</button>
          <button className="btn danger" onClick={() => setPending({
            title: "Delete session permanently?", danger: true, typeWord: "DELETE", label: "Delete",
            body: <p>Deletes the session and all data. Students' links stop working. This cannot be undone.</p>,
            run: async () => { await call("DELETE", "", { confirm: "DELETE" }); hostSessions.remove(sid); store.del(hostKey(sid)); window.location.href = "/host"; },
          })}>Delete session…</button>
        </div>
      </section>

      {pending && <Confirm title={pending.title} body={pending.body} confirmLabel={pending.label} danger={pending.danger} typeWord={pending.typeWord} busy={busy} onConfirm={confirmRun} onCancel={() => setPending(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ phase controls */
function PhaseControls({ data, setPending, transition, call }: {
  data: HostData; setPending: (p: Pending) => void; transition: (a: string) => Promise<unknown>; call: (m: string, p: string, b?: unknown) => Promise<unknown>;
}) {
  const s = data.session, c = data.counts;
  switch (s.state) {
    case "LOBBY":
      return <button className="btn primary huge" data-testid="action-open" onClick={() => setPending({
        title: "Open the test?", label: "Open test", run: () => transition("open"),
        body: <p>{c.joined} student(s) have joined. Late joiners can still join while the test is open.</p>,
      })}>OPEN TEST</button>;
    case "TESTING_OPEN":
      return <button className="btn danger huge" data-testid="action-lock" onClick={() => setPending({
        title: "Close test & lock responses?", label: "Close test & lock", danger: true, run: () => transition("lock"),
        body: <>
          <p><b>{c.finished}</b> of <b>{c.joined}</b> participants have finished.</p>
          {c.notFinishedYet > 0 && <p className="alert">{c.notFinishedYet} participant(s) have not finished. Their completed activities are kept; unfinished activities are excluded from class averages.</p>}
          <p>Students' screens will change to “waiting for results”. No answers or scores are shown. (You can re-open the test before starting the walkthrough.)</p>
        </>,
      })}>CLOSE TEST &amp; LOCK RESPONSES</button>;
    case "TEST_LOCKED_AWAITING_DEBRIEF":
      return <div className="row wrap">
        <button className="btn primary huge" data-testid="action-walkthrough" onClick={() => setPending({
          title: "Begin answer walkthrough?", label: "Begin walkthrough", run: () => transition("beginWalkthrough"),
          body: <p>The projector view switches to the answer walkthrough. Each answer appears only when you click “Reveal”. Students' devices stay on the waiting screen — no scores are released.</p>,
        })}>BEGIN ANSWER WALKTHROUGH</button>
        <button className="btn ghost" onClick={() => setPending({ title: "Re-open the test?", label: "Re-open", run: () => transition("reopen"), body: <p>Students who haven't finished can continue. Responses will be locked again when you close the test.</p> })}>Re-open test</button>
      </div>;
    case "ANSWER_WALKTHROUGH":
      return <button className="btn results huge" data-testid="action-release" onClick={() => setPending({
        title: "Show class & individual results?", label: "Release results", run: () => transition("releaseResults"),
        body: <><p>Every student's screen changes to their personal report (their scores alongside the class average). The projector switches to class-level results.</p><p>Rankings stay hidden unless you reveal them separately.</p></>,
      })}>SHOW CLASS &amp; INDIVIDUAL RESULTS</button>;
    case "RESULTS_RELEASED":
      return <button className="btn ghost" data-testid="action-close" onClick={() => setPending({
        title: "Close & archive the session?", label: "Close session", run: () => transition("close"),
        body: <p>The projector shows the conclusion. Students keep access to their reports. Data is retained until you delete it.</p>,
      })}>Close &amp; archive session</button>;
    default:
      return <span className="muted">Session archived. <button className="btn ghost small" onClick={() => void call("POST", "/projector", { mode: "conclusion" })}>Show conclusion</button></span>;
  }
}

/* ------------------------------------------------------------------ walkthrough */
function WalkthroughControls({ data, call }: { data: HostData; call: (m: string, p: string, b?: unknown) => Promise<unknown> }) {
  const w = data.walkthrough!;
  const p = w.pointer;
  const go = (patch: Partial<WalkthroughPointer>) => void call("POST", "/walkthrough", patch).catch(() => undefined);
  const hkey = store.get(hostKey(data.session.id)) ?? "";
  return (
    <section className="card walk-ctl" data-testid="walkthrough-controls">
      <div className="walk-head">
        <h2>Answer walkthrough</h2>
        <div className="tabs">
          {TASK_IDS.map((t) => <button key={t} className={`tab ${p.task === t ? "on" : ""}`} onClick={() => go({ task: t })} data-testid={`walk-task-${t}`}>{TASK_TITLES[t]}</button>)}
        </div>
      </div>
      <div className="row wrap walk-bar">
        <button className="btn" onClick={() => go({ index: p.index - 1 })} disabled={p.index <= 0 || p.view === "summary"}>◀ Previous</button>
        <span className="walk-pos">Item {p.index + 1} of {w.total}{p.featuredOnly ? ` (featured; ${w.totalAll} total)` : ""}</span>
        <button className="btn" onClick={() => go({ index: p.index + 1 })} disabled={p.index >= w.total - 1 || p.view === "summary"} data-testid="walk-next">Next ▶</button>
        {p.view === "item" && (
          <button className={`btn ${p.revealed ? "ghost" : "primary"}`} onClick={() => go({ revealed: !p.revealed })} data-testid="walk-reveal">{p.revealed ? "Hide answer" : "Reveal answer"}</button>
        )}
        <button className={`btn ${p.view === "summary" ? "primary" : "ghost"}`} onClick={() => go({ view: p.view === "summary" ? "item" : "summary" })} data-testid="walk-summary">
          {p.view === "summary" ? "Back to items" : "Show full answer key"}
        </button>
        <label className="check small"><input type="checkbox" checked={p.featuredOnly} onChange={(e) => go({ featuredOnly: e.target.checked, index: 0 })} /> Featured items only (shorter)</label>
      </div>
      <div className="walk-body">
        <div className="walk-list">
          {w.list.map((it) => (
            <button key={it.i} className={`walk-item ${it.i === p.index ? "on" : ""}`} onClick={() => go({ index: it.i, view: "item" })}>
              <span>#{it.number}</span><span className="muted small">{it.truth}</span>
            </button>
          ))}
        </div>
        <div className="walk-preview">
          <div className="muted small">On the projector now: {p.view === "summary" ? "full answer key for this task" : p.revealed ? "item + answer" : "item only (answer hidden)"}</div>
          <ItemStage task={p.task} item={w.item} reveal={w.preview} assetKey={hkey} compact />
          {!p.revealed && p.view === "item" && <div className="private-note">Private preview — the answer above is visible only to you until you click Reveal.</div>}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ results & ranking */
const MODES: { mode: RankingMode; label: string }[] = [
  { mode: "top1", label: "Top performer" }, { mode: "top3", label: "Top three" }, { mode: "bottom1", label: "Bottom performer" },
  { mode: "bottom3", label: "Bottom three" }, { mode: "topN", label: "Top N" }, { mode: "bottomN", label: "Bottom N" },
  { mode: "rank", label: "A selected rank" }, { mode: "range", label: "A range of ranks" }, { mode: "all", label: "Entire leaderboard" },
];

function ResultsControls({ data, call }: { data: HostData; call: (m: string, p: string, b?: unknown) => Promise<unknown> }) {
  const s = data.session;
  const [task, setTask] = useState<TaskId>(s.ranking?.task ?? "faces");
  const [metric, setMetric] = useState<string>(s.ranking?.metric ?? "accuracy");
  const [mode, setMode] = useState<RankingMode>(s.ranking?.mode ?? "top3");
  const [n, setN] = useState(s.ranking?.n ?? 5);
  const [rank, setRank] = useState(s.ranking?.rank ?? 1);
  const [from, setFrom] = useState(s.ranking?.from ?? 1);
  const [to, setTo] = useState(s.ranking?.to ?? 5);
  useEffect(() => { if (!data.metrics[task].some((m) => m.key === metric)) setMetric("accuracy"); }, [task]); // eslint-disable-line react-hooks/exhaustive-deps
  const cfg: RankingConfig = { mode, task, metric, n, rank, from, to };
  const def = data.metrics[task].find((m) => m.key === metric);
  const proj = (mode: string, extra: Record<string, unknown> = {}) => void call("POST", "/projector", { mode, ...extra }).catch(() => undefined);
  return (
    <section className="card results-ctl" data-testid="results-controls">
      <h2>Projector</h2>
      <div className="row wrap">
        {(["results", "rankings", "discussion", "conclusion"] as const).map((m) => (
          <button key={m} className={`btn ${s.projectorMode === m ? "primary" : "ghost"}`} disabled={m === "rankings" && !s.ranking} onClick={() => proj(m)} data-testid={`proj-${m}`}>
            {m === "results" ? "Class results" : m === "rankings" ? "Rankings" : m === "discussion" ? "Discussion questions" : "Conclusion"}
          </button>
        ))}
      </div>
      {s.projectorMode === "discussion" && (
        <div className="row wrap discussion-nav">
          <button className="btn" disabled={s.discussionIndex <= 0} onClick={() => proj("discussion", { discussionIndex: s.discussionIndex - 1 })}>◀</button>
          <span>Question {s.discussionIndex + 1} of {data.discussion.length}: <i>{data.discussion[s.discussionIndex]}</i></span>
          <button className="btn" disabled={s.discussionIndex >= data.discussion.length - 1} onClick={() => proj("discussion", { discussionIndex: s.discussionIndex + 1 })}>▶</button>
        </div>
      )}
      <h3>Optional ranking disclosure <span className="muted small">(off by default · pseudonyms only)</span></h3>
      <div className="ranking-form">
        <label>Task<select value={task} onChange={(e) => setTask(e.target.value as TaskId)} data-testid="rank-task">{TASK_IDS.map((t) => <option key={t} value={t}>{TASK_TITLES[t]}</option>)}</select></label>
        <label>Metric<select value={metric} onChange={(e) => setMetric(e.target.value)} data-testid="rank-metric">{data.metrics[task].map((m) => <option key={m.key as string} value={m.key as string}>{m.label} ({m.better} is better)</option>)}</select></label>
        <label>Show<select value={mode} onChange={(e) => setMode(e.target.value as RankingMode)} data-testid="rank-mode">{MODES.map((m) => <option key={m.mode} value={m.mode}>{m.label}</option>)}</select></label>
        {(mode === "topN" || mode === "bottomN") && <label>N<input type="number" min={1} value={n} onChange={(e) => setN(Number(e.target.value))} /></label>}
        {mode === "rank" && <label>Rank<input type="number" min={1} value={rank} onChange={(e) => setRank(Number(e.target.value))} /></label>}
        {mode === "range" && <><label>From<input type="number" min={1} value={from} onChange={(e) => setFrom(Number(e.target.value))} /></label><label>To<input type="number" min={1} value={to} onChange={(e) => setTo(Number(e.target.value))} /></label></>}
      </div>
      {def && <p className="muted small">Ranks by <b>{def.label}</b> — {def.better} is better. {def.explain} Ties share a rank.</p>}
      <div className="row wrap">
        <button className="btn" onClick={() => void call("POST", "/ranking", { config: cfg, show: false }).catch(() => undefined)} data-testid="rank-preview">Preview privately</button>
        <button className="btn primary" onClick={() => void call("POST", "/ranking", { config: cfg, show: true }).catch(() => undefined)} data-testid="rank-show">Show on projector</button>
        <button className="btn ghost" onClick={() => void call("POST", "/ranking", { config: null }).catch(() => undefined)} disabled={!s.ranking} data-testid="rank-hide">Hide rankings</button>
      </div>
      {data.ranking && (
        <div className="rank-preview">
          <div className="muted small">{s.projectorMode === "rankings" ? "Showing on projector:" : "Private preview (not on projector):"} {data.ranking.metricLabel} · {data.ranking.nRanked} ranked</div>
          <ol className="rank-list small">{data.ranking.rows.map((r) => <li key={r.nickname}><b>#{r.rank}</b> {r.nickname} — {data.ranking!.format === "pct" ? pct(r.value) : num(r.value)}</li>)}</ol>
        </div>
      )}
    </section>
  );
}

function PrivateResults({ data }: { data: HostData }) {
  const r = data.results!;
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <button className="btn ghost" onClick={() => setOpen(!open)} data-testid="toggle-private-results">{open ? "▾" : "▸"} Private results (instructor only · computed {new Date(r.computedAt).toLocaleTimeString()})</button>
      {open && (
        <div className="private-results">
          <div className="grid3">
            {TASK_IDS.map((t) => {
              const cr = r.classResults[t];
              return (
                <div key={t} className="mini-card">
                  <h4>{TASK_TITLES[t]} <span className="muted small">n = {cr.n}</span></h4>
                  <div>Accuracy {pct(cr.means.accuracy)} · Hits {pct(cr.means.hitRate)} · False alarms {pct(cr.means.falseAlarmRate)}</div>
                  <div className="muted small">Confidence when right {num(cr.confidence.correct, 1)} vs wrong {num(cr.confidence.incorrect, 1)}</div>
                </div>
              );
            })}
          </div>
          <table className="ptable">
            <thead><tr><th>Nickname</th>{TASK_IDS.map((t) => <th key={t}>{TASK_TITLES[t]} acc · HR · FAR</th>)}</tr></thead>
            <tbody>{r.participants.map((p) => (
              <tr key={p.id}><td>{p.nickname}</td>{TASK_IDS.map((t) => {
                const sc = p.scores[t];
                return <td key={t} className={p.includedTasks.includes(t) ? "" : "muted"}>{sc.complete ? `${pct(sc.accuracy as number)} · ${pct(sc.hitRate as number)} · ${pct(sc.falseAlarmRate as number)}` : "incomplete"}{!p.includedTasks.includes(t) && sc.complete ? " (not in class stats)" : ""}</td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ participants */
function ParticipantTable({ data, call }: { data: HostData; call: (m: string, p: string, b?: unknown) => Promise<unknown> }) {
  return (
    <section className="card">
      <h2>Participants <span className="muted small">({data.participants.length})</span></h2>
      {data.participants.length === 0 ? <p className="muted">Nobody has joined yet. Share the join link in the Zoom chat.</p> : (
        <table className="ptable" data-testid="participant-table">
          <thead><tr><th></th><th>Nickname</th><th>Status</th><th>Current</th>{TASK_IDS.map((t) => <th key={t}>{TASK_TITLES[t]}</th>)}<th>Stats</th><th></th></tr></thead>
          <tbody>
            {data.participants.map((p) => (
              <tr key={p.id} className={p.excluded ? "excluded" : ""} data-testid="participant-row">
                <td><span className={`conn ${p.connected ? "on" : ""}`} title={p.connected ? "Connected" : `Last seen ${p.lastSeenSecondsAgo}s ago`} /></td>
                <td>{p.nickname}</td>
                <td><span className={`status s-${p.status}`}>{p.status}</span></td>
                <td className="small">{p.currentTask ? `${TASK_TITLES[p.currentTask]}${p.currentPractice ? " (practice)" : ""}` : p.finished ? "—" : ""}</td>
                {TASK_IDS.map((t) => {
                  const tp = p.taskProgress[t];
                  return <td key={t}><div className="mini-bar"><div style={{ width: `${(tp.answered / tp.total) * 100}%` }} /></div><span className="small muted">{tp.answered}/{tp.total}</span></td>;
                })}
                <td className="small">{p.excluded ? "excluded" : p.consent ? "included" : "opted out"}</td>
                <td><button className="btn ghost small" onClick={() => void call("POST", `/participants/${p.id}/exclude`, { excluded: !p.excluded }).catch(() => undefined)}>{p.excluded ? "Include" : "Exclude"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Exclude test devices or duplicate joins. Excluded and opted-out participants still receive their personal report but are not counted in class averages or rankings.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ small bits */
function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className={`tile ${tone ?? ""}`} data-testid={`tile-${label.toLowerCase().replace(/\s+/g, "-")}`}><span>{label}</span><b>{value}</b></div>;
}
function CopyButton({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return <button className="btn ghost" onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>{done ? "Copied ✓" : label}</button>;
}
function CopyField({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="copy-field">
      <span className="muted small">{label}</span>
      <div className="row"><input readOnly value={value} onFocus={(e) => e.currentTarget.select()} data-testid={testId} /><CopyButton label="Copy" value={value} /></div>
    </div>
  );
}
