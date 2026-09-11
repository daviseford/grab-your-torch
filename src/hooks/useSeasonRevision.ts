import { useCallback, useMemo } from "react";
import { SeasonRevisionPayload, SeasonRevisionStamp } from "../types";
import { buildSeasonRevisionStamp } from "../utils/seasonRevision";
import { useChallenges } from "./useChallenges";
import { useEliminations } from "./useEliminations";
import { useEvents } from "./useEvents";
import { useSeason } from "./useSeason";

/**
 * The season-data revision, for the admin CRUD paths that write season data
 * directly from the browser.
 *
 * The sync push in `scripts/lib/firebase-push.ts` is not the only writer:
 * the season admin screens write `events`, `challenges`, `eliminations`, and
 * the season document's episodes. An admin correction that left the revision
 * alone would leave a derived cache looking fresh and being wrong, so every
 * one of those writes stamps a fresh revision on `seasons/{seasonId}` in the
 * same batch as its own write.
 *
 * All four collections are already subscribed elsewhere on these screens and
 * `useSharedSnapshot` ref-counts its listeners, so reading them here opens no
 * extra listener.
 */
export const useSeasonRevision = () => {
  const { data: season } = useSeason();
  const { data: challenges } = useChallenges(season?.id);
  const { data: eliminations } = useEliminations(season?.id);
  const { data: events } = useEvents(season?.id);

  const payload: SeasonRevisionPayload = useMemo(
    () => ({
      episodes: season?.episodes ?? [],
      challenges,
      eliminations,
      events,
    }),
    [season?.episodes, challenges, eliminations, events],
  );

  /**
   * Stamp the revision for the season data as it will look *after* the write
   * being made, by passing the affected collection's next value.
   *
   * If a snapshot has not landed yet the stamp is computed over less than the
   * full picture and comes out wrong. That is deliberately the safe
   * direction: a wrong revision differs from the cached one and forces a
   * recompute, whereas skipping the stamp would leave the cache looking
   * fresh, which is the failure this exists to prevent.
   */
  const stampFor = useCallback(
    (overrides: Partial<SeasonRevisionPayload> = {}): SeasonRevisionStamp =>
      buildSeasonRevisionStamp({ ...payload, ...overrides }),
    [payload],
  );

  return { payload, stampFor };
};
