import { useMemo } from "react";
import type { PoolEntry, Season } from "../types";
import {
  projectPoolEntryScores,
  resolvePoolEntryBreakdownAccess,
  type PoolEntryScores,
} from "../utils/poolEntryScoring";
import { useChallenges } from "./useChallenges";
import { useEliminations } from "./useEliminations";
import { useEvents } from "./useEvents";
import { useSeason } from "./useSeason";
import { useUser } from "./useUser";

/**
 * The entrant's own scoring breakdown (U16).
 *
 * WHAT THIS READS, AND WHY THAT NEEDS NO RULES CHANGE
 * --------------------------------------------------
 * The season document and the `challenges`, `eliminations` and `events`
 * collections, all four of which any signed-in user can already read. An
 * entrant is signed in by definition (an entry cannot exist otherwise), so
 * this feature relaxes nothing. The four hooks below are the same shared,
 * ref-counted `onSnapshot` subscriptions every competition surface uses, each
 * with an error callback, so a second reader on the page costs no extra
 * listener.
 *
 * WHAT IT DOES NOT READ
 * ---------------------
 * The published standings. Those hold totals only (KTD5) and have no
 * per-episode granularity to show, so this is derived live. It is also not
 * bounded by a competition's `current_episode`: a pool entrant watches the
 * season live, so there is no spoiler boundary here (KD7). See the header of
 * `src/utils/poolEntryScoring.ts`.
 *
 * OWNER ONLY
 * ----------
 * The hook returns `{ access: "nothing" }` for anyone who is not the entry's
 * owner and derives nothing at all in that case. `usePoolEntry` can only hand
 * a caller the signed-in entrant's own document, so this is the second lock,
 * not the only one; R25 is the reason it exists as a lock rather than as an
 * assumption.
 *
 * Every decision is in the pure functions it calls, which is where the tests
 * are: this project has no React Testing Library.
 */

export type UsePoolEntryScoresResult = {
  /** "breakdown" only for the entry's owner. */
  access: "breakdown" | "nothing";
  /** True while the result collections are still arriving. */
  isLoading: boolean;
  /** Absent unless `access` is "breakdown". */
  scores: PoolEntryScores | undefined;
};

export const usePoolEntryScores = (
  entry: PoolEntry | undefined,
  seasonId: Season["id"] | undefined,
): UsePoolEntryScoresResult => {
  const { user } = useUser();
  const access = resolvePoolEntryBreakdownAccess({
    entryId: entry?.id,
    viewerUid: user?.uid,
  });

  // Subscribing only for the owner keeps a non-owner from opening four
  // listeners for a breakdown they will never be shown.
  const readableSeasonId = access === "breakdown" ? seasonId : undefined;

  const { data: season, isLoading: seasonLoading } =
    useSeason(readableSeasonId);
  const { data: challenges } = useChallenges(readableSeasonId);
  const { data: eliminations } = useEliminations(readableSeasonId);
  const { data: events } = useEvents(readableSeasonId);

  const scores = useMemo(() => {
    if (access !== "breakdown" || !entry) return undefined;
    return projectPoolEntryScores({
      picks: entry.picks,
      // Season 51 has no season document in Firestore at all, so this is the
      // empty list today and the projection answers "awaiting-data" rather
      // than rendering a table of zeros (KTD8).
      episodes: season?.episodes ?? [],
      challenges: Object.values(challenges),
      eliminations: Object.values(eliminations),
      events: Object.values(events),
    });
  }, [access, entry, season, challenges, eliminations, events]);

  return {
    access,
    // The season read is the only thing waited on. The result hooks report
    // readiness as "the document exists and has arrived", which never becomes
    // true for a collection that has not been written yet, so waiting on them
    // would latch a spinner on forever for exactly the season this feature
    // ships for. An absent collection is the awaiting-data state, not a
    // pending one (KTD8).
    isLoading: access === "breakdown" && seasonLoading,
    scores,
  };
};
