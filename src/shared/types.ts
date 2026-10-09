/** Types shared between server and client. Nothing here contains answer keys. */

export const SESSION_STATES = [
  "LOBBY",
  "TESTING_OPEN",
  "TEST_LOCKED_AWAITING_DEBRIEF",
  "ANSWER_WALKTHROUGH",
  "RESULTS_RELEASED",
  "SESSION_CLOSED",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export type TaskId = "faces" | "sequences" | "charts";
export const TASK_IDS: TaskId[] = ["faces", "sequences", "charts"];
export const TASK_TITLES: Record<TaskId, string> = {
  faces: "Faces in the Noise",
  sequences: "Coin Sequences",
  charts: "Branch Data",
};

export type Confidence = 1 | 2 | 3;
export const CONFIDENCE_LABELS: Record<Confidence, string> = { 1: "Guessing", 2: "Fairly sure", 3: "Very sure" };

export interface FaceResponse { face: boolean; x?: number; y?: number; confidence: Confidence }
export interface SequenceResponse { judgment: "random" | "rule"; confidence: Confidence }
export interface ChartResponse { judgment: "related" | "unrelated"; confidence: Confidence }
export type TrialResponse = FaceResponse | SequenceResponse | ChartResponse;

export interface Variable { name: string; unit: string; mean: number; sd: number; decimals: number }

export type Stimulus =
  | { kind: "face"; imageUrl: string }
  | { kind: "sequence"; flips: string }
  | { kind: "chart"; x: Variable; y: Variable; points: [number, number][] };

/** What a participant's browser receives for one trial: never the answer. */
export interface TrialView {
  key: string;
  task: TaskId;
  practice: boolean;
  /** 0-based position within this task's practice or scored block */
  index: number;
  blockSize: number;
  stimulus: Stimulus;
}

export type ParticipantPhase =
  | "lobby"
  | "testing"
  | "finished-waiting"
  | "locked-waiting"
  | "results"
  | "closed-not-joined";

export interface ParticipantView {
  session: { title: string; code: string; state: SessionState };
  me: { id: string; nickname: string; consent: boolean; finished: boolean; answered: number; total: number };
  phase: ParticipantPhase;
  current: TrialView | null;
  /** Prefetch hint for the following trial's stimulus (still no answer). */
  next: TrialView | null;
  /** progress per task: answered / total */
  progress: Record<TaskId, { answered: number; total: number }>;
}

export type ParticipantStatus = "lobby" | "in-progress" | "finished" | "incomplete";

export type RankingMode = "none" | "top1" | "top3" | "bottom1" | "bottom3" | "topN" | "bottomN" | "rank" | "range" | "all";
export interface RankingConfig {
  mode: RankingMode;
  task: TaskId;
  metric: string;
  n?: number;
  rank?: number;
  from?: number;
  to?: number;
}

export type ProjectorResultsMode = "results" | "rankings" | "discussion" | "conclusion";

export interface WalkthroughPointer {
  task: TaskId;
  index: number;
  revealed: boolean;
  view: "item" | "summary";
  featuredOnly: boolean;
}
