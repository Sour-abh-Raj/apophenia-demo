import type { Stimulus, TaskId } from "../../shared/types";
import { Coins } from "../components/Coins";
import { FaceImage } from "../components/FaceImage";
import { domainOf, Scatter } from "../components/Scatter";

export interface RevealContent {
  headline: string; signal: boolean; truthLabel: string; explanation: string[]; facts: { label: string; value: string }[];
  faceOverlay?: { cx: number; cy: number; rx: number; ry: number }; faceImageUrl?: string;
  replication?: { n: number; points: [number, number][]; r: number };
}
export interface WalkItem { number: number; itemId: string; stimulus: Stimulus; featured: boolean }

const NOUN: Record<TaskId, string> = { faces: "Image", sequences: "Sequence", charts: "Chart" };
const withKey = (url: string, k: string) => `${url}?k=${encodeURIComponent(k)}`;

export function ItemStage({ task, item, reveal, assetKey, compact, theme = "light" }: {
  task: TaskId; item: WalkItem; reveal: RevealContent | null; assetKey: string; compact?: boolean; theme?: "light" | "dark";
}) {
  const st = item.stimulus;
  return (
    <div className={`stage ${compact ? "compact" : ""} ${reveal ? "revealed" : ""}`} data-testid="stage">
      <div className="stage-visual">
        <div className="stage-label">{NOUN[task]} {item.number}</div>
        {st.kind === "face" && (
          <div className="face-pair">
            <FaceImage src={st.imageUrl} overlay={reveal?.faceOverlay ?? null} />
            {reveal?.faceImageUrl && (
              <figure className="hidden-face">
                <img src={withKey(reveal.faceImageUrl, assetKey)} alt="The embedded face without noise" />
                <figcaption>The hidden face, without the noise</figcaption>
              </figure>
            )}
          </div>
        )}
        {st.kind === "sequence" && <div className="seq-frame"><Coins flips={st.flips} highlightRuns={reveal ? 4 : 0} size={compact ? "md" : "lg"} />{reveal && <div className="muted small">Runs of 4 or more highlighted</div>}</div>}
        {st.kind === "chart" && (() => {
          if (!reveal?.replication) return <div className="chart-frame"><Scatter x={st.x} y={st.y} points={st.points} theme={theme} /></div>;
          const all = [...st.points, ...reveal.replication.points];
          const domain = { x: domainOf(all.map((p) => p[0])), y: domainOf(all.map((p) => p[1])) };
          return (
            <div className="chart-pair">
              <Scatter x={st.x} y={st.y} points={st.points} domain={domain} theme={theme} title="What you saw: 30 branches" />
              <Scatter x={st.x} y={st.y} points={reveal.replication.points} domain={domain} dotR={2.6} dotOpacity={0.55} theme={theme} title={`Fresh data: ${reveal.replication.n} branches, same process`} />
            </div>
          );
        })()}
      </div>
      <div className="stage-text">
        {reveal ? (
          <div className="reveal" data-testid="reveal">
            <span className={`truth-badge ${reveal.signal ? "sig" : "nosig"}`}>{reveal.truthLabel}</span>
            <h2>{reveal.headline}</h2>
            <ul>{reveal.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
            {!compact && reveal.facts.length > 0 && (
              <dl className="facts">{reveal.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
            )}
          </div>
        ) : (
          <div className="prompt-q">
            <h2>{task === "faces" ? "Face, or no face?" : task === "sequences" ? "Fair coin, or hidden rule?" : "Real relationship, or not?"}</h2>
            <p>What did you decide — and how sure were you?</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function SummaryStage({ task, items, notes, assetKey, theme = "dark" }: {
  task: TaskId; items: { number: number; stimulus: Stimulus; reveal: RevealContent | null }[]; notes: string[]; assetKey: string; theme?: "light" | "dark";
}) {
  void assetKey;
  return (
    <div className="summary" data-testid="summary">
      <ul className="summary-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <div className={`summary-grid g-${task}`}>
        {items.map((it) => (
          <div key={it.number} className={`summary-cell ${it.reveal?.signal ? "sig" : "nosig"}`}>
            <div className="summary-top"><b>{NOUN[task]} {it.number}</b><span className={`truth-badge small ${it.reveal?.signal ? "sig" : "nosig"}`}>{it.reveal?.truthLabel}</span></div>
            {it.stimulus.kind === "face" && <FaceImage src={it.stimulus.imageUrl} overlay={it.reveal?.faceOverlay ?? null} />}
            {it.stimulus.kind === "sequence" && <Coins flips={it.stimulus.flips} highlightRuns={4} size="sm" />}
            {it.stimulus.kind === "chart" && <Scatter x={it.stimulus.x} y={it.stimulus.y} points={it.stimulus.points} dotR={6} theme={theme} />}
          </div>
        ))}
      </div>
    </div>
  );
}
