import { useEffect, useState } from "react";
import type { MetricDef, TaskScore } from "../../shared/scoring";
import type { TaskId } from "../../shared/types";
import { CONFIDENCE_LABELS, PREDICTION_QUESTIONS, TASK_TITLES_DEBRIEF as TASK_TITLES, type PredictionKey, type Predictions } from "../../shared/types";
import { api } from "../api";
import { CompareRow, num } from "../components/Bars";

interface ReportTask {
  task: TaskId;
  includedInClass: boolean;
  score: Omit<TaskScore, "items">;
  review: { number: number; group: string; signal: boolean; saidSignal: boolean; correct: boolean; confidence: number; onTarget?: boolean }[];
  classN: number;
  classMeans: Record<string, number | null>;
  classMetricN: Record<string, number>;
  classConfidence: { correct: number | null; incorrect: number | null };
  classRuleRateByProcess: Record<string, number | null> | null;
  metrics: MetricDef[];
}
interface PredSummary { n: number; mean: number | null; median: number | null; truth: number; max: number }
interface ReportData {
  nickname: string; consent: boolean; excluded: boolean; tasks: ReportTask[];
  predictions?: { mine: Predictions; class: Record<PredictionKey, PredSummary> };
}

const pctR = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Three plain-language sentences before any chart: what happened to *you*, in counts, next to the class. */
function takeaways(d: ReportData): string[] {
  const out: string[] = [];
  const t = (id: TaskId) => d.tasks.find((x) => x.task === id);
  const f = t("faces");
  if (f?.score.complete) out.push(`You marked a face in ${f.score.falseAlarms} of the ${f.score.nNoise} images that had no face at all (class average ${pctR(f.classMeans.falseAlarmRate)}), and found ${f.score.hits} of the ${f.score.nSignal} real ones.`);
  const q = t("sequences");
  const fair = q?.score.ruleRateByProcess?.fair;
  if (q?.score.complete && fair != null) out.push(`You saw a “hidden rule” in ${Math.round(fair * 6)} of the 6 sequences that came from a perfectly fair coin (class average ${pctR(q.classRuleRateByProcess?.fair)}).`);
  const c = t("charts");
  if (c?.score.complete && c.score.faRateSelected != null) out.push(`You called ${Math.round(c.score.faRateSelected * 4)} of the 4 cherry-picked, unrelated charts “real” (class average ${pctR(c.classMeans.faRateSelected)}). None of them held up in fresh data.`);
  return out;
}

const GROUP_LABEL: Record<string, string> = {
  face: "face", noise: "noise", fair: "fair coin", switchy: "rule: switches", streaky: "rule: repeats",
  planted: "real", independent: "unrelated", selected: "unrelated (cherry-picked)",
};
const SIGNAL_WORDS: Record<TaskId, [string, string]> = { faces: ["face", "no face"], sequences: ["rule", "fair"], charts: ["real", "not real"] };

const INTERPRET: Record<TaskId, string> = {
  faces: "Hits mean finding faces that were really there; false alarms mean seeing a face in pure noise. Everyone makes some false alarms — face perception is tuned to over-detect.",
  sequences: "A false alarm here means labelling a genuinely random sequence as rule-based. Real randomness contains more streaks than people expect, so this is very common.",
  charts: "A false alarm means calling an unrelated pair ‘real’. Cherry-picked charts are designed to look convincing — they show what searching through many variables produces.",
};

/** `version` changes whenever the server recomputes results, so an open report refreshes itself. */
export function Report({ token, version }: { token: string; version?: string | null }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<ReportData>("GET", "/api/p/report", undefined, { "x-participant-token": token }).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message));
  }, [token, version]);
  if (err) return <div className="card"><p className="alert">{err}</p></div>;
  if (!data) return <div className="card"><p>Loading your results…</p></div>;
  return (
    <div className="report" data-testid="report">
      <div className="card report-head">
        <div className="eyebrow">Your results</div>
        <h1>{data.nickname}</h1>
        <p className="muted">Each activity is scored separately — there is no overall score. Class averages use only participants who completed that activity and agreed to be included.</p>
        {(!data.consent || data.excluded) && <p className="note">Your responses are not included in the class averages{!data.consent ? " (you opted out)" : ""}.</p>}
      </div>
      {takeaways(data).length > 0 && (
        <div className="card takeaway" data-testid="takeaway">
          <h2>In short</h2>
          <ul>{takeaways(data).map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {data.predictions && Object.keys(data.predictions.mine).length > 0 && (
        <div className="card" data-testid="report-predictions">
          <h2>Your guesses vs. the truth</h2>
          {(Object.keys(PREDICTION_QUESTIONS) as PredictionKey[]).filter((k) => data.predictions!.mine[k] != null).map((k) => {
            const cls = data.predictions!.class[k];
            return (
              <p key={k}>{PREDICTION_QUESTIONS[k].label}<br />
                You guessed <b>{data.predictions!.mine[k]}</b> · the answer was <b>{cls.truth}</b>
                {cls.n > 0 && <span className="muted"> · class median guess {cls.median} (n = {cls.n})</span>}</p>
            );
          })}
        </div>
      )}
      {data.tasks.map((t) => <TaskReport key={t.task} t={t} />)}
      <div className="card muted small">
        These are short classroom demonstrations, adapted from research paradigms. They are not validated psychological tests and say nothing about personality, intelligence or mental health.
      </div>
    </div>
  );
}

function TaskReport({ t }: { t: ReportTask }) {
  const s = t.score;
  const [yes, no] = SIGNAL_WORDS[t.task];
  if (!s.complete) {
    return (
      <div className="card report-task">
        <h2>{TASK_TITLES[t.task]}</h2>
        <p className="muted">You answered {s.answered} of {s.nTrials} items, so rates can't be compared fairly with the class for this activity.</p>
      </div>
    );
  }
  const cm = t.classMeans;
  return (
    <div className="card report-task" data-testid={`report-${t.task}`}>
      <div className="report-task-head">
        <h2>{TASK_TITLES[t.task]}</h2>
        <span className="muted small">Class average: n = {t.classN}</span>
      </div>
      <div className="tiles">
        <div className="tile"><span>Correct</span><b>{s.hits + s.correctRejections} / {s.nTrials}</b></div>
        <div className="tile"><span>Hits</span><b>{s.hits} / {s.nSignal}</b></div>
        <div className="tile"><span>Misses</span><b>{s.misses}</b></div>
        <div className="tile warn"><span>False alarms</span><b>{s.falseAlarms} / {s.nNoise}</b></div>
        <div className="tile"><span>Correct rejections</span><b>{s.correctRejections}</b></div>
      </div>
      <div className="cmp">
        <CompareRow label="Accuracy" you={s.accuracy} cls={cm.accuracy} />
        <CompareRow label={t.task === "faces" ? "Faces detected (hit rate)" : t.task === "sequences" ? "Rules detected (hit rate)" : "Real relationships detected (hit rate)"} you={s.hitRate} cls={cm.hitRate} />
        <CompareRow label="False-alarm rate" note="lower = fewer false alarms" you={s.falseAlarmRate} cls={cm.falseAlarmRate} />
        {t.task === "faces" && s.localizationRate != null && <CompareRow label="Clicked on the actual face (of your hits)" you={s.localizationRate} cls={cm.localizationRate} />}
        {t.task === "charts" && <CompareRow label="Said ‘real’ to cherry-picked unrelated charts" you={s.faRateSelected ?? null} cls={cm.faRateSelected} />}
      </div>
      <details className="subsection">
        <summary>Details for the statistically curious</summary>
        <CompareRow label="Sensitivity d′" note="0 = chance" you={s.dPrime} cls={cm.dPrime} format="num" max={3} />
        <p className="small muted">{t.metrics.find((m) => m.key === "dPrime")?.explain}</p>
      </details>
      {t.task === "sequences" && s.ruleRateByProcess && t.classRuleRateByProcess && (
        <div className="subsection">
          <h3>How often you said “hidden rule”</h3>
          {(["fair", "switchy", "streaky"] as const).map((p) => (
            <CompareRow key={p} label={GROUP_LABEL[p]} you={s.ruleRateByProcess![p]} cls={t.classRuleRateByProcess![p]} />
          ))}
        </div>
      )}
      <div className="subsection">
        <h3>Confidence vs. accuracy</h3>
        <p className="small">Average confidence (1 = guessing, 3 = very sure) when you were <b>right</b>: {num(s.meanConfCorrect, 1)} · when you were <b>wrong</b>: {num(s.meanConfIncorrect, 1)}
          <span className="muted"> (class: {num(t.classConfidence.correct, 1)} vs {num(t.classConfidence.incorrect, 1)})</span></p>
      </div>
      <details className="subsection">
        <summary>Item by item ({s.hits + s.correctRejections} of {s.nTrials} correct)</summary>
        <div className="review-grid">
          {t.review.map((r) => (
            <div key={r.number} className={`review-chip ${r.correct ? "ok" : "bad"}`} title={`Item ${r.number}: truth ${GROUP_LABEL[r.group]}; you said ${r.saidSignal ? yes : no} (${CONFIDENCE_LABELS[r.confidence as 1 | 2 | 3]})`}>
              <span className="n">{r.number}</span>
              <span className="g">{GROUP_LABEL[r.group]}</span>
              <span className="a">you: {r.saidSignal ? yes : no}{r.onTarget === false ? " (wrong spot)" : ""}</span>
            </div>
          ))}
        </div>
      </details>
      <p className="interpret small">{INTERPRET[t.task]} Rates use the same denominators for everyone ({s.nSignal} signal and {s.nNoise} non-signal items), so they are directly comparable.</p>
    </div>
  );
}
