import { useParams } from "react-router-dom";
import type { Pool, PoolCounters } from "../types";
import { poolIdForSeason, seasonNumFromSeasonId } from "../utils/poolIds";
import { useSharedSnapshot } from "./useSharedSnapshot";

/**
 * The pool configuration document for a season.
 *
 * `pools/{poolId}` is world-readable (KTD6), so this opens for a signed-out
 * visitor too: R18 requires one to see the pool and reach the entry page.
 *
 * A DOCUMENT listener, never a collection query. Everything under `/pools`
 * that a client may read is addressed by path; the entries collection in
 * particular denies `list` outright, so a query there fails rather than
 * returning fewer rows.
 */
export const usePool = (seasonId?: string) => {
  const params = useParams();
  const resolvedSeasonId = seasonId ?? params.seasonId;
  const seasonNum = seasonNumFromSeasonId(resolvedSeasonId);
  const poolId = seasonNum === null ? undefined : poolIdForSeason(seasonNum);

  const { data, loaded } = useSharedSnapshot("pools", poolId);

  return {
    poolId,
    seasonNum,
    data: data as Pool | undefined,
    /** True until the config read resolves. False when there is no season id. */
    isLoading: !!poolId && !loaded,
    isLoaded: !poolId || loaded,
  };
};

/**
 * `pools/{poolId}/meta/counters` -- the entrant count.
 *
 * Updated atomically when an entry is created or withdrawn, and readable
 * signed-out. Rules tie each increment/decrement to that owner's entry.
 * Kept separate from the configuration and its freeze instant (KTD3).
 */
export const usePoolCounters = (poolId?: string) => {
  const { data, loaded } = useSharedSnapshot(
    poolId ? `pools/${poolId}/meta` : "pools",
    poolId ? "counters" : undefined,
  );
  return {
    data: data as PoolCounters | undefined,
    isLoading: !!poolId && !loaded,
  };
};
