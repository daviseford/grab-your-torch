import { useEffect, useRef, useState } from "react";
import {
  COMPETITION_SLOW_LOAD_MS,
  competitionLoadEventParams,
  type CompetitionLoadState,
} from "../pages/competitionLoad";
import { trackEvent } from "../utils/analytics";

interface Visit {
  start: number;
  authMs?: number;
  competitionMs?: number;
  slowSent: boolean;
  done: boolean;
}

/**
 * Whether the competition page has been loading for longer than
 * COMPETITION_SLOW_LOAD_MS, plus timing telemetry: one `competition_load`
 * event per visit when loading ends, and one `competition_load_slow` event
 * if it crosses the threshold first. The competition id only scopes a visit;
 * it is never sent.
 */
export const useCompetitionLoad = (
  competitionId: string | undefined,
  state: CompetitionLoadState,
) => {
  const isLoading = state.kind === "loading";
  const [isSlow, setIsSlow] = useState(false);
  const visit = useRef<Visit | null>(null);

  useEffect(() => {
    visit.current = { start: performance.now(), slowSent: false, done: false };
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
    const v = visit.current;
    if (!v || v.done) return;
    const elapsed = performance.now() - v.start;
    if (state.kind !== "loading" || state.stage !== "auth")
      v.authMs ??= elapsed;
    if (state.kind !== "loading" || state.stage === "season") {
      if (state.kind !== "signed-out") v.competitionMs ??= elapsed;
    }
    const params = () =>
      competitionLoadEventParams({
        state,
        elapsedMs: elapsed,
        authMs: v.authMs,
        competitionMs: v.competitionMs,
        wasSlow: v.slowSent,
        origin: window.location.origin,
      });
    if (isLoading) {
      if (isSlow && !v.slowSent) {
        v.slowSent = true;
        trackEvent("competition_load_slow", params());
      }
      return;
    }
    v.done = true;
    trackEvent("competition_load", params());
  }, [state, isLoading, isSlow]);

  return { isSlow: isLoading && isSlow };
};
