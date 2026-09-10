import type { CastawayId } from "../types";
import type { SeasonPointsByCastaway } from "./seasonPoints";

/**
 * A pool entry, reduced to exactly what ranking needs. Deliberately not a
 * `Competition` participant: the pool has no draft, no trades, and picks are
 * non-exclusive, so ownership helpers do not apply (KTD10).
 */
export type PoolEntryForRanking = {
  uid: string;
  /** The public handle. Never an email: ranking passes it through untouched. */
  handle: string;
  picks: { castaway_id: CastawayId; full_name: string }[];
};

/**
 * One row of the public leaderboard. Carries handle, total points and rank
 * (R17); no castaway names, no elimination state, no per-castaway breakdown.
 */
export type PoolStandingRow = {
  uid: string;
  handle: string;
  rank: number;
  /** Sum of the entrant's picks across every scored episode. */
  total_points: number;
  /** Tiebreak only. Never folded into `total_points` (R13). */
  prop_bet_points: number;
};

const sumPicks = (
  entry: PoolEntryForRanking,
  pointsByCastaway: SeasonPointsByCastaway,
): number =>
  entry.picks.reduce((total, pick) => {
    const perEpisode = pointsByCastaway[pick.castaway_id];
    if (!perEpisode) return total;

    return perEpisode.reduce(
      (pickTotal, episode) => pickTotal + (episode.total || 0),
      total,
    );
  }, 0);

/**
 * The single ranking implementation, shared by the recompute job (Node) and
 * the client, so both agree by construction rather than by assertion (KTD11).
 *
 * Ordering: total points descending, then prop bet points descending as the
 * tiebreak (R13), then uid ascending. The uid tiebreak makes the order total,
 * so two runs over the same inputs emit the same rows in the same order
 * whatever order the entries arrived in (R14). Comparison is by code unit,
 * not locale, so Node and the browser cannot disagree.
 *
 * Ranks are shared: entrants level on both points and prop bets get the same
 * rank, and the next distinct entrant's rank skips accordingly.
 *
 * Prop bet points are passed in, already computed. This function never scores
 * anything itself.
 *
 * Pure: no React, no Firebase, no browser globals, and no ownership or
 * trade helpers.
 */
export const rankPoolEntries = (
  entries: PoolEntryForRanking[],
  pointsByCastaway: SeasonPointsByCastaway,
  propBetPointsByUid: Record<string, number>,
): PoolStandingRow[] => {
  const scored = entries.map((entry) => ({
    uid: entry.uid,
    handle: entry.handle,
    total_points: sumPicks(entry, pointsByCastaway),
    prop_bet_points: propBetPointsByUid[entry.uid] || 0,
  }));

  scored.sort((a, b) => {
    if (a.total_points !== b.total_points) {
      return b.total_points - a.total_points;
    }
    if (a.prop_bet_points !== b.prop_bet_points) {
      return b.prop_bet_points - a.prop_bet_points;
    }
    if (a.uid === b.uid) return 0;
    return a.uid < b.uid ? -1 : 1;
  });

  let rank = 0;
  return scored.map((row, index) => {
    const previous = scored[index - 1];
    const tiedWithPrevious =
      previous !== undefined &&
      previous.total_points === row.total_points &&
      previous.prop_bet_points === row.prop_bet_points;

    if (!tiedWithPrevious) {
      rank = index + 1;
    }

    return { ...row, rank };
  });
};
