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
