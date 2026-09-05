import type { SeasonMeta } from "../data/season-metadata";
import { getBroadcastDate } from "./episodeAirDate";

export type SeasonAirStatus = "upcoming" | "live" | "complete";

/**
 * Where a season sits in its broadcast run.
 *
 * `complete` comes from the season data (a declared winner). `premiere` is
 * the ISO air date of episode 1; an incomplete season without one is treated
 * as airing, which is how every season before 51 was registered.
 */
export const getSeasonAirStatus = (
  meta: Pick<SeasonMeta, "complete" | "premiere">,
  now: Date = new Date(),
): SeasonAirStatus => {
  if (meta.complete) return "complete";
  if (meta.premiere && meta.premiere > getBroadcastDate(now)) return "upcoming";
  return "live";
};

/** "2026-09-23" -> "September 23" */
export const formatPremiereDate = (premiere: string): string =>
  new Date(`${premiere}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
