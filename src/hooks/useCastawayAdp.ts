import { useMemo } from "react";
import type { Season } from "../types";
import {
  CASTAWAY_ADP_COLLECTION,
  castawayAdpState,
  type CastawayAdpState,
  parseCastawayAdpSummary,
} from "../utils/castawayAdp";
import { useSharedSnapshot } from "./useSharedSnapshot";

/**
 * The published average-draft-position summary for a season. A missing,
 * unreadable, or malformed document reads as "unavailable", never as zeros.
 */
export const useCastawayAdp = (
  seasonId: Season["id"] | undefined,
): CastawayAdpState => {
  const { data, loaded } = useSharedSnapshot(CASTAWAY_ADP_COLLECTION, seasonId);
  return useMemo(
    () => castawayAdpState(loaded, parseCastawayAdpSummary(data)),
    [data, loaded],
  );
};
