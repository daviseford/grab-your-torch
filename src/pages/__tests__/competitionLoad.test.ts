import { describe, expect, it } from "vitest";
import {
  competitionLoadEventParams,
  getCompetitionLoadState,
  type DocLoad,
} from "../competitionLoad";

const pending: DocLoad = {
  exists: false,
  loaded: false,
  fromCache: false,
  error: undefined,
};
const present: DocLoad = { ...pending, exists: true, loaded: true };
const missing: DocLoad = { ...pending, loaded: true };
const cacheOnlyMissing: DocLoad = { ...missing, fromCache: true };
const failed: DocLoad = {
  ...pending,
  loaded: true,
  error: "permission-denied",
};

const state = (competition: DocLoad, season: DocLoad, signedIn = true) =>
  getCompetitionLoadState({
    isAuthReady: true,
    isSignedIn: signedIn,
    competition,
    season,
  });

describe("getCompetitionLoadState", () => {
  it("waits for auth before anything else", () => {
    expect(
      getCompetitionLoadState({
        isAuthReady: false,
        isSignedIn: false,
        competition: failed,
        season: failed,
      }),
    ).toEqual({ kind: "loading", stage: "auth" });
  });

  it("sends signed-out visitors to the sign-in gate", () => {
    expect(state(pending, pending, false)).toEqual({ kind: "signed-out" });
  });

  it("is ready once both documents are present", () => {
    expect(state(present, present)).toEqual({ kind: "ready" });
  });

  it("loads the competition, then the season", () => {
    expect(state(pending, pending)).toEqual({
      kind: "loading",
      stage: "competition",
    });
    expect(state(present, pending)).toEqual({
      kind: "loading",
      stage: "season",
    });
  });

  it("treats a cache-only missing document as still loading, not missing", () => {
    expect(state(cacheOnlyMissing, pending)).toEqual({
      kind: "loading",
      stage: "competition",
    });
    expect(state(present, cacheOnlyMissing)).toEqual({
      kind: "loading",
      stage: "season",
    });
  });

  it("reports a competition the server says is missing as not found", () => {
    expect(state(missing, pending)).toEqual({ kind: "not-found" });
  });

  it("reports a missing season instead of loading forever", () => {
    expect(state(present, missing)).toEqual({ kind: "season-missing" });
  });

  it("reports listener errors as errors, not as not-found", () => {
    expect(state(failed, pending)).toEqual({
      kind: "error",
      target: "competition",
      code: "permission-denied",
    });
    expect(state(present, failed)).toEqual({
      kind: "error",
      target: "season",
      code: "permission-denied",
    });
  });

  it("keeps showing a document that later fails", () => {
    expect(state({ ...present, error: "unavailable" }, present)).toEqual({
      kind: "ready",
    });
  });
});

describe("competitionLoadEventParams", () => {
  const ORIGIN = "https://grabyourtorch.com";

  it("sends only outcome, stage, error code and timings", () => {
    const params = competitionLoadEventParams({
      state: { kind: "error", target: "season", code: "permission-denied" },
      elapsedMs: 1234.6,
      authMs: 400.2,
      competitionMs: 900.9,
      wasSlow: false,
      origin: ORIGIN,
    });
    expect(params).toEqual({
      outcome: "error",
      stage: undefined,
      error_target: "season",
      error_code: "permission-denied",
      elapsed_ms: 1235,
      auth_ms: 400,
      competition_ms: 901,
      was_slow: false,
      page_location: `${ORIGIN}/competitions/:competitionId`,
      page_title: "Competition",
    });
  });

  it("never carries the real URL", () => {
    const params = competitionLoadEventParams({
      state: { kind: "loading", stage: "competition" },
      elapsedMs: 10_000,
      authMs: undefined,
      competitionMs: undefined,
      wasSlow: true,
      origin: ORIGIN,
    });
    expect(params.stage).toBe("competition");
    expect(JSON.stringify(params)).not.toMatch(/competition_[a-z0-9]/i);
  });
});
