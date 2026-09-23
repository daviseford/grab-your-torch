import { useMemo } from "react";
import type { Season } from "../types";
import {
  type AdpCohort,
  CASTAWAY_ADP_COLLECTION,
  castawayAdpDocId,
  castawayAdpState,
  type CastawayAdpState,
  parseCastawayAdpSummary,
} from "../utils/castawayAdp";
import { useSharedSnapshot } from "./useSharedSnapshot";

/**
 * One cohort's published average-draft-position summary for a season. A
 * missing, unreadable, or malformed document reads as "unavailable", never
 * as zeros. Pass a null cohort to subscribe to nothing: the all-drafts
 * summary is not even fetched until the viewer opts in.
 */
export const useCastawayAdp = (
  seasonId: Season["id"] | undefined,
  cohort: AdpCohort | null,
): CastawayAdpState => {
  const docId =
    seasonId && cohort ? castawayAdpDocId(seasonId, cohort) : undefined;
  const { data, loaded } = useSharedSnapshot(CASTAWAY_ADP_COLLECTION, docId);
  return useMemo(
    () =>
      cohort
        ? castawayAdpState(loaded, parseCastawayAdpSummary(data, cohort))
        : { kind: "loading" },
    [cohort, data, loaded],
  );
};
