import { useEffect, useRef, useState } from "react";
import type { Confidence, TrialResponse, TrialView } from "../../shared/types";
import { CONFIDENCE_LABELS } from "../../shared/types";
import { Coins } from "./Coins";
import { FaceImage } from "./FaceImage";
import { Scatter } from "./Scatter";

interface TrialProps { trial: TrialView; busy: boolean; onSubmit: (r: TrialResponse, rtMs: number) => void }

function ConfidencePicker({ onPick, busy }: { onPick: (c: Confidence) => void; busy: boolean }) {
  return (
    <div className="confidence" data-testid="confidence">
      <div className="confidence-q">How sure are you?</div>
      <div className="confidence-btns">
        {([1, 2, 3] as Confidence[]).map((c) => (
          <button key={c} className={`btn conf conf-${c}`} disabled={busy} onClick={() => onPick(c)} data-testid={`conf-${c}`}>
            {CONFIDENCE_LABELS[c]}
          </button>
        ))}
      </div>
    </div>
  );
}

function useRt(key: string) {
  const t0 = useRef(performance.now());
  useEffect(() => { t0.current = performance.now(); }, [key]);
  return () => Math.round(performance.now() - t0.current);
}

export function FaceTrial({ trial, busy, onSubmit }: TrialProps) {
  const [pick, setPick] = useState<{ x: number; y: number } | null>(null);
  const [noFace, setNoFace] = useState(false);
  const rt = useRt(trial.key);
  useEffect(() => { setPick(null); setNoFace(false); }, [trial.key]);
  if (trial.stimulus.kind !== "face") return null;
  const decided = pick !== null || noFace;
  return (
    <div className="trial trial-face">
      <p className="trial-q">Is there a face hidden in this image? <b>If yes, tap on it.</b></p>
      <FaceImage src={trial.stimulus.imageUrl} marker={pick} onPick={(p) => { setPick(p); setNoFace(false); }} />
      <div className="choice-row">
        <button className={`btn choice ${noFace ? "selected" : ""}`} onClick={() => { setNoFace(true); setPick(null); }} data-testid="no-face">
          No face
        </button>
        <span className={`pick-hint ${pick ? "ok" : ""}`}>{pick ? "Face marked — tap again to move it" : "…or tap the image where you see a face"}</span>
      </div>
      {decided && (
        <ConfidencePicker busy={busy} onPick={(c) => onSubmit(pick ? { face: true, x: pick.x, y: pick.y, confidence: c } : { face: false, confidence: c }, rt())} />
      )}
    </div>
  );
}

export function SequenceTrial({ trial, busy, onSubmit }: TrialProps) {
  const [j, setJ] = useState<"random" | "rule" | null>(null);
  const rt = useRt(trial.key);
  useEffect(() => setJ(null), [trial.key]);
  if (trial.stimulus.kind !== "sequence") return null;
  return (
    <div className="trial trial-seq">
      <p className="trial-q">20 coin flips, left to right, in two rows. <b>Fair coin, or a coin with a hidden rule?</b></p>
      <div className="seq-frame"><Coins flips={trial.stimulus.flips} size="lg" /></div>
      <div className="choice-row two">
        <button className={`btn choice ${j === "random" ? "selected" : ""}`} onClick={() => setJ("random")} data-testid="judge-random">Fair coin</button>
        <button className={`btn choice ${j === "rule" ? "selected" : ""}`} onClick={() => setJ("rule")} data-testid="judge-rule">Hidden rule</button>
      </div>
      {j && <ConfidencePicker busy={busy} onPick={(c) => onSubmit({ judgment: j, confidence: c }, rt())} />}
    </div>
  );
}

export function ChartTrial({ trial, busy, onSubmit }: TrialProps) {
  const [j, setJ] = useState<"related" | "unrelated" | null>(null);
  const rt = useRt(trial.key);
  useEffect(() => setJ(null), [trial.key]);
  if (trial.stimulus.kind !== "chart") return null;
  const s = trial.stimulus;
  return (
    <div className="trial trial-chart">
      <p className="trial-q">Each dot is one branch. <b>Is there a real relationship between these two measures</b> — one that would still show up across many more branches?</p>
      <div className="chart-frame"><Scatter x={s.x} y={s.y} points={s.points} /></div>
      <div className="choice-row two">
        <button className={`btn choice ${j === "related" ? "selected" : ""}`} onClick={() => setJ("related")} data-testid="judge-related">Real relationship</button>
        <button className={`btn choice ${j === "unrelated" ? "selected" : ""}`} onClick={() => setJ("unrelated")} data-testid="judge-unrelated">No real relationship</button>
      </div>
      {j && <ConfidencePicker busy={busy} onPick={(c) => onSubmit({ judgment: j, confidence: c }, rt())} />}
    </div>
  );
}

export function Trial(props: TrialProps) {
  if (props.trial.task === "faces") return <FaceTrial {...props} />;
  if (props.trial.task === "sequences") return <SequenceTrial {...props} />;
  return <ChartTrial {...props} />;
}

/** Preload the next image so trials advance instantly. */
export function usePrefetch(next: TrialView | null) {
  useEffect(() => {
    if (next?.stimulus.kind === "face") { const img = new Image(); img.src = next.stimulus.imageUrl; }
  }, [next?.key]); // eslint-disable-line react-hooks/exhaustive-deps
}
