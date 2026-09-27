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
 * One row of the public leaderboard. Carries handle, rank and three point
 * figures; no castaway names, no elimination state, no per-castaway breakdown,
 * and nothing about which prop bets paid out.
 */
export type PoolStandingRow = {
  uid: string;
  handle: string;
  rank: number;
  /** `castaway_points + prop_bet_points`. What the leaderboard ranks on. */
  total_points: number;
  /** Sum of the entrant's picks across every scored episode. */
  castaway_points: number;
  /**
   * Points from prop bets that have definitively settled in the entrant's
   * favour. Already counted in `total_points`; never add it again.
   */
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
 * Total: castaway points plus awarded prop bet points. Prop bet points arrive
 * already computed and count only definitively correct bets, so a pending bet
 * adds nothing. This function never scores anything itself.
 *
 * Ordering: total descending, then prop bet points descending, then uid
 * ascending. The last two only order rows inside a tie; they never change a
 * rank. The uid makes the order total, so two runs over the same inputs emit
 * the same rows in the same order whatever order the entries arrived in
 * (R14). Comparison is by code unit, not locale, so Node and the browser
 * cannot disagree.
 *
 * Ranks are dense and follow the total: entrants on the same total share a
 * rank, and the next total takes the next number (1, 2, 2, 3). The leaderboard
 * shows that tie as "T-2" on every row (`groupPoolStandingsRows`).
 *
 * Pure: no React, no Firebase, no browser globals, and no ownership or
 * trade helpers.
 */
export const rankPoolEntries = (
  entries: PoolEntryForRanking[],
  pointsByCastaway: SeasonPointsByCastaway,
  propBetPointsByUid: Record<string, number>,
): PoolStandingRow[] => {
  const scored = entries.map((entry) => {
    const castawayPoints = sumPicks(entry, pointsByCastaway);
    const propBetPoints = propBetPointsByUid[entry.uid] || 0;
    return {
      uid: entry.uid,
      handle: entry.handle,
      total_points: castawayPoints + propBetPoints,
      castaway_points: castawayPoints,
      prop_bet_points: propBetPoints,
    };
  });

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
    if (previous === undefined || previous.total_points !== row.total_points) {
      rank += 1;
    }
    return { ...row, rank };
  });
};
