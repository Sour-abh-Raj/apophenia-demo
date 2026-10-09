import type { SessionState } from "./types.js";

/**
 * Server-authoritative session state machine. Participants finishing their tasks never
 * changes the session state; every transition below is an explicit instructor action.
 *
 *  LOBBY --open--> TESTING_OPEN --lock--> TEST_LOCKED_AWAITING_DEBRIEF --beginWalkthrough--> ANSWER_WALKTHROUGH
 *                       ^                         |                                               |
 *                       +--------reopen-----------+                                       releaseResults
 *                                                                                                 v
 *                                                       SESSION_CLOSED <--close-- RESULTS_RELEASED
 *
 * "AWAITING_PARTICIPANTS" (some participants finished, others still working) is a derived
 * dashboard label inside TESTING_OPEN, not a separate stored state: by design nothing about
 * participants finishing may move the session forward.
 * Ranking disclosure is a separate flag that is only settable in RESULTS_RELEASED.
 */
export const TRANSITIONS = {
  open: { from: "LOBBY", to: "TESTING_OPEN", label: "Open the test" },
  lock: { from: "TESTING_OPEN", to: "TEST_LOCKED_AWAITING_DEBRIEF", label: "Close test & lock responses" },
  reopen: { from: "TEST_LOCKED_AWAITING_DEBRIEF", to: "TESTING_OPEN", label: "Re-open test (undo lock)" },
  beginWalkthrough: { from: "TEST_LOCKED_AWAITING_DEBRIEF", to: "ANSWER_WALKTHROUGH", label: "Begin answer walkthrough" },
  releaseResults: { from: "ANSWER_WALKTHROUGH", to: "RESULTS_RELEASED", label: "Show class & individual results" },
  close: { from: "RESULTS_RELEASED", to: "SESSION_CLOSED", label: "Close & archive session" },
} as const satisfies Record<string, { from: SessionState; to: SessionState; label: string }>;

export type TransitionAction = keyof typeof TRANSITIONS;

export type TransitionResult =
  | { ok: true; changed: boolean; state: SessionState }
  | { ok: false; error: string; state: SessionState };

/** Pure transition function. Idempotent: re-sending an action that has already been applied is a no-op success. */
export function applyTransition(current: SessionState, action: string): TransitionResult {
  if (!(action in TRANSITIONS)) return { ok: false, error: `Unknown action '${action}'`, state: current };
  const t = TRANSITIONS[action as TransitionAction];
  if (current === t.from) return { ok: true, changed: true, state: t.to };
  if (current === t.to) return { ok: true, changed: false, state: current };
  return { ok: false, error: `Cannot '${action}' while session is ${current}`, state: current };
}

const ORDER: SessionState[] = ["LOBBY", "TESTING_OPEN", "TEST_LOCKED_AWAITING_DEBRIEF", "ANSWER_WALKTHROUGH", "RESULTS_RELEASED", "SESSION_CLOSED"];
export const atLeast = (s: SessionState, min: SessionState) => ORDER.indexOf(s) >= ORDER.indexOf(min);
export const resultsVisibleToParticipants = (s: SessionState) => s === "RESULTS_RELEASED" || s === "SESSION_CLOSED";
export const acceptsResponses = (s: SessionState) => s === "TESTING_OPEN";
export const acceptsJoins = (s: SessionState) => s === "LOBBY" || s === "TESTING_OPEN";
