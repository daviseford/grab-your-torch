import type { PropBetQuestionKey } from "../data/propbets";
import type { Pool, PoolEntryId, PoolPick, PropBetsFormData } from "../types";
import { validatePoolHandle } from "./poolHandle";

/**
 * The create payload for `pools/{poolId}/entries/{uid}`.
 *
 * The Firestore rules validate this with an allowlist (`keys().hasOnly` plus
 * `keys().hasAll`), so a payload carrying one extra key, or missing one, is
 * simply denied with no explanation the client can show. This module is the
 * single place that shape is written, and the test beside it asserts the exact
 * key set rather than trusting the type.
 *
 * `created_at` and `updated_at` are pinned to `request.time` by the rules
 * (KTD4), so they must be `serverTimestamp()` sentinels. The sentinel factory
 * is injected rather than imported so this module stays pure and testable.
 */

/** What the pool config must supply to build a payload. */
export type PoolEntryPayloadPool = Pick<
  Pool,
  "id" | "season_id" | "roster" | "picks_per_entry" | "prop_bet_keys"
>;

export type PoolEntryPayload = {
  id: PoolEntryId;
  pool_id: Pool["id"];
  season_id: Pool["season_id"];
  handle: string;
  picks: PoolPick[];
  prop_bets: PropBetsFormData;
  created_at: unknown;
  updated_at: unknown;
};

export type BuildPoolEntryPayloadInput = {
  uid: string;
  pool: PoolEntryPayloadPool;
  picks: readonly PoolPick[];
  handle: string;
  propBets: PropBetsFormData;
  /** `serverTimestamp` from the Firestore SDK, or a test sentinel. */
  timestamp: () => unknown;
};

export class PoolEntryPayloadError extends Error {
  readonly field: PoolEntryBlockerField;
  constructor(field: PoolEntryBlockerField, message: string) {
    super(message);
    this.name = "PoolEntryPayloadError";
    this.field = field;
  }
}

export type PoolEntryBlockerField = "picks" | "handle" | "prop_bets";

export type PoolEntryBlocker = {
  field: PoolEntryBlockerField;
  message: string;
};

export type PoolEntryReadinessInput = {
  pool: PoolEntryPayloadPool;
  picks: readonly PoolPick[];
  handle: string;
  propBets: PropBetsFormData;
};

const answeredKeys = (
  propBets: PropBetsFormData,
  keys: readonly PropBetQuestionKey[],
): PropBetQuestionKey[] =>
  keys.filter((key) => {
    const value = propBets[key];
    return typeof value === "string" && value.trim().length > 0;
  });

/**
 * Everything standing between the entrant and a submitted entry, in the order
 * the page presents it. Empty means the entry is ready to write.
 *
 * The page shows these rather than only disabling a control: a disabled
 * submit with no stated reason is the same dead end as a swallowed tap.
 */
export const getPoolEntryBlockers = ({
  pool,
  picks,
  handle,
  propBets,
}: PoolEntryReadinessInput): PoolEntryBlocker[] => {
  const blockers: PoolEntryBlocker[] = [];

  const limit = pool.picks_per_entry;
  if (picks.length !== limit) {
    const remaining = limit - picks.length;
    blockers.push({
      field: "picks",
      message:
        remaining > 0
          ? `Choose ${remaining} more castaway${remaining === 1 ? "" : "s"} to reach ${limit}.`
          : `Choose ${limit} castaways.`,
    });
  }

  const handleError = validatePoolHandle(handle);
  if (handleError) blockers.push({ field: "handle", message: handleError });

  const unanswered =
    pool.prop_bet_keys.length - answeredKeys(propBets, pool.prop_bet_keys).length;
  if (unanswered > 0) {
    blockers.push({
      field: "prop_bets",
      message: `Answer ${unanswered} more prop bet${unanswered === 1 ? "" : "s"}.`,
    });
  }

  return blockers;
};

/** True when a submit would produce a payload the rules accept. */
export const canSubmitPoolEntry = (input: PoolEntryReadinessInput): boolean =>
  getPoolEntryBlockers(input).length === 0;

/**
 * Build the create payload, or throw with the field that is wrong.
 *
 * Picks are resolved against the pool roster and the roster's own objects are
 * copied through verbatim. The rules match a pick as a whole
 * `{castaway_id, full_name}` pair against `pool.roster`, and the remap audit
 * treats the stored name as ground truth (R23), so a name rebuilt from a local
 * lookup, or a client-supplied name that disagrees, must never be what lands.
 */
export const buildPoolEntryPayload = ({
  uid,
  pool,
  picks,
  handle,
  propBets,
  timestamp,
}: BuildPoolEntryPayloadInput): PoolEntryPayload => {
  const blockers = getPoolEntryBlockers({ pool, picks, handle, propBets });
  if (blockers.length > 0) {
    throw new PoolEntryPayloadError(blockers[0].field, blockers[0].message);
  }

  const seen = new Set<string>();
  const resolved: PoolPick[] = [];
  for (const pick of picks) {
    if (seen.has(pick.castaway_id)) {
      throw new PoolEntryPayloadError(
        "picks",
        "The same castaway cannot be chosen twice.",
      );
    }
    seen.add(pick.castaway_id);
    const rosterEntry = pool.roster.find(
      (entry) => entry.castaway_id === pick.castaway_id,
    );
    if (!rosterEntry) {
      throw new PoolEntryPayloadError(
        "picks",
        "One of your picks is no longer part of this season's cast.",
      );
    }
    resolved.push(rosterEntry);
  }

  const prop_bets: PropBetsFormData = {};
  for (const key of answeredKeys(propBets, pool.prop_bet_keys)) {
    prop_bets[key] = propBets[key];
  }

  return {
    id: `pool_entry_${uid}`,
    pool_id: pool.id,
    season_id: pool.season_id,
    handle,
    picks: resolved,
    prop_bets,
    created_at: timestamp(),
    updated_at: timestamp(),
  };
};
