import type { Competition, Trade } from "../types";
import {
  getCompetitionResult,
  type CompetitionResult,
  type CompetitionSeasonData,
} from "./competitionResult";

/** Loading while its reads are in flight; unavailable when a read failed. */
export type CompetitionResultState =
  | CompetitionResult
  | { kind: "loading" }
  | { kind: "unavailable"; reason: "read-failed" };

/**
 * The reads the Competitions page has made for one signed-in session.
 *
 * A session belongs to one uid, and a sign-out ends it: signing back in, as
 * the same user or someone else, starts a new session with nothing cached.
 * Without that, reads denied during a sign-out would stay cached as failures,
 * and one user's results would be shown to the next user on the same tab.
 */
export type ResultsSession = {
  /** Whose reads these are; undefined while signed out. */
  uid: string | undefined;
  /**
   * Identity of this session. A read that lands after its session ended
   * carries the old token and is dropped.
   */
  token: object;
  /**
   * Read keys already started this session. Shared by every copy of the
   * session object, so a merged result never re-requests a read.
   */
  requested: Set<string>;
  seasonData: Record<string, CompetitionSeasonData | null>;
  trades: Record<string, Trade[] | null>;
};

export const createResultsSession = (
  uid: string | undefined,
): ResultsSession => ({
  uid,
  token: {},
  requested: new Set(),
  seasonData: {},
  trades: {},
});

export type ResultRead =
  | { kind: "season"; seasonId: Competition["season_id"] }
  | { kind: "trades"; competitionId: Competition["id"] };

/**
 * The reads to start now for `competitions`, marking them requested. Only
 * finished competitions are read, and nothing is read while signed out.
 * Season data is read once per season however many competitions share it,
 * and each read at most once per session.
 */
export const planResultReads = (
  session: ResultsSession,
  competitions: Competition[],
): ResultRead[] => {
  if (!session.uid) return [];
  const reads: ResultRead[] = [];
  const finished = competitions.filter((c) => c.finished);
  for (const { season_id } of finished) {
    const key = `season:${season_id}`;
    if (session.requested.has(key)) continue;
    session.requested.add(key);
    reads.push({ kind: "season", seasonId: season_id });
  }
  for (const { id } of finished) {
    const key = `trades:${id}`;
    if (session.requested.has(key)) continue;
    session.requested.add(key);
    reads.push({ kind: "trades", competitionId: id });
  }
  return reads;
};

/**
 * `session` with one read's outcome recorded, or `session` unchanged when the
 * read belongs to a session that has since ended. `data` is null when the
 * read failed.
 */
export const applyResultRead = (
  session: ResultsSession,
  token: object,
  read: ResultRead,
  data: CompetitionSeasonData | Trade[] | null,
): ResultsSession => {
  if (session.token !== token) return session;
  if (read.kind === "season") {
    return {
      ...session,
      seasonData: {
        ...session.seasonData,
        [read.seasonId]: data as CompetitionSeasonData | null,
      },
    };
  }
  return {
    ...session,
    trades: { ...session.trades, [read.competitionId]: data as Trade[] | null },
  };
};

/**
 * The result to show for each competition, keyed by competition id. A session
 * that belongs to someone other than `uid` contributes nothing, so a finished
 * competition shows as loading rather than as the previous user's result.
 */
export const resolveCompetitionResults = (
  competitions: Competition[],
  session: ResultsSession,
  uid: string | undefined,
): Record<string, CompetitionResultState> => {
  const current = session.uid === uid;
  const results: Record<string, CompetitionResultState> = {};
  for (const competition of competitions) {
    if (!competition.finished) {
      results[competition.id] = { kind: "in-progress" };
      continue;
    }
    const data = current
      ? session.seasonData[competition.season_id]
      : undefined;
    const competitionTrades = current
      ? session.trades[competition.id]
      : undefined;
    if (data === undefined || competitionTrades === undefined) {
      results[competition.id] = { kind: "loading" };
    } else if (data === null || competitionTrades === null) {
      results[competition.id] = { kind: "unavailable", reason: "read-failed" };
    } else {
      results[competition.id] = getCompetitionResult(
        competition,
        data,
        competitionTrades,
      );
    }
  }
  return results;
};

/** A list read by a subscription, tagged with the uid it was read for. */
export type UserScopedList<T> = { uid: string | undefined; data: T[] };

/**
 * `list.data` when it was read for `uid`, otherwise an empty list. A list
 * subscription keeps its last snapshot until the next one arrives, so without
 * this a sign-out or account switch would show the previous user's list.
 */
export const listForUser = <T>(
  list: UserScopedList<T>,
  uid: string | undefined,
): T[] => (uid && list.uid === uid ? list.data : []);
