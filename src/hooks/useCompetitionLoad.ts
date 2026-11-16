import { useEffect, useRef, useState } from "react";
import {
  COMPETITION_SLOW_LOAD_MS,
  newCompetitionLoadVisit,
  stepCompetitionLoadVisit,
  type CompetitionLoadState,
  type CompetitionLoadVisit,
} from "../pages/competitionLoad";
import { trackEvent } from "../utils/analytics";

/**
 * Whether the competition page has been loading for longer than
 * COMPETITION_SLOW_LOAD_MS, plus timing telemetry: one `competition_load`
 * event per visit when loading ends, and one `competition_load_slow` event
 * if it crosses the threshold first. Signing in from the gate starts a new
 * visit. The competition id only scopes a visit; it is never sent.
 */
export const useCompetitionLoad = (
  competitionId: string | undefined,
  state: CompetitionLoadState,
) => {
  const isLoading = state.kind === "loading";
  const [isSlow, setIsSlow] = useState(false);
  const visit = useRef<CompetitionLoadVisit | null>(null);

  useEffect(() => {
    visit.current = newCompetitionLoadVisit(performance.now());
  }, [competitionId]);

  useEffect(() => {
    if (!isLoading) return;
    const timer = window.setTimeout(
      () => setIsSlow(true),
      COMPETITION_SLOW_LOAD_MS,
    );
    return () => {
      window.clearTimeout(timer);
      setIsSlow(false);
    };
  }, [isLoading, competitionId]);

  useEffect(() => {
    if (!visit.current) return;
    const step = stepCompetitionLoadVisit(
      visit.current,
      state,
      isSlow,
      performance.now(),
      window.location.origin,
    );
    visit.current = step.visit;
    for (const [name, params] of step.events) trackEvent(name, params);
  }, [state, isSlow]);

  return { isSlow: isLoading && isSlow };
};
