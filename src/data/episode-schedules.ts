import type { Season } from "../types";

type ScheduledBroadcast = {
  order: number;
  air_date: string;
};

/**
 * Advance broadcast listings, separate from survivoR's scored episodes.
 * Dates below start at 8 PM America/New_York, including after DST ends.
 * Listings can change; update these dates when the broadcaster revises them.
 *
 * Season 51 checked September 11, 2026:
 * https://www.tvmaze.com/shows/114/survivor/episodes
 * https://api.tvmaze.com/shows/114/episodes
 * Premiere and regular Wednesday slot confirmed by CBS/Paramount:
 * https://www.paramountplus.com/sneak-peak/survivor-season-51-everything-to-know/
 */
export const EPISODE_SCHEDULES: Partial<
  Record<Season["id"], readonly ScheduledBroadcast[]>
> = {
  season_51: [
    { order: 1, air_date: "2026-09-23" },
    { order: 2, air_date: "2026-09-30" },
    { order: 3, air_date: "2026-10-07" },
    { order: 4, air_date: "2026-10-14" },
    { order: 5, air_date: "2026-10-21" },
    { order: 6, air_date: "2026-10-28" },
    { order: 7, air_date: "2026-11-04" },
    { order: 8, air_date: "2026-11-11" },
    { order: 9, air_date: "2026-11-18" },
  ],
};
