import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { useParams, useSearchParams } from "react-router-dom";
import type { MetricDef } from "../../shared/scoring";
import type { SessionState, Stimulus, TaskId, WalkthroughPointer } from "../../shared/types";
import { PREDICTION_QUESTIONS, TASK_IDS, TASK_TITLES, TASK_TITLES_DEBRIEF, type PredictionKey } from "../../shared/types";
import { api, ApiError, screenKeyStore, store } from "../api";
import { HBar, num, pct } from "../components/Bars";
import { FaceImage } from "../components/FaceImage";
import { useLive } from "../live";
import { ItemStage, SummaryStage, type ClassAnswer, type RevealContent, type WalkItem } from "./WalkthroughStage";

interface ItemStat { itemId: string; number: number; signal: boolean; group: string; n: number; pctSaidSignal: number | null; meanConfidence: number | null }
interface ClassTask {
  task: TaskId; n: number; means: Record<string, number | null>; metricN: Record<string, number>;
  confidence: { correct: number | null; incorrect: number | null }; items: ItemStat[];
  faceClicksOnNoise?: { itemId: string; x: number; y: number }[]; ruleRateByProcess?: Record<string, number | null>;
}
interface ScreenData {
  session: { title: string; code: string; state: SessionState; projectorMode: string; discussionIndex: number; publicUrl: string | null };
  counts: { joined: number; notStarted: number; takingTest: number; finished: number; connected: number; incomplete: number };
  perTask: Record<TaskId, { started: number; completed: number }>;
  walkthrough?: {
    pointer: WalkthroughPointer; total: number; totalAll: number; item: WalkItem; reveal: RevealContent | null; classAnswer: ClassAnswer | null;
    summary: { notes: string[]; items: { number: number; stimulus: Stimulus; reveal: RevealContent | null }[] } | null;
  };
  results?: { classResults: Record<TaskId, ClassTask>; counts: Record<string, number> };
  predictions?: Record<PredictionKey, { n: number; mean: number | null; median: number | null; truth: number; max: number }>;
  metrics?: Record<TaskId, MetricDef[]>;
  ranking?: { metricLabel: string; better: string; format: string; nRanked: number; rows: { rank: number; nickname: string; value: number }[]; config: { task: TaskId } } | null;
  discussion?: string[];
  conclusion?: string[];
}

export function ProjectorPage() {
  const { sid = "" } = useParams();
  const [params] = useSearchParams();
  const [key] = useState(() => {
    const k = params.get("k");
    if (k) store.set(screenKeyStore(sid), k);
    return k ?? store.get(screenKeyStore(sid)) ?? "";
  });
  const fetcher = useCallback(() => api<ScreenData>("GET", `/api/screen/${sid}`, undefined, { "x-screen-key": key }), [sid, key]);
  const { data, error } = useLive(fetcher, key ? `/api/events?role=screen&sid=${sid}&k=${encodeURIComponent(key)}` : null, 4000);
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return <div className="projector"><div className="pj-center"><h1>Projector link invalid</h1><p>{error.message}</p></div></div>;
  if (!data) return <div className="projector"><div className="pj-center"><p>Connecting…</p></div></div>;
  const s = data.session;
  return (
    <div className={`projector mode-${s.state}`} data-testid="projector" data-state={s.state}>
      <header className="pj-header">
        <span className="pj-title">{s.title}</span>
        <span className={`pj-mode pj-mode-${s.state}`}>{modeLabel(s.state, s.projectorMode)}</span>
      </header>
      <main className="pj-main">
        {(s.state === "LOBBY" || s.state === "TESTING_OPEN") && <Monitor data={data} />}
        {s.state === "TEST_LOCKED_AWAITING_DEBRIEF" && <Locked data={data} />}
        {s.state === "ANSWER_WALKTHROUGH" && data.walkthrough && <Walk data={data} assetKey={key} />}
        {(s.state === "RESULTS_RELEASED" || s.state === "SESSION_CLOSED") && <ResultsMode data={data} />}
      </main>
    </div>
  );
}

function modeLabel(state: SessionState, pm: string) {
  if (state === "LOBBY") return "Waiting to start";
  if (state === "TESTING_OPEN") return "Live · test in progress";
  if (state === "TEST_LOCKED_AWAITING_DEBRIEF") return "Responses locked";
  if (state === "ANSWER_WALKTHROUGH") return "Answer walkthrough";
  if (state === "SESSION_CLOSED") return "Session closed";
  return pm === "rankings" ? "Rankings" : pm === "discussion" ? "Discussion" : pm === "conclusion" ? "Conclusion" : "Class results";
}

/* ------------------------------------------------------------------ live monitoring */
function Monitor({ data }: { data: ScreenData }) {
  const s = data.session, c = data.counts;
  const full = `${s.publicUrl ?? window.location.origin}/j/${s.code}`;
  const url = full.replace(/^https?:\/\//, "");
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toString(full, { type: "svg", margin: 1, color: { dark: "#0b1020", light: "#ffffff" } }).then(setQr).catch(() => setQr("")); }, [full]);
  return (
    <div className="pj-monitor">
      <div className="pj-join">
        <div className="pj-join-main">
          <div>
            <div className="pj-join-label">Join at</div>
            <div className="pj-url" data-testid="pj-url">{url}</div>
            <div className="pj-join-label">or enter code</div>
            <div className="pj-code" data-testid="pj-code">{s.code}</div>
          </div>
          {qr && <div className="pj-qr" data-testid="pj-qr" aria-label="QR code for the join link" dangerouslySetInnerHTML={{ __html: qr }} />}
        </div>
      </div>
      <div className="pj-counters">
        <Counter label="Joined" value={c.joined} />
        <Counter label="Working" value={c.takingTest} />
        <Counter label="Finished" value={c.finished} accent />
      </div>
      {s.state === "TESTING_OPEN" && (
        <div className="pj-tasks">
          {TASK_IDS.map((t, i) => (
            <div key={t} className="pj-task">
              <span>{i + 1}. {TASK_TITLES[t]}</span>
              <div className="pj-bar"><div style={{ width: `${c.joined ? (data.perTask[t].completed / c.joined) * 100 : 0}%` }} /></div>
              <b>{data.perTask[t].completed}/{c.joined}</b>
            </div>
          ))}
        </div>
      )}
      <p className="pj-foot">{s.state === "LOBBY" ? "The activities will start shortly." : "Take your time. When you finish, please wait — results come later."}</p>
    </div>
  );
}

function Counter({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <div className={`pj-counter ${accent ? "accent" : ""}`}><b>{value}</b><span>{label}</span></div>;
}

function Locked({ data }: { data: ScreenData }) {
  return (
    <div className="pj-center">
      <div className="pj-lock">🔒</div>
      <h1>Responses locked</h1>
      <p>{data.counts.finished} completed submissions{data.counts.incomplete ? ` · ${data.counts.incomplete} incomplete` : ""}.</p>
      <p className="pj-sub">Before we look at any answers: what do you think these activities had in common?</p>
    </div>
  );
}

/* ------------------------------------------------------------------ walkthrough */
function Walk({ data, assetKey }: { data: ScreenData; assetKey: string }) {
  const w = data.walkthrough!;
  const task = w.pointer.task;
  return (
    <div className="pj-walk">
      <div className="pj-walk-head">
        <span className="pj-task-name">{TASK_IDS.indexOf(task) + 1}. {TASK_TITLES_DEBRIEF[task]}</span>
        {w.pointer.view === "item" && <span className="muted">{w.pointer.index + 1} / {w.total}</span>}
      </div>
      {w.pointer.view === "summary" && w.summary
        ? <SummaryStage task={task} items={w.summary.items} notes={w.summary.notes} assetKey={assetKey} />
        : <ItemStage task={task} item={w.item} reveal={w.reveal} classAnswer={w.classAnswer} assetKey={assetKey} theme="dark" />}
    </div>
  );
}

/* ------------------------------------------------------------------ results */
function ResultsMode({ data }: { data: ScreenData }) {
  const s = data.session;
  if (s.projectorMode === "rankings" && data.ranking) return <Rankings data={data} />;
  if (s.projectorMode === "discussion" && data.discussion) {
    return (
      <div className="pj-center pj-discussion" data-testid="pj-discussion">
        <div className="pj-sub">Discussion · {s.discussionIndex + 1} of {data.discussion.length}</div>
        <h1>{data.discussion[s.discussionIndex]}</h1>
      </div>
    );
  }
  if ((s.projectorMode === "conclusion" || s.state === "SESSION_CLOSED") && data.conclusion) {
    return (
      <div className="pj-center pj-conclusion" data-testid="pj-conclusion">
        <h1>Perceiving a pattern ≠ establishing a pattern</h1>
        <ul>{data.conclusion.map((c) => <li key={c}>{c}</li>)}</ul>
      </div>
    );
  }
  return <ClassResults data={data} />;
}

type Tab = "overview" | TaskId | "confidence";
function ClassResults({ data }: { data: ScreenData }) {
  const [tab, setTab] = useState<Tab>("overview");
  const cr = data.results!.classResults;
  return (
    <div className="pj-results" data-testid="pj-results">
      <nav className="pj-tabs">
        {(["overview", "faces", "sequences", "charts", "confidence"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "overview" ? "Overview" : t === "confidence" ? "Confidence" : TASK_TITLES_DEBRIEF[t as TaskId]}</button>
        ))}
      </nav>
      {tab === "overview" && (
        <div className="pj-grid3">
          {TASK_IDS.map((t) => (
            <div key={t} className="pj-card">
              <h3>{TASK_TITLES_DEBRIEF[t]}</h3>
              <div className="pj-n">n = {cr[t].n}</div>
              <HBar label={t === "faces" ? "Real faces found" : t === "sequences" ? "Hidden rules detected" : "Real relationships detected"} value={cr[t].means.hitRate} tone="hit" />
              <HBar label={t === "faces" ? "Faces “seen” in pure noise" : t === "sequences" ? "Fair coins called “rule”" : "Unrelated charts called “real”"} value={cr[t].means.falseAlarmRate} tone="fa" />
            </div>
          ))}
          <KeyContrasts cr={cr} />
          <Predictions data={data} />
          <p className="pj-caption">Class averages of each person's rate. Only completed activities from participants who agreed to be included are counted.</p>
        </div>
      )}
      {tab === "faces" && <FacesResults c={cr.faces} />}
      {tab === "sequences" && <SequenceResults c={cr.sequences} />}
      {tab === "charts" && <ChartResults c={cr.charts} />}
      {tab === "confidence" && (
        <div className="pj-grid3">
          {TASK_IDS.map((t) => (
            <div key={t} className="pj-card">
              <h3>{TASK_TITLES_DEBRIEF[t]}</h3>
              <HBar label="Confidence when correct" value={cr[t].confidence.correct} max={3} format="num" tone="hit" />
              <HBar label="Confidence when wrong" value={cr[t].confidence.incorrect} max={3} format="num" tone="fa" />
            </div>
          ))}
          <p className="pj-caption">Average confidence on a 1–3 scale (1 = guessing, 3 = very sure). If wrong answers feel almost as certain as right ones, the feeling of certainty is weak evidence.</p>
        </div>
      )}
    </div>
  );
}

/** The three contrasts the debrief is built on, side by side on the first results screen. */
function KeyContrasts({ cr }: { cr: Record<TaskId, ClassTask> }) {
  const byGroup = (c: ClassTask, g: string) => {
    const xs = c.items.filter((i) => i.group === g && i.pctSaidSignal != null);
    return xs.length ? xs.reduce((s, i) => s + (i.pctSaidSignal ?? 0), 0) / xs.length : null;
  };
  const r = cr.sequences.ruleRateByProcess ?? {};
  return (
    <div className="pj-card pj-key" data-testid="pj-key-contrasts">
      <h3>What the class saw</h3>
      <div className="pj-key-grid">
        <div><div className="pj-key-big">{pct(cr.faces.means.falseAlarmRate)}</div><div>of face-free images were reported as having a face</div></div>
        <div><div className="pj-key-big">{pct(r.streaky ?? null)} <span>vs</span> {pct(r.switchy ?? null)}</div><div>called “rule”: coins that <b>repeat</b> vs coins that <b>switch</b> (both had a rule)</div></div>
        <div><div className="pj-key-big">{pct(byGroup(cr.charts, "selected"))} <span>vs</span> {pct(byGroup(cr.charts, "independent"))}</div><div>called “real”: cherry-picked vs ordinary unrelated charts (none were real)</div></div>
      </div>
    </div>
  );
}

function Predictions({ data }: { data: ScreenData }) {
  const p = data.predictions;
  if (!p || !Object.values(p).some((x) => x.n > 0)) return null;
  return (
    <div className="pj-card" data-testid="pj-predictions">
      <h3>Your guesses vs. the truth</h3>
      {(Object.keys(PREDICTION_QUESTIONS) as PredictionKey[]).filter((k) => p[k]?.n).map((k) => (
        <p key={k} className="pj-pred">{PREDICTION_QUESTIONS[k].label.replace("do you think ", "")}<br />
          class median guess <b>{p[k].median}</b> · actual <b>{p[k].truth}</b> <span className="pj-n">(n = {p[k].n})</span></p>
      ))}
    </div>
  );
}

function FacesResults({ c }: { c: ClassTask }) {
  const noise = c.items.filter((i) => i.group === "noise");
  const clicks = c.faceClicksOnNoise ?? [];
  const top = noise.slice().sort((a, b) => (b.pctSaidSignal ?? 0) - (a.pctSaidSignal ?? 0)).slice(0, 4);
  return (
    <div className="pj-split">
      <div className="pj-card">
        <h3>Faces in the Noise <span className="pj-n">n = {c.n}</span></h3>
        <HBar label="Real faces found (hit rate)" value={c.means.hitRate} tone="hit" />
        <HBar label="Faces reported in pure noise (false-alarm rate)" value={c.means.falseAlarmRate} tone="fa" />
        <HBar label="Clicked on the actual face (of hits)" value={c.means.localizationRate} tone="hit" />
        <p className="pj-caption">{clicks.length} times, someone marked a face in an image that contained only noise.</p>
      </div>
      <div className="pj-card">
        <h3>Where faces were “seen” in pure noise</h3>
        <div className="pj-heat">
          {top.map((it) => (
            <figure key={it.itemId}>
              <FaceImage src={`/stim/faces/${it.itemId}.png`} dots={clicks.filter((k) => k.itemId === it.itemId)} />
              <figcaption>Image {it.number}: {pct(it.pctSaidSignal)} said “face”</figcaption>
            </figure>
          ))}
        </div>
        <p className="pj-caption">The four noise-only images most often reported as containing a face. Each dot is one classmate's click.</p>
      </div>
    </div>
  );
}

function SequenceResults({ c }: { c: ClassTask }) {
  const r = c.ruleRateByProcess ?? {};
  return (
    <div className="pj-split">
      <div className="pj-card">
        <h3>How often the class said “hidden rule” <span className="pj-n">n = {c.n}</span></h3>
        <HBar label="Fair coin (no rule)" sub="any ‘rule’ here is a false alarm" value={r.fair ?? null} tone="fa" />
        <HBar label="Rule: tends to switch (70%)" value={r.switchy ?? null} tone="hit" />
        <HBar label="Rule: tends to repeat (70%)" value={r.streaky ?? null} tone="hit" />
        <p className="pj-caption">Research finds people expect randomness to switch more often than it really does (Falk &amp; Konold, 1997), so genuine streaks feel like a pattern, and over-switching feels random.</p>
      </div>
      <div className="pj-card">
        <h3>Each sequence</h3>
        <div className="pj-items">{c.items.map((i) => <HBar key={i.itemId} label={`Sequence ${i.number}`} sub={i.group === "fair" ? "fair coin" : i.group === "switchy" ? "rule: switches" : "rule: repeats"} value={i.pctSaidSignal} tone={i.signal ? "hit" : "fa"} />)}</div>
      </div>
    </div>
  );
}

function ChartResults({ c }: { c: ClassTask }) {
  const by = (g: string) => {
    const xs = c.items.filter((i) => i.group === g && i.pctSaidSignal != null);
    return xs.length ? xs.reduce((s, i) => s + (i.pctSaidSignal ?? 0), 0) / xs.length : null;
  };
  const label = (g: string) => (g === "planted" ? "real" : g === "independent" ? "unrelated" : "cherry-picked");
  return (
    <div className="pj-split">
      <div className="pj-card">
        <h3>How often the class said “real relationship” <span className="pj-n">n = {c.n}</span></h3>
        <HBar label="Real (planted) relationships" value={by("planted")} tone="hit" />
        <HBar label="Unrelated — random draw" value={by("independent")} tone="fa" />
        <HBar label="Unrelated — most striking of 100" value={by("selected")} tone="fa" />
        <p className="pj-caption">The cherry-picked charts contain no relationship at all. They were selected the way an analyst might select from many variable pairs, and they did not replicate in fresh data.</p>
      </div>
      <div className="pj-card">
        <h3>Each chart</h3>
        <div className="pj-items">{c.items.map((i) => <HBar key={i.itemId} label={`Chart ${i.number}`} sub={label(i.group)} value={i.pctSaidSignal} tone={i.signal ? "hit" : "fa"} />)}</div>
      </div>
    </div>
  );
}

function Rankings({ data }: { data: ScreenData }) {
  const r = data.ranking!;
  return (
    <div className="pj-center pj-rank" data-testid="pj-rankings">
      <div className="pj-sub">{TASK_TITLES[r.config.task]} · ranked by {r.metricLabel} · {r.better === "lower" ? "lower is better" : "higher is better"} · {r.nRanked} participants ranked</div>
      <ol className="pj-rank-list">
        {r.rows.map((row) => (
          <li key={row.nickname}><span className="rk">#{row.rank}</span><span className="nm">{row.nickname}</span><span className="vl">{r.format === "pct" ? pct(row.value) : num(row.value)}</span></li>
        ))}
      </ol>
      <p className="pj-caption">A ranking on one metric of one short task. It reflects a few minutes of judgments, not a personal trait.</p>
    </div>
  );
}
