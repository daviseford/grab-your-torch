import { User } from "firebase/auth";
import { PropBetQuestionKey } from "../data/propbets";

export type CastawayId = `US${string}`;

export type CastawayLookup = Record<
  CastawayId,
  { full_name: string; castaway: string }
>;

export type Season = {
  id: `season_${number}`;
  order: number;
  name: string;
  img: string;
  players: Player[];
  episodes: Episode[];
  castawayLookup: CastawayLookup;
  /** ISO timestamp of the last data sync; present only on Firestore docs. */
  last_synced_at?: string;
  /**
   * Content hash of this season's episodes, challenges, eliminations, and
   * events. Bumped by every writer -- the sync push and every admin CRUD
   * path -- so a derived cache can tell whether it was built from this data.
   * Absent on documents written before the stamp existed.
   */
  data_revision?: string;
  /**
   * The build-time scoring-code revision in force when this document was
   * last written. Paired with `data_revision`: either mismatching means a
   * derived cache is stale.
   */
  scoring_revision?: string;
};

export type Episode<SeasonNumber = number> = {
  id: `episode_${string}`;

  season_id: Season["id"];
  season_num: SeasonNumber;

  order: number;
  name: string;

  /** ISO air date (YYYY-MM-DD) from survivoR, when known. */
  air_date?: string;

  finale: boolean;
  post_merge: boolean;
  merge_occurs: boolean;
};

export const EliminationVariants = [
  "ejected",
  "final_tribal_council",
  "medical",
  "other",
  "quitter",
  "switched",
  "tribal",
] as const;

export type EliminationVariant = (typeof EliminationVariants)[number];

export type Elimination<
  Id extends CastawayId = CastawayId,
  SeasonNumber = number,
> = {
  id: `elimination_${string}`;

  season_id: Season["id"];
  season_num: SeasonNumber;

  episode_id: Episode["id"];
  episode_num: number;

  castaway_id: Id;

  order: number;
  variant: EliminationVariant;
  votes_received?: number;
};

export type Player<
  Id extends CastawayId = CastawayId,
  SeasonNumber = number,
> = {
  season_id: Season["id"];
  season_num: SeasonNumber;
  castaway_id: Id;
  full_name: string;
  img: string;
  description?: string;
  age?: number;
  profession?: string;
  hometown?: string;
  previousSeasons?: number[];
  bio?: string;
  nickname?: string;
};

export type Team = {
  id: `team_${string}`;
  season_id: Season["id"];
  season_num: number;
  name: string;
  color: string;
};

/**
 * A snapshot of player-to-team assignments for a single episode.
 * Keys are castaway IDs, values are team IDs or null (no team).
 */
export type TeamAssignmentSnapshot = Record<CastawayId, Team["id"] | null>;

/**
 * All team assignment snapshots for a season.
 * Keys are episode numbers (as strings, since Firestore keys are strings).
 */
export type TeamAssignments = Record<string, TeamAssignmentSnapshot>;

export type Challenge<
  Id extends CastawayId = CastawayId,
  SeasonNumber = number,
> = {
  id: `challenge_${string}`;

  season_id: Season["id"];
  season_num: SeasonNumber;

  episode_id: Episode["id"];
  episode_num: number;

  order: number;
  variant: ChallengeWinAction;

  /**
   * List of castaway IDs who won
   */
  winning_castaways: Id[];

  /**
   * Optional: the team that won this challenge.
   * Audit/display metadata only -- winning_castaways is the scoring source of truth.
   */
  winning_team_id?: Team["id"] | null;
};

export type SlimUser = Pick<User, "email" | "uid" | "displayName"> & {
  isAdmin: boolean;
};

export type Draft = {
  id: `draft_${string}`;

  season_id: Season["id"];
  season_num: number;

  competiton_id: Competition["id"];

  // creator's uid
  creator_uid: string;
  participants: SlimUser[];
  total_players: number;
  current_pick_number: number;
  current_picker: SlimUser | null;
  /** List of user uids */
  pick_order: SlimUser[];
  draft_picks: DraftPick[];

  prop_bets: PropBetsEntry[];

  started: boolean;
  finished: boolean;
};

export type PropBetsEntry = {
  id: `propbet_${string}`;
  user_name: string;
  user_uid: string;
  values: PropBetsFormData;
};

export type PropBetsFormData = Partial<Record<PropBetQuestionKey, string>>;

export type DraftPick = {
  season_id: Season["id"];
  season_num: number;
  order: number;
  user_name: string;
  user_uid: string;
  castaway_id: CastawayId;
  player_name: string;
};

export type PropBet = {
  id: `propbet_${string}`;

  season_id: Season["id"];
  season_num: number;
  draft_id: Draft["id"];

  description: string;
  point_value: number;
  answers: {
    participant_uid: string;
    answer: string;
  }[];
  correct_answer: string;
  finished: boolean;
};

export type Competition = {
  id: `competition_${string}`;
  competition_name: string;

  season_id: Season["id"];
  season_num: number;
  draft_id: Draft["id"];

  creator_uid: string;
  participant_uids: string[];
  participants: SlimUser[];

  draft_picks: DraftPick[];
  /**
   * legacy drafts don't have prop_bets, remove this ? after Season 46 probably
   */
  prop_bets?: PropBetsEntry[];

  /**
   * Per-competition display names, keyed by participant uid.
   * Absent on pre-feature docs — fall back to SlimUser.displayName.
   */
  team_names?: Record<string, string>;

  current_episode: number | null;
  finished: boolean;
};

export const TradeStatuses = [
  "pending",
  "accepted",
  "rejected",
  "canceled",
] as const;

export type TradeStatus = (typeof TradeStatuses)[number];

/**
 * A proposed or completed trade between two competition participants.
 * Lives in the `competitions/{id}/trades` subcollection; `draft_picks` on the
 * competition is never mutated — ownership history is derived from the base
 * draft picks plus accepted trades (see utils/tradeUtils.ts).
 */
export type Trade = {
  id: `trade_${string}`;

  competition_id: Competition["id"];
  season_id: Season["id"];

  /** Participant who created the trade offer. */
  offered_by_uid: string;
  /** Participant the offer is directed at. */
  offered_to_uid: string;

  /** Castaways offered_by gives up. */
  offered_castaway_ids: CastawayId[];
  /** Castaways offered_to gives up. */
  requested_castaway_ids: CastawayId[];

  status: TradeStatus;

  /**
   * First episode whose points go to the new owner. Points from earlier
   * episodes stay with the original owner. Set at acceptance time.
   */
  effective_episode?: number;

  /** ISO timestamps. */
  created_at: string;
  resolved_at?: string;
};

export type VoteHistory<
  Id extends CastawayId = CastawayId,
  SeasonNumber = number,
> = {
  id: `vote_${string}`;

  season_id: Season["id"];
  season_num: SeasonNumber;

  episode_id: Episode["id"];
  episode_num: number;

  tribe: string;
  voter_castaway_id: Id;
  target_castaway_id: Id;
  voted_out_castaway_id: Id;
  nullified: boolean;
  tie: boolean;
  sog_id: number;
  vote_order: number;
};

export type GameEvent<
  Id extends CastawayId = CastawayId,
  SeasonNumber = number,
> = {
  id: `event_${string}`;

  season_id: Season["id"];
  season_num: SeasonNumber;

  episode_id: Episode["id"];
  episode_num: number;

  action: GameEventAction;
  multiplier: number | null;
  castaway_id: Id;
};

export const ChallengeWinActions = [
  "duel",
  "reward",
  "team_reward",
  "immunity",
  "team_immunity",
] as const;

export type ChallengeWinAction = (typeof ChallengeWinActions)[number];

export const GameEventActions = [
  "accept_beware_advantage",
  "find_amulet",
  "find_bank_your_vote",
  "find_beware_advantage",
  "find_block_a_vote",
  "find_challenge_advantage",
  "find_control_the_vote",
  "find_extra_vote",
  "find_idol",
  "find_idol_nullifier",
  "find_knowledge_is_power",
  "find_other_advantage",
  "find_safety_without_power",
  "find_steal_a_vote",
  "fulfill_beware_advantage",
  "go_on_journey",
  "journey_lost_vote",
  "journey_risked_vote",
  "journey_won_game",
  "make_final_tribal_council",
  "make_merge",
  "use_amulet",
  "use_bank_your_vote",
  "use_block_a_vote",
  "use_challenge_advantage",
  "use_control_the_vote",
  "use_extra_vote",
  "use_idol",
  "use_idol_nullifier",
  "use_knowledge_is_power",
  "use_other_advantage",
  "use_safety_without_power",
  "use_shot_in_the_dark_successfully",
  "use_shot_in_the_dark_unsuccessfully",
  "use_steal_a_vote",
  "voted_out_with_advantage",
  "voted_out_with_idol",
  "votes_negated_by_idol",
  "win_block_a_vote",
  "win_fire_making",
  "win_extra_vote",
  "win_idol",
  "win_other_advantage",
  "win_steal_a_vote",
  "win_survivor",
] as const;

export type GameEventAction = (typeof GameEventActions)[number];

export const GameProgressActions = [
  "ejected",
  "eliminated",
  "medically_evacuated",
  "quitter",
] as const;

export type GameProgressAction = (typeof GameProgressActions)[number];

export const PlayerActions = [
  ...ChallengeWinActions,
  ...GameEventActions,
  ...GameProgressActions,
] as const;

export type PlayerAction = (typeof PlayerActions)[number];

export type PlayerScoring = {
  action: PlayerAction;
  description: string;
  multiplier?: boolean;
  fixed_value?: number;
};

/* ------------------------------------------------------------------ *
 * Season data revision
 * ------------------------------------------------------------------ */

/**
 * The four collections a derived score depends on. The content hash over
 * this payload is the season-data revision (see utils/seasonRevision.ts).
 *
 * Deliberately loose in its value types: the same function is called from
 * the browser with typed hook data and from Node scripts with the result of
 * a dynamic import, and the hash only ever reads structure.
 */
export type SeasonRevisionPayload = {
  episodes: readonly unknown[];
  challenges: Readonly<Record<string, unknown>>;
  eliminations: Readonly<Record<string, unknown>>;
  events: Readonly<Record<string, unknown>>;
};

/** The revision pair written by every season-data writer. */
export type SeasonRevisionStamp = {
  data_revision: string;
  scoring_revision: string;
};

/* ------------------------------------------------------------------ *
 * Public season pool
 * ------------------------------------------------------------------ */

export type PoolId = `pool_${string}`;
export type PoolEntryId = `pool_entry_${string}`;

export const PoolStatuses = ["open", "closed"] as const;
export type PoolStatus = (typeof PoolStatuses)[number];

export const PoolDisplayModes = ["full", "leaderboard"] as const;
export type PoolDisplayMode = (typeof PoolDisplayModes)[number];

/**
 * A castaway on a roster or an entry.
 *
 * The full name always travels with the id (R23). Season 51's castaway ids
 * are provisional predictions, so a remap has to stay detectable long after
 * the ids themselves have changed.
 */
export type PoolPick = {
  castaway_id: CastawayId;
  full_name: string;
};

/**
 * `pools/{poolId}` -- the pool configuration document.
 *
 * The single authority for every pool decision, and never client-writable,
 * admin claim included (KTD3). Job-written counters live on the sibling
 * `pools/{poolId}/meta/counters` document so that a bad job payload cannot
 * take the freeze instant with it.
 */
export type Pool = {
  id: PoolId;

  season_id: Season["id"];
  season_num: number;

  /** Display name for the pool, e.g. "Survivor 51 Season Pool". */
  name: string;

  /**
   * The instant entries close, as an ISO timestamp. Every surface that
   * decides whether the pool is open reads this, never SEASON_METADATA
   * (R11). Security rules compare it against `request.time` (KTD4).
   */
  freeze_at: string;

  /** The authoritative cast. The entry page reads it instead of a season doc. */
  roster: PoolPick[];

  /** Math.floor(roster.length / 3). */
  picks_per_entry: number;

  /**
   * The prop bet question keys an entry must answer. Rules cannot read the
   * TypeScript question list, so the keys are mirrored here (KTD3).
   */
  prop_bet_keys: PropBetQuestionKey[];

  /** The kill switch. Every write condition consumes it. */
  status: PoolStatus;

  /** "full" while entry is open, "leaderboard" once the season is airing. */
  display_mode: PoolDisplayMode;

  /**
   * The newest episode with published standings. Flipped last by the
   * recompute job so a reader never lands on a pointer aimed at documents
   * that are still stale or absent.
   */
  latest_episode_num: number | null;

  /** Stamped by the job when a win_survivor event is present. */
  season_complete: boolean;
};

/**
 * `pools/{poolId}/meta/counters` -- everything the recompute job counts.
 *
 * Separate from the config on purpose: the config is a rules input for every
 * entry write.
 */
export type PoolCounters = {
  entry_count: number;
  /** ISO timestamp of the last job run that wrote these counters. */
  updated_at: string;
};

/**
 * `pools/{poolId}/entries/{uid}` -- one entrant's entry.
 *
 * Readable only by its owner, before and after the freeze (KTD6). The
 * document id is the uid; there is deliberately no inner `uid` field.
 */
export type PoolEntry = {
  id: PoolEntryId;
  pool_id: PoolId;
  season_id: Season["id"];

  /** Public, 2 to 24 characters, not unique, editable after the freeze (R5). */
  handle: string;

  /** Exactly `picks_per_entry` picks, each a whole roster pair (R23). */
  picks: PoolPick[];

  prop_bets: PropBetsFormData;

  /** ISO timestamps pinned to `request.time` by rules (KTD4). */
  created_at: string;
  updated_at: string;
};

/**
 * One published leaderboard row.
 *
 * The uid is deliberately absent. Standings are world-readable and no
 * collection in this project publishes Firebase uids to signed-out readers;
 * the uid tie-break happens inside the job, before serialization (KTD6).
 */
export type PoolStandingsRow = {
  handle: string;
  total: number;
  prop_bet_points: number;
  /** Entrants who stay tied share a rank, and the next rank skips (KD4). */
  rank: number;
};

/** The inputs a published standings document records (R16). */
export type PoolStandingsStamp = {
  episode_num: number;
  /** ISO timestamp of the run that produced this document. */
  computed_at: string;
  data_revision: string;
  scoring_revision: string;
  /**
   * The pool's freeze instant as of this run. Recorded in every standings
   * document so that a moved deadline is loud rather than invisible (KTD4).
   */
  freeze_at: string;
};

/**
 * `pools/{poolId}/standings/{episodeId}` -- the summary document.
 *
 * Constant in size whatever the entrant count: it holds the top
 * POOL_STANDINGS_SUMMARY_ROWS rows and the counters, and nothing else. Reads
 * are not the binding constraint here, egress is.
 */
export type PoolStandings = PoolStandingsStamp & {
  entry_count: number;
  rows: PoolStandingsRow[];
  /** How many overflow pages exist under `pages/`. */
  page_count: number;
};

/**
 * `pools/{poolId}/standings/{episodeId}/pages/{n}` -- overflow rows.
 *
 * Fetched only when a visitor expands the leaderboard.
 */
export type PoolStandingsPage = PoolStandingsStamp & {
  /** Zero-based page index; the document id is the same number. */
  page: number;
  rows: PoolStandingsRow[];
};
