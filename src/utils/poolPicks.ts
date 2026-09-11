import type { CastawayId, PoolPick } from "../types";

/**
 * The entry-pick reducer.
 *
 * Picks in a pool are non-exclusive (R3): no castaway is ever unavailable,
 * however many entrants hold them, and there is no pick order, no turn, and no
 * owner. The only bound is how many picks one entry holds.
 *
 * At that bound every card stays operable. Selecting one more replaces the
 * earliest pick rather than being ignored, because greying the rest out would
 * contradict R3 on screen and swallowing the tap reads as a broken page at the
 * exact moment someone is deciding whether to finish.
 */

export type PoolPickToggleAction =
  /** The castaway was added below the limit. */
  | "added"
  /** The castaway was already chosen and has been deselected. */
  | "removed"
  /** The limit was already reached; the earliest pick was replaced. */
  | "swapped"
  /** Nothing can be selected (a pool that allows zero picks). */
  | "blocked";

export type PoolPickToggleResult = {
  picks: PoolPick[];
  action: PoolPickToggleAction;
  /** The pick that left the selection, for the on-screen swap message. */
  removed?: PoolPick;
};

/** Whether a castaway is already among the chosen picks. */
export const isPoolPickSelected = (
  picks: readonly PoolPick[],
  castawayId: CastawayId,
): boolean => picks.some((pick) => pick.castaway_id === castawayId);

/**
 * The pick the next selection would replace, or null when there is room. This
 * is what the picker names on screen so a swap is never a surprise.
 */
export const nextPoolSwapTarget = (
  picks: readonly PoolPick[],
  limit: number,
): PoolPick | null => (picks.length >= limit && limit > 0 ? picks[0] : null);

/**
 * Select, deselect, or swap. Never mutates its input and never returns more
 * than `limit` picks or the same castaway twice.
 */
export const togglePoolPick = (
  picks: readonly PoolPick[],
  candidate: PoolPick,
  limit: number,
): PoolPickToggleResult => {
  const existing = picks.findIndex(
    (pick) => pick.castaway_id === candidate.castaway_id,
  );
  if (existing !== -1) {
    const next = picks.filter((_, index) => index !== existing);
    return { picks: next, action: "removed", removed: picks[existing] };
  }

  if (limit <= 0) return { picks: [...picks], action: "blocked" };

  if (picks.length < limit) {
    return { picks: [...picks, candidate], action: "added" };
  }

  // At the limit: the earliest pick makes way, and the caller says so.
  const [removed, ...rest] = picks;
  return { picks: [...rest, candidate], action: "swapped", removed };
};
