import type { CastawayId } from "../../types";
import type { AdpCompetitionSource } from "../castawayAdp";
import { snakePickIndex } from "../draftRealtime";

export const BEFORE_PREMIERE = new Date("2026-09-20T18:00:00Z");
export const ACCOUNTS_CREATED = new Date("2026-01-01T00:00:00Z");

let nextId = 0;

export type PromotedOptions = {
  participants?: number;
  /** Participant uids; defaults to a fresh group each call. */
  uids?: string[];
  createdAt?: Date | null;
  updatedAt?: Date | null;
  seasonId?: string;
  extra?: Record<string, unknown>;
};

/**
 * A promoted draft exactly as production stores it: the competition doc with
 * its frozen `draft_picks`, joined to the Realtime Database draft it came
 * from (picks keyed by pick number, participants keyed by uid, the snake
 * turn map, and a finished state). Castaways are listed in pick order, each
 * written at its one-based overall pick number by the drafter the real
 * snake-order helper chooses.
 */
export const promoted = (
  pickedInOrder: CastawayId[],
  {
    participants = 2,
    uids: givenUids,
    createdAt = BEFORE_PREMIERE,
    updatedAt = createdAt,
    seasonId = "season_51",
    extra = {},
  }: PromotedOptions = {},
): AdpCompetitionSource => {
  const n = nextId++;
  const uids =
    givenUids ??
    Array.from({ length: participants }, (_, i) => `uid_${n}_${i}`);
  const draftId = `draft_${n}`;
  const competitionId = `competition_${n}`;
  const picks = pickedInOrder.map((castaway_id, index) => ({
    season_id: seasonId,
    season_num: 51,
    order: index + 1,
    user_uid: uids[snakePickIndex(index + 1, uids.length)],
    user_name: "someone",
    castaway_id,
    player_name: castaway_id,
  }));
  return {
    id: competitionId,
    createdAt,
    updatedAt,
    data: {
      id: competitionId,
      season_id: seasonId,
      draft_id: draftId,
      creator_uid: uids[0],
      participant_uids: uids,
      participants: uids.map((uid) => ({ uid, displayName: uid })),
      draft_picks: picks,
      ...extra,
    },
    sourceDraft: {
      id: draftId,
      season_id: seasonId,
      competiton_id: competitionId,
      creator_uid: uids[0],
      participants: Object.fromEntries(
        uids.map((uid) => [uid, { uid, displayName: uid }]),
      ),
      turns: Object.fromEntries(
        picks.map((pick) => [String(pick.order), pick.user_uid]),
      ),
      draft_picks: Object.fromEntries(
        picks.map((pick) => [String(pick.order), { ...pick }]),
      ),
      state: { started: true, finished: true },
    },
  };
};

/** Every participant in the sources, as an account made before any draft. */
export const accountsFor = (
  sources: readonly AdpCompetitionSource[],
): Map<string, Date> =>
  new Map(
    sources.flatMap((source) =>
      Array.isArray(source.data.participant_uids)
        ? (source.data.participant_uids as string[]).map(
            (uid) => [uid, ACCOUNTS_CREATED] as const,
          )
        : [],
    ),
  );
