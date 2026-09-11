import type { FirestoreTimestamp } from "../../types";
import {
  timestampToMillis,
  type PoolPageState,
} from "../../utils/poolPageState";

/**
 * Which entry controls the page offers, and when a second tab has moved on.
 *
 * R7 allows editing and withdrawal until the freeze. R9 closes both at the
 * freeze but keeps the handle editable (R5), and the post-freeze handle rule
 * still requires `status == "open"`, so the kill switch closes renames too.
 *
 * KTD4 is why this is only a resolver and never a guarantee: rules enforce the
 * freeze with `request.time` and browser clocks are not trustworthy, so this
 * decides what to *offer*, and a write may still be refused by the boundary a
 * moment later. Every caller must handle a denial it did not predict.
 */

export type PoolEntryControls =
  /** Nothing can be changed: no entry, or the pool is not open at all. */
  | "none"
  /** Before the freeze: the whole entry can be revised, or withdrawn. */
  | "edit-and-withdraw"
  /** After the freeze: the handle only, and it appears at the next update. */
  | "handle-only";

export type ResolvePoolEntryControlsInput = {
  /** From `resolvePoolPageState`, so the stored freeze instant is what decides (R11). */
  state: PoolPageState;
  hasEntry: boolean;
};

export const resolvePoolEntryControls = ({
  state,
  hasEntry,
}: ResolvePoolEntryControlsInput): PoolEntryControls => {
  if (!hasEntry) return "none";
  if (state === "open") return "edit-and-withdraw";
  // A frozen pool still accepts a handle change. A closed one does not: the
  // rules require `status == "open"` for that write as well, so offering the
  // control there would be a control that cannot succeed.
  if (state === "frozen") return "handle-only";
  return "none";
};

/**
 * True when the entry document has moved on since the open form read it.
 *
 * The form subscribes to its own entry document, so a save made in a second
 * tab arrives here rather than being silently overwritten when this tab
 * eventually submits its older state.
 *
 * Only a strictly newer server timestamp counts. An equal one is this tab's
 * own save echoing back, an older one is a stale local snapshot, and an absent
 * `current` is a withdrawal, which the page already handles by falling back to
 * the empty entry form.
 *
 * A snapshot carrying this tab's own pending write resolves `updated_at` to
 * null until the server acknowledges it, so an unresolved timestamp is treated
 * as "no news" rather than as a conflict.
 */
export const poolEntryChangedElsewhere = (
  baseline: FirestoreTimestamp | undefined,
  current: FirestoreTimestamp | undefined,
): boolean => {
  if (!isResolvedTimestamp(baseline) || !isResolvedTimestamp(current)) {
    return false;
  }
  return timestampToMillis(current) > timestampToMillis(baseline);
};

const isResolvedTimestamp = (
  value: FirestoreTimestamp | undefined,
): value is FirestoreTimestamp =>
  !!value &&
  typeof value.seconds === "number" &&
  typeof value.nanoseconds === "number";
