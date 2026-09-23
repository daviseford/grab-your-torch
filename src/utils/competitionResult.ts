import { sum } from "lodash-es";
import type {
  Challenge,
  Competition,
  Elimination,
  GameEvent,
  Season,
  Trade,
} from "../types";
import { filterEpisodesByMax, filterRecordByEpisode } from "./episodeFilter";
import { getParticipantName } from "./misc";
import { getPropBetScoresByUser } from "./propBetUtils";
import { getSeasonPointsByCastaway } from "./seasonPoints";
import { getOwnedCastawaysAtEpisode } from "./tradeUtils";

/**
 * A competition's final result, derived the same way the competition page
 * derives its scoreboard and never stored.
 *
 * Kept free of React and Firebase so the competitions list, and any later
 * per-participant history, can rank a competition without mounting the
 * competition page's hooks.
 */

export type CompetitionSeasonData = {
  season: Season;
  challenges: Record<string, Challenge>;
  eliminations: Record<string, Elimination>;
  events: Record<string, GameEvent>;
};

export type CompetitionStanding = {
  uid: string;
  name: string;
  total: number;
  /**
   * Standard competition ranking: one more than the number of participants
   * with strictly more points, so equal totals share a rank and the next
   * rank is skipped. The same rule the competition scoreboard shows.
   */
  rank: number;
};

export type CompetitionResult =
  /** Still running, so nobody has won and the leader is not shown. */
  | { kind: "in-progress" }
  /**
   * Marked finished, but the result cannot be stated truthfully: the finale
   * is not inside this group's episode boundary, or nobody has any points,
   * or there is nobody to rank.
   */
  | {
      kind: "unavailable";
      reason: "finale-not-revealed" | "no-scores" | "no-participants";
    }
  /** Everyone sharing the top total. More than one entry is a tie. */
  | { kind: "decided"; winners: CompetitionStanding[] };

/**
 * Every participant's total through the competition's own episode boundary:
 * roster points (ownership resolved per episode, so trades only move later
 * points) plus prop bet points. Mirrors useScoringCalculations and
 * usePropBetScoring.
 */
export const getCompetitionTotals = (
  competition: Competition,
  data: CompetitionSeasonData,
  trades: Trade[],
): Record<string, number> => {
  const maxEpisode = competition.current_episode ?? null;
  const episodes = filterEpisodesByMax(data.season.episodes || [], maxEpisode);
  const challenges = filterRecordByEpisode(data.challenges, maxEpisode);
  const eliminations = filterRecordByEpisode(data.eliminations, maxEpisode);
  const events = filterRecordByEpisode(data.events, maxEpisode);

  const castawayPoints = getSeasonPointsByCastaway(
    Object.values(challenges),
    Object.values(eliminations),
    Object.values(events),
    episodes,
    (data.season.players || []).map((player) => player.castaway_id),
  );

  const propBetScores = getPropBetScoresByUser(
    events,
    eliminations,
    challenges,
    new Set(
      (data.season.episodes || [])
        .filter((episode) => episode.post_merge)
        .map((episode) => episode.order),
    ),
    hasWinSurvivor(events),
    competition,
  );

  return Object.fromEntries(
    competition.participants.map(({ uid }) => {
      const rosterPoints = sum(
        episodes.map((episode) =>
          sum(
            getOwnedCastawaysAtEpisode(
              competition.draft_picks,
              trades,
              uid,
              episode.order,
            ).map((id) => castawayPoints[id]?.[episode.order - 1]?.total || 0),
          ),
        ),
      );
      return [uid, rosterPoints + (propBetScores[uid]?.total || 0)];
    }),
  );
};

/**
 * Participants ordered by total, highest first, ties broken by name for
 * display only: participants with equal totals share a rank.
 */
export const rankCompetitionStandings = (
  competition: Competition,
  totals: Record<string, number>,
): CompetitionStanding[] => {
  const entries = competition.participants.map(({ uid }) => ({
    uid,
    name: getParticipantName(
      competition.participants,
      uid,
      competition.team_names,
    ),
    total: totals[uid] ?? 0,
  }));
  return entries
    .map((entry) => ({
      ...entry,
      rank: 1 + entries.filter((other) => other.total > entry.total).length,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
};

/**
 * Who won a competition, if it has a winner this group is allowed to see.
 *
 * Only a finished competition has one, because the leader of a running
 * competition is not its winner. `finished` alone is not trusted: the
 * Sole Survivor must also sit inside the group's own episode boundary, so a
 * watch-along group whose flag ran ahead of its boundary is never told.
 */
export const getCompetitionResult = (
  competition: Competition,
  data: CompetitionSeasonData,
  trades: Trade[],
): CompetitionResult => {
  if (!competition.finished) return { kind: "in-progress" };

  const revealedEvents = filterRecordByEpisode(
    data.events,
    competition.current_episode ?? null,
  );
  if (!hasWinSurvivor(revealedEvents)) {
    return { kind: "unavailable", reason: "finale-not-revealed" };
  }

  if (competition.participants.length === 0) {
    return { kind: "unavailable", reason: "no-participants" };
  }

  const standings = rankCompetitionStandings(
    competition,
    getCompetitionTotals(competition, data, trades),
  );
  // Matches the scoreboard, which highlights nobody while every total is 0.
  if (standings.every((standing) => standing.total === 0)) {
    return { kind: "unavailable", reason: "no-scores" };
  }

  return {
    kind: "decided",
    winners: standings.filter((standing) => standing.rank === 1),
  };
};

const hasWinSurvivor = (events: Record<string, GameEvent>) =>
  Object.values(events).some((event) => event.action === "win_survivor");
