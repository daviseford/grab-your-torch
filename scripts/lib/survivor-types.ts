/**
 * TypeScript types matching the survivoR dataset schema.
 * Source: https://github.com/doehm/survivoR (dev/json/)
 *
 * Fields use the exact names from the JSON data.
 * Numbers come as floats from JSON (e.g., season: 1.0).
 */

/** Fields shared by every survivoR table row. */
interface SurvivorBaseRecord {
  version: string;
  version_season: string;
  season: number;
}

/** castaways.json — one row per castaway per season appearance */
export interface SurvivorCastaway extends SurvivorBaseRecord {
  full_name: string;
  castaway_id: string;
  castaway: string; // short name
  age: number | null;
  city: string | null;
  state: string | null;
  episode: number;
  day: number | null;
  order: number;
  result: string;
  place: number;
  original_tribe: string;
  jury: boolean;
  finalist: boolean;
  winner: boolean;
}

/** episodes.json — one row per episode */
export interface SurvivorEpisode extends SurvivorBaseRecord {
  episode_number_overall: number;
  episode: number;
  episode_title: string;
  episode_label: string;
  episode_date: string; // ISO date, e.g. "2025-02-26"
  episode_length: number | null;
  viewers: number | null;
  imdb_rating: number | null;
  n_ratings: number | null;
  episode_summary: string | null;
}

/** challenge_results.json — one row per castaway per challenge */
export interface SurvivorChallengeResult extends SurvivorBaseRecord {
  episode: number;
  n_boots: number;
  castaway_id: string;
  castaway: string;
  tribe: string;
  tribe_status: string;
  challenge_type: string; // "Immunity", "Reward", "Immunity and Reward"
  outcome_type: string; // "Tribal", "Individual", "Team"
  result: string; // "Won", "Lost", "Won (immunity only)", etc.
  chosen_for_reward: boolean;
  challenge_id: number;
  sit_out: boolean;
  order_of_finish: number | null;
  sog_id: number;
  won: number; // 1/0 binary
  won_tribal_reward: number;
  won_tribal_immunity: number;
  won_team_reward: number;
  won_team_immunity: number;
  won_individual_reward: number;
  won_individual_immunity: number;
  won_duel: number;
}

/** vote_history.json — one row per vote cast */
export interface SurvivorVoteHistory extends SurvivorBaseRecord {
  episode: number;
  day: number;
  tribe_status: string;
  tribe: string;
  castaway: string;
  vote: string;
  vote_event?: string;
  vote_event_outcome?: string;
  /** Why the castaway was safe at this vote: "Individual", "Hidden" (an idol), etc. */
  immunity?: string | null;
  nullified: boolean;
  tie: boolean;
  voted_out: string;
  order: number;
  vote_order: number;
  castaway_id: string;
  vote_id: string;
  voted_out_id: string;
  sog_id: number;
  challenge_id: number;
}

/** advantage_details.json — catalog of advantages per season */
export interface SurvivorAdvantageDetail extends SurvivorBaseRecord {
  advantage_id: number;
  advantage_type: string; // "Hidden Immunity Idol", "Extra Vote", "Steal a Vote", etc.
  clue_details: string | null;
  location_found: string | null;
  conditions: string | null; // "Beware advantage" or null
}

/** advantage_movement.json — one row per advantage event */
export interface SurvivorAdvantageMovement extends SurvivorBaseRecord {
  castaway: string;
  castaway_id: string;
  advantage_id: number;
  sequence_id: number;
  day: number | null;
  episode: number;
  event: string; // "Found", "Found (beware)", "Played", "Received", "Transferred", etc.
  played_for?: string | null; // short name of the player the idol was played for
  played_for_id?: string | null; // castaway_id of the player the idol was played for
  success?: boolean | null; // whether the idol play was successful (negated votes)
  votes_nullified?: number | null; // number of votes nullified by this play
  sog_id: number;
}

/** tribe_mapping.json — one row per castaway per episode (tribe membership) */
export interface SurvivorTribeMapping extends SurvivorBaseRecord {
  episode: number;
  day: number;
  castaway_id: string;
  castaway: string;
  tribe: string;
  tribe_status: string; // "Original", "Swapped", "Merged"
}

/** journeys.json — one row per castaway per journey (S41+) */
export interface SurvivorJourney extends SurvivorBaseRecord {
  episode: number;
  sog_id: number;
  castaway_id: string;
  castaway: string;
  reward: string | null; // "Extra vote", "Block a Vote", "Lost vote", etc.
  lost_vote: boolean;
  chose_to_play?: boolean; // S44+ only
  game_played?: string; // S44+ only
  event?: string; // "Risked vote", "Did not risk vote", etc. (S44+ only)
}

/**
 * challenge_description.json — one row per challenge. Not transformed into
 * app data; the episode readiness gate reads it as survivoR's own list of an
 * episode's challenges (see episode-readiness.ts).
 */
export interface SurvivorChallengeDescription extends SurvivorBaseRecord {
  episode: number;
  challenge_id: number;
  challenge_type: string;
}

/**
 * castaway_details.json: one row per person across every season and
 * version, with no `version` or `season` column. Only the columns the sync
 * reads are typed.
 */
export interface SurvivorCastawayDetails {
  castaway_id: string;
  full_name: string | null;
}

/** Table names available from survivoR */
export type SurvivorTable =
  | "castaways"
  | "episodes"
  | "challenge_results"
  | "challenge_description"
  | "vote_history"
  | "advantage_details"
  | "advantage_movement"
  | "tribe_mapping"
  | "journeys"
  | "castaway_details";
