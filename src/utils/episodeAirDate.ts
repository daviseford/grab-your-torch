import { EPISODE_SCHEDULES } from "../data/episode-schedules";
import { SEASON_METADATA } from "../data/season-metadata";
import { Challenge, Elimination, Episode, GameEvent, Season } from "../types";

/**
 * Helpers for reasoning about episode air dates vs. collected scoring data.
 *
 * Air dates come from survivoR (`Episode.air_date`) and tell us when an
 * episode aired; scoring data (challenges/eliminations/events) lags behind
 * by hours because the data sync runs on a daily schedule.
 */

// Keep the existing broadcast-date convention used by trades and the catalog.
const SURVIVOR_TIME_ZONE = "America/Los_Angeles";
const SURVIVOR_AIR_HOUR = 20;

const broadcastDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SURVIVOR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

// A scoring notice contains no results, so it starts with the first broadcast.
const scoringDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

const toBroadcastDateTime = (
  date: Date,
  formatter = broadcastDateTimeFormatter,
): { date: string; hour: number } => {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
};

/**
 * Today's date (YYYY-MM-DD) in the broadcast timezone.
 *
 * Anything that compares against `Episode.air_date` must use this rather than
 * the viewer's local date, or two users in different timezones disagree about
 * what "today" is at the same instant.
 */
export const getBroadcastDate = (now: Date = new Date()): string =>
  toBroadcastDateTime(now).date;

const hasAired = (airDate: string, now: Date): boolean => {
  const broadcastNow = toBroadcastDateTime(now, scoringDateTimeFormatter);
  return (
    airDate < broadcastNow.date ||
    (airDate === broadcastNow.date && broadcastNow.hour >= SURVIVOR_AIR_HOUR)
  );
};

const byOrder = (a: Episode, b: Episode) => a.order - b.order;

/**
 * The highest episode number present in the scoring data, or 0 when the
 * season has no scoring records yet (e.g. before the premiere).
 */
export function getLatestDataEpisode(
  challenges: Record<string, Challenge>,
  eliminations: Record<string, Elimination>,
  events: Record<string, GameEvent>,
): number {
  let max = 0;
  for (const record of [
    ...Object.values(challenges),
    ...Object.values(eliminations),
    ...Object.values(events),
  ]) {
    if (record.episode_num > max) max = record.episode_num;
  }
  return max;
}

export type AwaitingEpisode = Pick<Episode, "order" | "air_date">;

/**
 * The lowest-order episode that has aired but has no scoring data yet,
 * or null when the data is caught up with the broadcast schedule.
 *
 * Advance listings fill gaps before source episode records arrive. Active
 * seasons without a listing fall back to the premiere or next weekly broadcast.
 */
export function getAwaitingDataEpisode(
  season: Season,
  latestDataEpisode: number,
  now: Date = new Date(),
): AwaitingEpisode | null {
  const episodes = [...(season.episodes ?? [])].sort(byOrder);
  const meta = SEASON_METADATA[season.id];
  const airDates = new Map<number, AwaitingEpisode>(
    (meta?.complete ? [] : (EPISODE_SCHEDULES[season.id] ?? [])).map((ep) => [
      ep.order,
      ep,
    ]),
  );
  // Actual source dates take precedence over advance listings for that episode.
  for (const ep of episodes) {
    if (ep.air_date) airDates.set(ep.order, ep);
  }
  const scheduled = [...airDates.values()]
    .sort((a, b) => a.order - b.order)
    .find((ep) => ep.order > latestDataEpisode);
  if (scheduled?.air_date) {
    return hasAired(scheduled.air_date, now) ? scheduled : null;
  }

  // The source may not publish an episode record until its stats arrive.
  // For an active season, use its premiere or the next weekly broadcast.
  // An explicit upcoming episode above takes precedence (e.g. a skipped week).
  if (!meta || meta.complete) return null;
  const last = episodes
    .filter((ep) => ep.order <= latestDataEpisode && ep.air_date)
    .pop();
  let airDate = latestDataEpisode === 0 ? meta.premiere : undefined;
  if (last?.air_date && last.order === latestDataEpisode) {
    const next = new Date(`${last.air_date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    airDate = next.toISOString().slice(0, 10);
  }
  return airDate && hasAired(airDate, now)
    ? { order: latestDataEpisode + 1, air_date: airDate }
    : null;
}

interface CompetitionAwaitingDataInput {
  season: Season;
  latestDataEpisode: number;
  isScoringDataReady: boolean;
  currentEpisode: number | null | undefined;
  finished: boolean;
  hasWinner: boolean;
  now?: Date;
}

/**
 * Applies competition visibility rules to the aired-but-unsynced episode.
 */
export function getCompetitionAwaitingDataEpisode({
  season,
  latestDataEpisode,
  isScoringDataReady,
  currentEpisode,
  finished,
  hasWinner,
  now = new Date(),
}: CompetitionAwaitingDataInput): AwaitingEpisode | null {
  const isCaughtUp =
    currentEpisode == null || currentEpisode >= latestDataEpisode;

  if (!isScoringDataReady || finished || hasWinner || !isCaughtUp) {
    return null;
  }

  return getAwaitingDataEpisode(season, latestDataEpisode, now);
}

/**
 * The next episode scheduled to air after today, or null when the season
 * has no future-dated episodes.
 */
export function getNextAiringEpisode(
  season: Season,
  now: Date = new Date(),
): Episode | null {
  const broadcastDate = toBroadcastDateTime(now).date;
  return (
    [...(season.episodes ?? [])]
      .sort(byOrder)
      .find((ep) => ep.air_date !== undefined && ep.air_date > broadcastDate) ??
    null
  );
}
