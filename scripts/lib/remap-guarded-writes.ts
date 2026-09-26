/**
 * Writes by other scripts that must not interleave with a castaway id
 * cutover: pool provisioning, pool pick repair and ADP publishing.
 *
 * Checking the remap ledger once at the start of a run is not enough. A job
 * can read it, spend a minute computing, and write after the cutover began.
 * So each of these writes happens inside a Firestore transaction that first
 * reads the ledger and refuses if the refusal function objects to the status
 * it finds then. The transaction's read of the ledger conflicts with the
 * remap's own transaction that creates it, so the check and the write are
 * atomic with respect to the cutover beginning.
 */

import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  bundledCastState,
  ledgerStatusOf,
  remapLedgerPath,
  seasonPushRefusal,
  type RemapLedgerStatus,
} from "./remap-ledger.js";

/**
 * The season a pool belongs to (`pool_season_51` -> `season_51`), or null
 * for an id that is not a season pool. Callers must refuse on null rather
 * than skip their check.
 */
export const seasonIdFromPoolId = (
  poolId: string,
): `season_${number}` | null => {
  const m = /^pool_(season_\d+)$/.exec(poolId);
  return m ? (m[1] as `season_${number}`) : null;
};

/**
 * Run `apply` in a transaction that first reads the season's remap ledger
 * and throws, writing nothing, if `refusal` objects to its status.
 */
export async function guardedSeasonWrite(
  firestore: Firestore,
  seasonId: `season_${number}`,
  refusal: (status: RemapLedgerStatus) => string | null,
  apply: (tx: Transaction) => void,
): Promise<void> {
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(firestore.doc(remapLedgerPath(seasonId)));
    const status = snap.exists ? ledgerStatusOf(snap.data()) : "none";
    const reason = refusal(status);
    if (reason) throw new Error(`Refusing to write: ${reason}`);
    apply(tx);
  });
}

/**
 * `repair-pool-picks --write`: rewrite the named entries' picks, all in one
 * guarded transaction. A pool id that names no season is refused, never
 * written unchecked.
 */
export async function commitPoolRepairs(
  firestore: Firestore,
  poolId: string,
  repairs: readonly { entry_id: string; picks: unknown }[],
  updatedAt: unknown,
): Promise<void> {
  const seasonId = seasonIdFromPoolId(poolId);
  if (seasonId === null) {
    throw new Error(
      `Refusing to write: cannot tell which season pool ${poolId} belongs to`,
    );
  }
  await guardedSeasonWrite(
    firestore,
    seasonId,
    notDuringCutover(seasonId, "repair-pool-picks --write"),
    (tx) => {
      for (const repair of repairs) {
        tx.update(firestore.doc(`pools/${poolId}/entries/${repair.entry_id}`), {
          picks: repair.picks,
          updated_at: updatedAt,
        });
      }
    },
  );
}

/**
 * `create-pool --write` (with or without `--overwrite`): the pool config
 * carries a roster of castaway ids from the bundled cast, so it follows the
 * season push rule. Nothing during a cutover, and afterwards only from a
 * bundle on the same side as production.
 */
export async function commitPoolProvision(
  firestore: Firestore,
  seasonNum: number,
  writes: readonly { path: string; data: unknown }[],
  castawayLookup: unknown,
): Promise<void> {
  const seasonId = `season_${seasonNum}` as const;
  const bundle = bundledCastState(seasonNum, castawayLookup);
  await guardedSeasonWrite(
    firestore,
    seasonId,
    (status) => seasonPushRefusal(seasonId, status, bundle),
    (tx) => {
      for (const w of writes) {
        tx.set(firestore.doc(w.path), w.data as Record<string, unknown>);
      }
    },
  );
}

/** Refuse while the season's cutover is in progress. */
export const notDuringCutover =
  (seasonId: string, job: string) =>
  (status: RemapLedgerStatus): string | null =>
    status === "in_progress"
      ? `${job} would write castaway ids for ${seasonId} while its castaway id remap is in progress`
      : null;

/**
 * Refuse unless the cutover state is still the one the run planned against
 * (and not in progress): for jobs that compute for a while before writing.
 */
export const unchangedSince =
  (seasonId: string, job: string, planned: RemapLedgerStatus) =>
  (status: RemapLedgerStatus): string | null =>
    status === "in_progress" || status !== planned
      ? `${job} planned ${seasonId} with its castaway id remap ${planned}, and it is ${status} now; rerun`
      : null;
