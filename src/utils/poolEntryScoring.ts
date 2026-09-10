import type {
  CastawayId,
  Challenge,
  Elimination,
  Episode,
  GameEvent,
  PoolEntryId,
  PoolPick,
} from "../types";
import { getSeasonPointsByCastaway } from "./seasonPoints";

/**
 * The entrant's own scoring breakdown, derived (U16).
 *
 * Every decision this feature makes lives here, as a pure function, because
 * this project has no React Testing Library and no `.test.tsx`: the component
 * and the hook are wiring, and the tests are in
 * `src/hooks/__tests__/usePoolEntryScores.test.ts`.
 *
 * THREE THINGS ARE DELIBERATE AND EASY TO "CORRECT" INTO BUGS
 * ----------------------------------------------------------
 *
 * 1. NO SPOILER BOUNDARY (KD7). Every competition surface in this codebase
 *    filters against the competition's `current_episode`, because a
 *    competition is watched along at its own pace. A pool entrant is watching
 *    the season live by definition, so there is no per-viewer episode boundary
 *    to apply and this derivation deliberately runs to the newest episode with
 *    result data. That is the opposite of the repo's usual discipline; it is
 *    correct here and nowhere else.
 *
 * 2. DERIVED LIVE, NOT READ FROM THE STANDINGS CACHE (KTD5). The published
 *    standings hold totals only, so there is no per-episode granularity there
 *    to render. The result collections a signed-in entrant can already read
 *    are the source, and no security rule is relaxed to make this work.
 *
 * 3. THE SUM IS THE SAME SUM THE JOB PUBLISHES. Nothing here rescales,
 *    truncates or re-weights a castaway's points, which is what lets an
 *    entrant's own total equal the leaderboard total for the same episode.
 *    In particular an eliminated castaway is NOT zeroed out retroactively:
 *    they simply stop appearing in later records, which is the same reason
 *    the job stops counting them.
 *
 * Pool code, so no ownership or draft helpers and no competition scoring
 * tables (KTD10, U10): a castaway here can sit on any number of entries.
 */

/* ------------------------------------------------------------------ *
 * Owner scoping (R26)
 * ------------------------------------------------------------------ */

/** What a given viewer may see of a given entry's breakdown. */
export type PoolEntryBreakdownAccess = "breakdown" | "nothing";

/**
 * The breakdown is the entrant's own picks and belongs to nobody else.
 *
 * R17 bounds what may appear on a PUBLIC pool surface to handles, totals and
 * ranks; R26 puts this outside that bound precisely because it is private.
 * R25 then warns that anything later added to a public surface inherits R17,
 * so this decision is a function rather than a comment: an entry id that is
 * not this viewer's own yields "nothing", with no partial middle state to
 * misread.
 *
 * In practice `usePoolEntry` can only ever hand the page the signed-in
 * entrant's own document (it subscribes to `entries/{uid}` by path, and rules
 * deny every other read), so this is the second of two locks rather than the
 * only one.
 */
export const resolvePoolEntryBreakdownAccess = ({
  entryId,
  viewerUid,
}: {
  entryId: PoolEntryId | undefined;
  viewerUid: string | undefined;
}): PoolEntryBreakdownAccess =>
  entryId !== undefined &&
  viewerUid !== undefined &&
  viewerUid.length > 0 &&
  entryId === `pool_entry_${viewerUid}`
    ? "breakdown"
    : "nothing";

/* ------------------------------------------------------------------ *
 * Which episodes are scored
 * ------------------------------------------------------------------ */

/** The result data a breakdown is derived from. */
export type PoolEntryScoringData = {
  episodes: readonly Episode[];
  challenges: readonly Challenge[];
  eliminations: readonly Elimination[];
  events: readonly GameEvent[];
};

/**
 * The newest episode that has both a season-document entry and result data,
 * or null when nothing has been scored yet.
 *
 * Numeric throughout: `episode_10` sorts before `episode_2`, so nothing here
 * derives "the newest" from a sorted id. A record numbered beyond the season
 * document's episode list cannot conjure an episode column either, which
 * matters while a season is being backfilled.
 *
 * This mirrors `latestEpisodeWithData` in `scripts/recompute-pool-standings.ts`
 * on purpose and is not shared with it: that module runs under Node with the
 * Admin SDK in its import graph and must never enter the browser bundle. The
 * two are held together by the agreement test, which runs both.
 */
export const latestScoredPoolEpisode = (
  data: PoolEntryScoringData,
): number | null => {
  const recorded = [...data.challenges, ...data.eliminations, ...data.events]
    .map((record) => record.episode_num)
    .filter((num) => typeof num === "number" && Number.isFinite(num));

  if (recorded.length === 0) return null;

  const highestWithData = Math.max(...recorded);
  const known = data.episodes
    .map((episode) => episode.order)
    .filter((order) => Number.isFinite(order) && order <= highestWithData);

  return known.length === 0 ? null : Math.max(...known);
};

/* ------------------------------------------------------------------ *
 * The projection
 * ------------------------------------------------------------------ */

/** One of the entrant's picks, week by week. */
export type PoolEntryPickScores = {
  castaway_id: CastawayId;
  full_name: string;
  /**
   * Points per scored episode. Dense and index aligned to `episodes`, so a
   * week in which this castaway did nothing is a 0 rather than a gap.
   */
  per_episode: number[];
  total: number;
  /**
   * The episode this castaway left the game, or null while they are still in.
   * Presentation only: it explains the run of zeros that follows it and is
   * never subtracted from anything.
   */
  out_episode_num: number | null;
};

export type PoolEntryScores =
  /**
   * Nothing has been scored yet. This is the NORMAL state of a pool between
   * provisioning and the premiere, and season 51 is in it today: its season
   * document is not in Firestore, its episode list is empty and every result
   * collection is empty. It renders as scoring not having started, never as a
   * table of zeros, which is the same distinction KTD8 draws for the public
   * leaderboard: stale is not missing, and missing is not zero.
   */
  | { kind: "awaiting-data" }
  | {
      kind: "ready";
      /** The scored episodes, in order. Every `per_episode` aligns to this. */
      episodes: Episode[];
      picks: PoolEntryPickScores[];
      /** The entry's total across every pick and every scored episode. */
      total: number;
      latest_episode_num: number;
    };

export type ProjectPoolEntryScoresInput = PoolEntryScoringData & {
  picks: readonly PoolPick[];
};

/**
 * Build the entrant's own breakdown from the season result data.
 *
 * A `switched` elimination is a tribe swap rather than an exit, which is why
 * it is excluded here exactly as it is excluded from scoring.
 */
export const projectPoolEntryScores = ({
  picks,
  episodes,
  challenges,
  eliminations,
  events,
}: ProjectPoolEntryScoresInput): PoolEntryScores => {
  const latest = latestScoredPoolEpisode({
    episodes,
    challenges,
    eliminations,
    events,
  });

  if (latest === null || picks.length === 0) return { kind: "awaiting-data" };

  const scoredEpisodes = episodes
    .filter((episode) => episode.order <= latest)
    .slice()
    .sort((a, b) => a.order - b.order);

  if (scoredEpisodes.length === 0) return { kind: "awaiting-data" };

  const inScope = <T extends { episode_num: number }>(
    records: readonly T[],
  ): T[] => records.filter((record) => record.episode_num <= latest);

  const scopedEliminations = inScope(eliminations);

  const pointsByCastaway = getSeasonPointsByCastaway(
    inScope(challenges),
    scopedEliminations,
    inScope(events),
    scoredEpisodes,
    picks.map((pick) => pick.castaway_id),
  );

  const outEpisode = (castawayId: CastawayId): number | null => {
    const exits = scopedEliminations
      .filter(
        (record) =>
          record.castaway_id === castawayId && record.variant !== "switched",
      )
      .map((record) => record.episode_num);
    return exits.length === 0 ? null : Math.min(...exits);
  };

  const scored: PoolEntryPickScores[] = picks.map((pick) => {
    const perEpisode = pointsByCastaway[pick.castaway_id] ?? [];
    // `|| 0` rather than `?? 0`: a scorer that ever produced NaN would
    // otherwise poison the entry total and every column after it.
    const per_episode = scoredEpisodes.map(
      (_, index) => perEpisode[index]?.total || 0,
    );

    return {
      castaway_id: pick.castaway_id,
      full_name: pick.full_name,
      per_episode,
      total: per_episode.reduce((sum, points) => sum + points, 0),
      out_episode_num: outEpisode(pick.castaway_id),
    };
  });

  return {
    kind: "ready",
    episodes: scoredEpisodes,
    picks: scored,
    total: scored.reduce((sum, pick) => sum + pick.total, 0),
    latest_episode_num: latest,
  };
};

/** Points the entry earned in one scored episode, across every pick. */
export const poolEntryEpisodeTotals = (scores: PoolEntryScores): number[] =>
  scores.kind !== "ready"
    ? []
    : scores.episodes.map((_, index) =>
        scores.picks.reduce(
          (sum, pick) => sum + (pick.per_episode[index] || 0),
          0,
        ),
      );
