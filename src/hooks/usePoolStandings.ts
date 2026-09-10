import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SCORING_REVISION } from "../data/scoringRevision.generated";
import { db } from "../firebase";
import type { Pool, PoolStandings, PoolStandingsPage } from "../types";
import {
  readPoolStandingsCache,
  writePoolStandingsCache,
} from "../utils/poolStandingsCache";
import {
  planPoolStandingsFetch,
  planPoolStandingsPagesFetch,
  resolvePoolStandingsView,
  type PoolStandingsView,
} from "../utils/poolStandingsRead";

/**
 * The public leaderboard read path (U8).
 *
 * Four disciplines, each of which is a decision rather than a style choice:
 *
 * 1. ONE-TIME FETCHES, NEVER LISTENERS. `getDoc`, not `onSnapshot`. A
 *    listener over a world-readable collection is billed again on every
 *    reconnect, and this is the read path for the highest-traffic public page
 *    in the product. Standings change a handful of times a season; there is
 *    nothing here worth a live subscription.
 *
 * 2. NO SECOND CONFIG READER. The pool configuration arrives as a value from
 *    `usePool`, which U4 already built. This hook opens no subscription of its
 *    own to `pools/{poolId}`. (`usePool` is a document listener rather than a
 *    one-time fetch; it is shared and ref-counted through `useSharedSnapshot`,
 *    and duplicating it here to get a one-time read would mean two readers of
 *    the same document on the same page. Left as it is deliberately.)
 *
 * 3. NO SEASON READ, ANYWHERE ON THIS PATH. Staleness is a pair of revisions
 *    (KTD5) and only one of them is free. `dataRevision` is an input a caller
 *    supplies when it already holds one; there is no fetch here that could
 *    produce it. That is what makes R22 structural rather than a rule someone
 *    has to remember on the homepage. See the header of
 *    `src/utils/poolStandingsRead.ts` for the decision in full.
 *
 * 4. NO RECOMPUTE, EVER (KTD8). Ranking needs every entrant's picks and the
 *    rules keep entry documents readable only by their owner, so the browser
 *    cannot assemble a leaderboard whatever it does. A stale document renders
 *    with its stamp; an absent one renders the empty state and never a field
 *    of zeroes.
 *
 * Everything the hook decides lives in the pure functions it calls, which is
 * where the tests are: this project has no React Testing Library.
 */

export type UsePoolStandingsInput = {
  /** The config document, from `usePool`. */
  pool: Pool | undefined;
  /** `usePool().isLoaded`. False while the config read is in flight. */
  isPoolLoaded: boolean;
  /**
   * The season-data revision, for the stale check.
   *
   * PASS THIS ONLY FROM A SURFACE THAT ALREADY READS THE SEASON DOCUMENT.
   * The homepage module must omit it (R22): the module is forbidden from
   * reading a season document, and the plan's headline Playwright assertion
   * checks exactly that on real request URLs. Omitting it means the scoring
   * revision alone decides staleness there, which is free and sufficient.
   */
  dataRevision?: string | null;
};

export type UsePoolStandingsResult = {
  /** Hidden, pending, empty, or ready. The component renders this and nothing else. */
  view: PoolStandingsView;
  /** Fetch the overflow pages and show the full field. */
  expand: () => void;
  /** True once `expand` has been called. */
  isExpanded: boolean;
  /** True while the overflow pages are in flight. */
  isExpanding: boolean;
  /** True when there is a full field to ask for and it is not on screen yet. */
  canExpand: boolean;
};

export const usePoolStandings = ({
  pool,
  isPoolLoaded,
  dataRevision,
}: UsePoolStandingsInput): UsePoolStandingsResult => {
  const poolId = pool?.id;
  const displayMode = pool?.display_mode;
  const latestEpisodeNum = pool?.latest_episode_num ?? null;

  const [summary, setSummary] = useState<PoolStandings | undefined>(undefined);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [pages, setPages] = useState<PoolStandingsPage[] | undefined>(
    undefined,
  );
  const [isExpanded, setIsExpanded] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);

  // The summary document, by direct path at the pointer's episode.
  useEffect(() => {
    setIsExpanded(false);
    setPages(undefined);

    const plan = planPoolStandingsFetch({
      poolId,
      displayMode,
      latestEpisodeNum,
      cacheHit: false,
    });

    if (plan.reason !== "fetch" || !poolId || latestEpisodeNum === null) {
      // Hidden, no pool, or nothing scored yet. No read is issued at all,
      // which is what makes `display_mode` a rollback lever rather than an
      // inert field.
      setSummary(undefined);
      setSummaryLoaded(true);
      return;
    }

    const cached = readPoolStandingsCache(poolId, latestEpisodeNum);
    if (cached) {
      // A returning visitor on the current episode issues no read.
      setSummary(cached);
      setSummaryLoaded(true);
      return;
    }

    let cancelled = false;
    setSummary(undefined);
    setSummaryLoaded(false);

    getDoc(doc(db, plan.paths[0]))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as PoolStandings) : undefined;
        setSummary(data);
        setSummaryLoaded(true);
        if (data) writePoolStandingsCache(poolId, latestEpisodeNum, data);
      })
      .catch((error) => {
        // An absent or unreadable document is the empty state, never zeroes.
        console.error(`usePoolStandings(${plan.paths[0]}): read failed`, error);
        if (cancelled) return;
        setSummary(undefined);
        setSummaryLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [poolId, displayMode, latestEpisodeNum]);

  const pageCount = summary?.page_count ?? 0;

  // Overflow pages, only once a visitor asks. Egress rather than read count is
  // the binding constraint, so the full field is never fetched by default.
  useEffect(() => {
    if (!isExpanded) return;

    const plan = planPoolStandingsPagesFetch({
      poolId,
      displayMode,
      latestEpisodeNum,
      pageCount,
      expanded: true,
    });
    if (plan.paths.length === 0) {
      setPages([]);
      return;
    }

    let cancelled = false;
    setIsExpanding(true);

    Promise.all(plan.paths.map((path) => getDoc(doc(db, path))))
      .then((snaps) => {
        if (cancelled) return;
        setPages(
          snaps
            .filter((snap) => snap.exists())
            .map((snap) => snap.data() as PoolStandingsPage),
        );
        setIsExpanding(false);
      })
      .catch((error) => {
        console.error("usePoolStandings: overflow page read failed", error);
        if (cancelled) return;
        // The summary rows stay on screen; only the full field is missing.
        setIsExpanding(false);
        setIsExpanded(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isExpanded, poolId, displayMode, latestEpisodeNum, pageCount]);

  const view = useMemo(
    () =>
      resolvePoolStandingsView({
        pool,
        poolLoaded: isPoolLoaded,
        summary,
        summaryLoaded,
        pages,
        scoringRevision: SCORING_REVISION,
        dataRevision,
      }),
    [pool, isPoolLoaded, summary, summaryLoaded, pages, dataRevision],
  );

  const expand = useCallback(() => setIsExpanded(true), []);

  return {
    view,
    expand,
    isExpanded,
    isExpanding,
    canExpand: view.kind === "ready" && view.pageCount > 0 && !isExpanded,
  };
};
