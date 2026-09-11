import type {
  CastawayId,
  Challenge,
  Elimination,
  Episode,
  GameEvent,
} from "../types";
import { EnhancedScores, getEnhancedSurvivorPoints } from "./scoringUtils";

/**
 * Points every castaway earned, per episode, keyed by castaway id. The array
 * is dense and ordered to match the `episodes` argument, so index `i` is
 * always `episodes[i]` even when that episode produced nothing.
 *
 * Keyed by `string` rather than `CastawayId` so callers can hand the result
 * straight to the existing `Record<string, EnhancedScores[]>` consumers.
 */
export type SeasonPointsByCastaway = Record<string, EnhancedScores[]>;

/**
 * The shared scoring intermediate for both a competition and a public pool.
 *
 * Rosters are deliberately not an input: a castaway scores the same whether
 * they sit on no roster, one roster, or a thousand. Ownership resolution
 * (which is exclusive, and only meaningful inside a `Competition`) happens
 * downstream. This module must stay free of React, Firebase, browser globals,
 * and the ownership and trade helpers, because a Node recompute job imports it.
 *
 * Callers are responsible for spoiler scoping: pass only the challenges,
 * eliminations, events and episodes that have aired for the audience being
 * scored.
 */
export const getSeasonPointsByCastaway = (
  challenges: Challenge[],
  eliminations: Elimination[],
  events: GameEvent[],
  episodes: Episode[],
  castawayIds: CastawayId[],
): SeasonPointsByCastaway =>
  castawayIds.reduce<SeasonPointsByCastaway>((accum, castawayId) => {
    accum[castawayId] = episodes.map((episode) =>
      getEnhancedSurvivorPoints(
        challenges,
        eliminations,
        events,
        episode.order,
        castawayId,
      ),
    );

    return accum;
  }, {});

/**
 * Season totals per castaway, summed across the episodes that were scored.
 */
export const getSeasonTotalsByCastaway = (
  pointsByCastaway: SeasonPointsByCastaway,
): Record<string, number> =>
  Object.entries(pointsByCastaway).reduce<Record<string, number>>(
    (accum, [castawayId, perEpisode]) => {
      accum[castawayId] = perEpisode.reduce((total, x) => total + x.total, 0);
      return accum;
    },
    {},
  );
