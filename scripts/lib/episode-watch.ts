/**
 * The decision behind the bounded episode watch (`scripts/watch-episode.ts`).
 *
 * Pure: every input is gathered by the caller, so each state is testable
 * without the network. The watch is read-only. It never imports or pushes;
 * it says which human step is next and stops once production shows the
 * episode, or once its deadline passes.
 */

import type { EpisodeReadiness } from "./episode-readiness.js";

export interface EpisodeWatchConfig {
  seasonNum: number;
  episodeNum: number;
  /** ISO timestamp; past it, an unpublished episode is an alert. */
  deadline: string;
}

export interface EpisodeWatchObservation {
  upstream: EpisodeReadiness;
  /** Episode count in the committed season bundle on main. */
  bundleEpisodes: number;
  /** Episode count in production's public `seasons/{id}` document. */
  firestoreEpisodes: number;
  /** Production pool's `latest_episode_num`, or null when there is no pool. */
  poolLatestEpisode: number | null;
}

export type EpisodeWatchState =
  /** No survivoR rows for the episode yet. */
  | "waiting_upstream"
  /** Some rows, not all of them. Never import from this. */
  | "partial_upstream"
  /** survivoR is complete and main does not have the episode yet. */
  | "ready_to_import"
  /** main has the episode; production Firestore or standings do not yet. */
  | "awaiting_publication"
  /** main, the season document and pool standings all show the episode. */
  | "published"
  /** The bundle or production shows the episode but survivoR is not complete. */
  | "inconsistent"
  /** Deadline passed before publication. */
  | "expired";

export interface EpisodeWatchDecision {
  state: EpisodeWatchState;
  /** True once the watch has nothing left to do and should disable itself. */
  terminal: boolean;
  /** True when a person should look: ready, inconsistent, or expired. */
  alert: boolean;
  summary: string;
}

export function parseWatchConfig(raw: string): EpisodeWatchConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`EPISODE_WATCH is not JSON: ${raw}`);
  }
  const { season, episode, deadline } = (parsed ?? {}) as Record<
    string,
    unknown
  >;
  if (!Number.isInteger(season) || (season as number) < 1) {
    throw new Error("EPISODE_WATCH.season must be a positive integer");
  }
  if (!Number.isInteger(episode) || (episode as number) < 1) {
    throw new Error("EPISODE_WATCH.episode must be a positive integer");
  }
  if (typeof deadline !== "string" || Number.isNaN(Date.parse(deadline))) {
    throw new Error("EPISODE_WATCH.deadline must be an ISO timestamp");
  }
  return {
    seasonNum: season as number,
    episodeNum: episode as number,
    deadline,
  };
}

export function decideEpisodeWatch(
  config: EpisodeWatchConfig,
  obs: EpisodeWatchObservation,
  now: Date,
): EpisodeWatchDecision {
  const label = `Season ${config.seasonNum} episode ${config.episodeNum}`;
  const ep = config.episodeNum;
  const inBundle = obs.bundleEpisodes >= ep;
  const inFirestore = obs.firestoreEpisodes >= ep;
  const inStandings =
    obs.poolLatestEpisode === null || obs.poolLatestEpisode >= ep;
  const complete = obs.upstream.status === "complete";

  if (complete && inBundle && inFirestore && inStandings) {
    return {
      state: "published",
      terminal: true,
      alert: false,
      summary: `${label} is on main, in production Firestore and in pool standings.`,
    };
  }

  // Checked before the deadline: data that got ahead of survivoR needs a
  // person whether or not the watch has expired.
  if (!complete && (inBundle || inFirestore)) {
    return {
      state: "inconsistent",
      terminal: false,
      alert: true,
      summary: `${label} is ${inBundle ? "on main" : "in production"} but survivoR is ${obs.upstream.status}: ${obs.upstream.missing.join("; ")}.`,
    };
  }

  if (now.getTime() > Date.parse(config.deadline)) {
    return {
      state: "expired",
      terminal: true,
      alert: true,
      summary: `${label} was not published by ${config.deadline}. survivoR is ${obs.upstream.status}.`,
    };
  }

  if (complete && inBundle) {
    const pending = [
      !inFirestore && "production season document",
      !inStandings && "pool standings",
    ].filter(Boolean);
    return {
      state: "awaiting_publication",
      terminal: false,
      alert: true,
      summary: `${label} is on main; still missing from: ${pending.join(", ")}.`,
    };
  }

  if (complete) {
    return {
      state: "ready_to_import",
      terminal: false,
      alert: true,
      summary: `survivoR has every scoring input for ${label}; main does not have it yet.`,
    };
  }

  if (obs.upstream.status === "partial") {
    return {
      state: "partial_upstream",
      terminal: false,
      alert: false,
      summary: `survivoR has part of ${label}: ${obs.upstream.missing.join("; ")}.`,
    };
  }

  return {
    state: "waiting_upstream",
    terminal: false,
    alert: false,
    summary: `survivoR has no rows for ${label} yet.`,
  };
}
