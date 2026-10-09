import { describe, expect, it } from "vitest";
import { acceptsJoins, acceptsResponses, applyTransition, resultsVisibleToParticipants, TRANSITIONS } from "../../src/shared/stateMachine";
import { SESSION_STATES } from "../../src/shared/types";

describe("session state machine", () => {
  it("follows the instructor-controlled sequence", () => {
    let s = "LOBBY" as (typeof SESSION_STATES)[number];
    for (const a of ["open", "lock", "beginWalkthrough", "releaseResults", "close"]) {
      const r = applyTransition(s, a);
      expect(r.ok && r.changed).toBe(true);
      s = r.state;
    }
    expect(s).toBe("SESSION_CLOSED");
  });

  it("is idempotent: repeating an applied action is a no-op success (double clicks, retries)", () => {
    expect(applyTransition("TEST_LOCKED_AWAITING_DEBRIEF", "lock")).toEqual({ ok: true, changed: false, state: "TEST_LOCKED_AWAITING_DEBRIEF" });
    expect(applyTransition("RESULTS_RELEASED", "releaseResults")).toMatchObject({ ok: true, changed: false });
  });

  it("refuses skipping phases", () => {
    expect(applyTransition("TESTING_OPEN", "releaseResults").ok).toBe(false);
    expect(applyTransition("TEST_LOCKED_AWAITING_DEBRIEF", "releaseResults").ok).toBe(false); // must go through the walkthrough
    expect(applyTransition("LOBBY", "lock").ok).toBe(false);
    expect(applyTransition("ANSWER_WALKTHROUGH", "reopen").ok).toBe(false); // answers have been shown; cannot reopen
    expect(applyTransition("LOBBY", "nonsense").ok).toBe(false);
  });

  it("only RESULTS_RELEASED / SESSION_CLOSED expose results to participants", () => {
    const visible = SESSION_STATES.filter(resultsVisibleToParticipants);
    expect(visible).toEqual(["RESULTS_RELEASED", "SESSION_CLOSED"]);
    expect(SESSION_STATES.filter(acceptsResponses)).toEqual(["TESTING_OPEN"]);
    expect(SESSION_STATES.filter(acceptsJoins)).toEqual(["LOBBY", "TESTING_OPEN"]);
  });

  it("no transition is triggered by participant activity (all transitions are named instructor actions)", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(["beginWalkthrough", "close", "lock", "open", "releaseResults", "reopen"]);
  });
});
