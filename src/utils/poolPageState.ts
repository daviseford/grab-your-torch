import type { FirestoreTimestamp, Pool } from "../types";
import type { SeasonAirStatus } from "./seasonAirStatus";

/**
 * Which of the entry page's states to render.
 *
 * The pool configuration document is the single authority for every pool
 * decision (KTD3): `status` and the stored `freeze_at` are read from it, and
 * `SEASON_METADATA.premiere` is never an input to whether entry is open.
 *
 * The season air status is used for exactly one thing: choosing between two
 * messages when there is NO configuration document at all. A season that is
 * live or complete has no pool and never will (KD3), so it deserves a
 * different sentence from an upcoming season whose pool has not been
 * provisioned yet. It can never override a config document that exists, and
 * the test beside this module pins that down.
 */
export type PoolPageState =
  /** The config document has not resolved yet. */
  | "loading"
  /** No pool for this season. */
  | "no-pool"
  /** No pool, because the season has already premiered or finished. */
  | "not-upcoming"
  /** The kill switch is thrown: `status` is not "open". */
  | "closed"
  /** The stored freeze instant has passed. */
  | "frozen"
  /** Entry is open. */
  | "open";

export type ResolvePoolPageStateInput = {
  pool: Pool | undefined;
  /** False until the config document read has resolved. */
  poolLoaded: boolean;
  airStatus: SeasonAirStatus;
  /** Milliseconds since the epoch. */
  now: number;
};

/**
 * Milliseconds for a Firestore timestamp, without calling `toDate()`.
 *
 * The web SDK, the Admin SDK, and a plain snapshot object all agree on
 * `seconds` and `nanoseconds`; only the class methods differ. Reading the
 * fields keeps this module free of any SDK.
 */
export const timestampToMillis = (
  ts: Pick<FirestoreTimestamp, "seconds" | "nanoseconds">,
): number => ts.seconds * 1000 + Math.floor(ts.nanoseconds / 1_000_000);

export const resolvePoolPageState = ({
  pool,
  poolLoaded,
  airStatus,
  now,
}: ResolvePoolPageStateInput): PoolPageState => {
  if (!poolLoaded) return "loading";
  if (!pool) {
    return airStatus === "upcoming" ? "no-pool" : "not-upcoming";
  }
  // The kill switch is checked before the clock so a closed pool always
  // explains itself as closed rather than as frozen (R12).
  if (pool.status !== "open") return "closed";
  if (now >= timestampToMillis(pool.freeze_at)) return "frozen";
  return "open";
};
