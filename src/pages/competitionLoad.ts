import type { FirestoreErrorCode } from "firebase/firestore";

/** How long the competition page loads before it says so. */
export const COMPETITION_SLOW_LOAD_MS = 10_000;

export type CompetitionLoadStage = "auth" | "competition" | "season";

export type CompetitionLoadState =
  | { kind: "loading"; stage: CompetitionLoadStage }
  | { kind: "signed-out" }
  | { kind: "not-found" }
  | { kind: "season-missing" }
  | {
      kind: "error";
      target: "competition" | "season";
      code: FirestoreErrorCode;
    }
  | { kind: "ready" };

export interface DocLoad {
  exists: boolean;
  loaded: boolean;
  fromCache: boolean;
  error: FirestoreErrorCode | undefined;
}

type DocStatus = "present" | "pending" | "missing" | FirestoreErrorCode;

const docStatus = (d: DocLoad): DocStatus => {
  if (d.exists) return "present";
  if (d.error) return d.error;
  // A cache-only "missing" is what the SDK reports when it can't reach the
  // server, so only the server can say a document doesn't exist.
  if (!d.loaded || d.fromCache) return "pending";
  return "missing";
};

/** One state for the competition page from auth, competition and season. */
export const getCompetitionLoadState = ({
  isAuthReady,
  isSignedIn,
  competition,
  season,
}: {
  isAuthReady: boolean;
  isSignedIn: boolean;
  competition: DocLoad;
  season: DocLoad;
}): CompetitionLoadState => {
  if (!isAuthReady) return { kind: "loading", stage: "auth" };
  if (!isSignedIn) return { kind: "signed-out" };

  const c = docStatus(competition);
  if (c === "pending") return { kind: "loading", stage: "competition" };
  if (c === "missing") return { kind: "not-found" };
  if (c !== "present") return { kind: "error", target: "competition", code: c };

  const s = docStatus(season);
  if (s === "pending") return { kind: "loading", stage: "season" };
  if (s === "missing") return { kind: "season-missing" };
  if (s !== "present") return { kind: "error", target: "season", code: s };

  return { kind: "ready" };
};

/** Timing for one load of the competition page, from start to an outcome. */
export interface CompetitionLoadVisit {
  start: number;
  authMs?: number;
  competitionMs?: number;
  slowSent: boolean;
  /** The outcome once `competition_load` has been sent for this visit. */
  done?: CompetitionLoadState["kind"];
}

export const newCompetitionLoadVisit = (now: number): CompetitionLoadVisit => ({
  start: now,
  slowSent: false,
});

type LoadEvent = [
  "competition_load" | "competition_load_slow",
  ReturnType<typeof competitionLoadEventParams>,
];

/**
 * Advances a visit to `state` and returns the events to send: at most one
 * `competition_load_slow` and one `competition_load` per visit. Signing in
 * from the signed-out gate starts a new visit, so the load that follows gets
 * its own slow and final events.
 */
export const stepCompetitionLoadVisit = (
  visit: CompetitionLoadVisit,
  state: CompetitionLoadState,
  isSlow: boolean,
  now: number,
  origin: string,
): { visit: CompetitionLoadVisit; events: LoadEvent[] } => {
  const v =
    visit.done === "signed-out" && state.kind !== "signed-out"
      ? newCompetitionLoadVisit(now)
      : visit;
  if (v.done) return { visit: v, events: [] };
  const elapsed = now - v.start;
  if (state.kind !== "loading" || state.stage !== "auth") v.authMs ??= elapsed;
  if (state.kind !== "loading" || state.stage === "season") {
    if (state.kind !== "signed-out") v.competitionMs ??= elapsed;
  }
  const params = () =>
    competitionLoadEventParams({
      state,
      elapsedMs: elapsed,
      authMs: v.authMs,
      competitionMs: v.competitionMs,
      wasSlow: v.slowSent,
      origin,
    });
  if (state.kind === "loading") {
    if (!isSlow || v.slowSent) return { visit: v, events: [] };
    v.slowSent = true;
    return { visit: v, events: [["competition_load_slow", params()]] };
  }
  v.done = state.kind;
  return { visit: v, events: [["competition_load", params()]] };
};

/**
 * Parameters for the `competition_load` analytics event. Only the outcome,
 * the stage, Firestore's error code and elapsed milliseconds: never a user,
 * competition or season identifier, and never document contents. The page
 * location and title are replaced so the URL (which carries the competition
 * id) is not attached either.
 */
export const competitionLoadEventParams = ({
  state,
  elapsedMs,
  authMs,
  competitionMs,
  wasSlow,
  origin,
}: {
  state: CompetitionLoadState;
  elapsedMs: number;
  authMs: number | undefined;
  competitionMs: number | undefined;
  wasSlow: boolean;
  origin: string;
}) => ({
  outcome: state.kind,
  stage: state.kind === "loading" ? state.stage : undefined,
  error_target: state.kind === "error" ? state.target : undefined,
  error_code: state.kind === "error" ? state.code : undefined,
  elapsed_ms: Math.round(elapsedMs),
  auth_ms: authMs === undefined ? undefined : Math.round(authMs),
  competition_ms:
    competitionMs === undefined ? undefined : Math.round(competitionMs),
  was_slow: wasSlow,
  page_location: `${origin}/competitions/:competitionId`,
  page_title: "Competition",
});
