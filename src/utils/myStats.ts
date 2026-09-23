import { sum } from "lodash-es";
import { getActivePropBetKeys } from "../data/propbets";
import type {
  Challenge,
  Competition,
  Elimination,
  GameEvent,
  Season,
  Trade,
} from "../types";
import { filterEpisodesByMax, filterRecordByEpisode } from "./episodeFilter";
import { getPropBetScoresByUser } from "./propBetUtils";
import { getSeasonPointsByCastaway } from "./seasonPoints";
import { getOwnedCastawaysAtEpisode } from "./tradeUtils";

/**
 * The personal record behind the My Stats page.
 *
 * Pure on purpose: no React, no Firebase. Every number is derived from data the
 * signed-in participant can already read, through the same scoring path the
 * competition page uses, so this page can never disagree with the scoreboard it
 * links to. Nothing here is stored.
 *
 * Spoilers: `computeCompetitionOutcome` applies each competition's own episode
 * boundary itself, before any scoring, so callers cannot hand it a way to see
 * past that boundary. Record stats read only `finished`, never the winner
 * event, because `finished` already means "the season's winner is recorded and
 * this group has revealed the finale".
 */

/** Season results as read from Firestore, before any episode filtering. */
export type SeasonResults = {
  season: Season;
  challenges: Record<Challenge["id"], Challenge>;
  eliminations: Record<Elimination["id"], Elimination>;
  events: Record<GameEvent["id"], GameEvent>;
};

export type UnavailableReason =
  /** The season document or one of its result documents could not be read. */
  | "season_results"
  /** The competition's trades could not be read, so ownership is unknown. */
  | "trades"
  /** The signed-in user is not on the participant list. */
  | "not_a_participant";

export type PropBetTally = {
  /** Answered bets that a concrete result has settled as right. */
  correct: number;
  /** Answered bets that a concrete result has settled, right or wrong. */
  resolved: number;
};

export type UnavailableOutcome = {
  kind: "unavailable";
  competition: Competition;
  reason: UnavailableReason;
};

export type ScoredOutcome = {
  kind: "scored";
  competition: Competition;
  /** Competition ranking: ties share a rank and the next rank skips. */
  rank: number;
  fieldSize: number;
  total: number;
  /** False while nothing has been revealed to this competition yet. */
  started: boolean;
  propBets: PropBetTally;
};

export type CompetitionOutcome = UnavailableOutcome | ScoredOutcome;

export const PODIUM_MIN_FIELD = 4;
export const SMALL_SAMPLE_FINISHED = 3;
export const PROP_BET_MIN_RESOLVED = 5;

/** Rank convention shared with ParticipantScoreboard and the pool standings. */
export const rankOfTotal = (totals: number[], total: number): number =>
  1 + totals.filter((t) => t > total).length;

export const computeCompetitionOutcome = (
  competition: Competition,
  results: SeasonResults | null,
  trades: Trade[] | null,
  uid: string,
): CompetitionOutcome => {
  if (!competition.participants.some((p) => p.uid === uid)) {
    return { kind: "unavailable", competition, reason: "not_a_participant" };
  }
  if (!results) {
    return { kind: "unavailable", competition, reason: "season_results" };
  }
  if (!trades) {
    return { kind: "unavailable", competition, reason: "trades" };
  }

  const maxEpisode = competition.current_episode ?? null;
  const episodes = filterEpisodesByMax(
    results.season.episodes ?? [],
    maxEpisode,
  );
  const challenges = filterRecordByEpisode(results.challenges, maxEpisode);
  const eliminations = filterRecordByEpisode(results.eliminations, maxEpisode);
  const events = filterRecordByEpisode(results.events, maxEpisode);

  const pointsByCastaway = getSeasonPointsByCastaway(
    Object.values(challenges),
    Object.values(eliminations),
    Object.values(events),
    episodes,
    (results.season.players ?? []).map((p) => p.castaway_id),
  );

  const hasFinaleOccurred = Object.values(events).some(
    (e) => e.action === "win_survivor",
  );
  const postMerge = new Set(
    (results.season.episodes ?? [])
      .filter((e) => e.post_merge)
      .map((e) => e.order),
  );
  const propBetScores = getPropBetScoresByUser(
    events,
    eliminations,
    challenges,
    postMerge,
    hasFinaleOccurred,
    competition,
  );

  const totalFor = (participantUid: string) =>
    sum(
      episodes.map((episode) =>
        sum(
          // Ownership is resolved per episode so a trade only moves the
          // points from its effective episode onward.
          getOwnedCastawaysAtEpisode(
            competition.draft_picks,
            trades,
            participantUid,
            episode.order,
          ).map((id) => pointsByCastaway[id]?.[episode.order - 1]?.total || 0),
        ),
      ),
    ) + (propBetScores[participantUid]?.total || 0);

  const totals = competition.participants.map((p) => totalFor(p.uid));
  const myTotal = totalFor(uid);

  return {
    kind: "scored",
    competition,
    rank: rankOfTotal(totals, myTotal),
    fieldSize: competition.participants.length,
    total: myTotal,
    started: maxEpisode !== 0 && episodes.length > 0,
    propBets: tallyPropBets(competition, propBetScores[uid]),
  };
};

/**
 * Counts only bets the participant actually answered and a concrete result has
 * settled. "leading" and "pending" are unresolved and count for neither side,
 * and retired questions (no longer active) score nothing so they are skipped.
 */
const tallyPropBets = (
  competition: Competition,
  scores: ReturnType<typeof getPropBetScoresByUser>[string] | undefined,
): PropBetTally => {
  const tally: PropBetTally = { correct: 0, resolved: 0 };
  if (!scores) return tally;
  for (const key of getActivePropBetKeys(competition.prop_bets)) {
    const answer = scores[key];
    if (!answer?.answer) continue;
    if (answer.status === "definitive_correct") {
      tally.correct += 1;
      tally.resolved += 1;
    } else if (answer.status === "definitive_incorrect") {
      tally.resolved += 1;
    }
  }
  return tally;
};

export type FinishRecord = {
  rank: number;
  fieldSize: number;
  competition: Competition;
};

export type MyStats = {
  entered: number;
  active: number;
  finished: number;
  /** Competitions whose data could not be read; in no numerator or denominator. */
  unavailable: number;
  /** Finished competitions that could be scored: the record's denominator. */
  completed: number;
  wins: number;
  winRate: number | null;
  podiums: { count: number; eligible: number };
  bestFinish: FinishRecord | null;
  averageFinish: { rank: number; fieldSize: number } | null;
  highestTotal: { total: number; competition: Competition } | null;
  propBets: PropBetTally & { sufficient: boolean };
  /** True when the record rests on fewer than three completed competitions. */
  smallSample: boolean;
};

const byBestFinish = (a: FinishRecord, b: FinishRecord) =>
  a.rank - b.rank ||
  b.fieldSize - a.fieldSize ||
  a.competition.competition_name.localeCompare(b.competition.competition_name);

export const computeMyStats = (outcomes: CompetitionOutcome[]): MyStats => {
  const finishedAll = outcomes.filter((o) => o.competition.finished);
  const completed = finishedAll.filter(
    (o): o is ScoredOutcome => o.kind === "scored",
  );
  const eligiblePodium = completed.filter(
    (o) => o.fieldSize >= PODIUM_MIN_FIELD,
  );
  const finishes: FinishRecord[] = completed.map((o) => ({
    rank: o.rank,
    fieldSize: o.fieldSize,
    competition: o.competition,
  }));
  const wins = completed.filter((o) => o.rank === 1).length;
  const propBets = completed.reduce<PropBetTally>(
    (acc, o) => ({
      correct: acc.correct + o.propBets.correct,
      resolved: acc.resolved + o.propBets.resolved,
    }),
    { correct: 0, resolved: 0 },
  );
  const highest = completed
    .slice()
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.fieldSize - a.fieldSize ||
        a.competition.competition_name.localeCompare(
          b.competition.competition_name,
        ),
    )[0];

  return {
    entered: outcomes.length,
    active: outcomes.length - finishedAll.length,
    finished: finishedAll.length,
    unavailable: outcomes.filter((o) => o.kind === "unavailable").length,
    completed: completed.length,
    wins,
    winRate: completed.length ? wins / completed.length : null,
    podiums: {
      count: eligiblePodium.filter((o) => o.rank <= 3).length,
      eligible: eligiblePodium.length,
    },
    bestFinish: finishes.slice().sort(byBestFinish)[0] ?? null,
    averageFinish: finishes.length
      ? {
          rank: sum(finishes.map((f) => f.rank)) / finishes.length,
          fieldSize: sum(finishes.map((f) => f.fieldSize)) / finishes.length,
        }
      : null,
    highestTotal: highest
      ? { total: highest.total, competition: highest.competition }
      : null,
    propBets: {
      ...propBets,
      sufficient: propBets.resolved >= PROP_BET_MIN_RESOLVED,
    },
    smallSample:
      completed.length > 0 && completed.length < SMALL_SAMPLE_FINISHED,
  };
};

/** Newest season first, then name, so the table order is stable. */
export const sortOutcomes = (outcomes: CompetitionOutcome[]) =>
  outcomes
    .slice()
    .sort(
      (a, b) =>
        b.competition.season_num - a.competition.season_num ||
        a.competition.competition_name.localeCompare(
          b.competition.competition_name,
        ),
    );
