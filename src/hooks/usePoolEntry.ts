import {
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
  type FirestoreError,
} from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import {
  poolWriteDeniedMessage,
  type PoolWriteKind,
} from "../components/Pool/poolWriteRejection";
import { db } from "../firebase";
import type { PoolEntry, PoolId, PoolPick, PropBetsFormData } from "../types";
import {
  buildPoolEntryPayload,
  buildPoolEntryUpdatePayload,
  buildPoolHandleUpdatePayload,
  PoolEntryPayloadError,
  type PoolEntryPayloadPool,
} from "../utils/poolEntryPayload";
import { useUser } from "./useUser";

/**
 * The entrant's own entry document, and every write against it.
 *
 * `pools/{poolId}/entries/{uid}` is readable ONLY by its owner, before and
 * after the freeze (KTD6, AE5). A `list` of the entries collection is denied
 * outright, so this is a single-document listener and never a query: a `where`
 * clause here would fail rather than return fewer rows.
 *
 * That same listener is what makes a second tab's save visible to a form left
 * open in this one (R7): the page compares the entry's `updated_at` against
 * the one its open form started from rather than overwriting it blind.
 *
 * Four writes exist, and the rules accept each in exactly one shape:
 *
 *  - create: the full payload, `created_at` stamped from `request.time`.
 *  - update: the same payload with `created_at` OMITTED, before the freeze.
 *  - handle: a two-key diff, allowed after the freeze while the pool is open.
 *  - withdraw: a delete, owner only, before the freeze.
 */

export type PoolEntrySubmitOutcome =
  | { status: "created" }
  /** An update, handle change, or withdrawal the server acknowledged. */
  | { status: "saved" }
  /**
   * The write can never succeed as written. Mirrors the `invalid` result in
   * `useAuthContinuation`: never retried.
   *
   * `reason` separates the two cases, because they read completely differently
   * on screen. A `boundary` denial is the freeze or the kill switch refusing a
   * write that was correct: nothing the entrant can change fixes it. A
   * `payload` denial is the client refusing to send an entry that is not
   * finished, and names the field instead.
   */
  | { status: "denied"; reason: "boundary" | "payload"; message: string }
  /** Transient. The entered picks stay on screen and a retry is offered. */
  | { status: "failed"; message: string };

export type SubmitPoolEntryInput = {
  pool: PoolEntryPayloadPool;
  picks: readonly PoolPick[];
  handle: string;
  propBets: PropBetsFormData;
};

/** True for the two outcomes that mean the server has the write. */
export const isPoolWriteAcknowledged = (
  outcome: PoolEntrySubmitOutcome,
): outcome is { status: "created" } | { status: "saved" } =>
  outcome.status === "created" || outcome.status === "saved";

// ---------------------------------------------------------------------------
// Denied versus failed
// ---------------------------------------------------------------------------

const FAILED_MESSAGE: Record<PoolWriteKind, string> = {
  create: "We could not save your entry. Check your connection and try again.",
  update:
    "We could not save your changes. Check your connection and try again.",
  handle: "We could not save your handle. Check your connection and try again.",
  withdraw:
    "We could not withdraw your entry. Check your connection and try again.",
};

/**
 * Split a write failure into terminal and retryable, mirroring the
 * `invalid` / `failed` split in `useAuthContinuation`.
 *
 * `permission-denied` is the boundary talking: rules enforce the freeze and
 * the kill switch (KTD4, R10), and no amount of retrying changes their answer.
 * Everything else, INCLUDING a code this function has never seen, is treated
 * as transient. That default is deliberate and asymmetric: wrongly offering a
 * retry costs one more attempt, while wrongly declaring the pool closed tells
 * an entrant their entry is refused when their connection merely dropped, and
 * sends them away.
 *
 * The denial wording comes from `poolWriteDeniedMessage` so that a refusal
 * caught by a mounted form and one read back off the persisted record on the
 * next load say the same thing.
 */
export const classifyPoolWriteFailure = (
  code: string | undefined,
  kind: PoolWriteKind,
):
  | { status: "denied"; reason: "boundary"; message: string }
  | { status: "failed"; message: string } =>
  code === "permission-denied"
    ? {
        status: "denied",
        reason: "boundary",
        message: poolWriteDeniedMessage(kind),
      }
    : { status: "failed", message: FAILED_MESSAGE[kind] };

const NOT_SIGNED_IN: PoolEntrySubmitOutcome = {
  status: "failed",
  message: "Sign in to change your entry.",
};

export const usePoolEntry = (poolId?: PoolId) => {
  const { user, isAuthReady } = useUser();
  const uid = user?.uid;

  const [entry, setEntry] = useState<PoolEntry | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isAuthReady) return;
    if (!poolId || !uid) {
      // A signed-out visitor has no entry to read, and must still reach the
      // form (R18): this is not a gate, it is an absent subscription.
      setEntry(undefined);
      setLoaded(true);
      return;
    }

    setLoaded(false);
    const ref = doc(db, "pools", poolId, "entries", uid);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setEntry(snap.exists() ? (snap.data() as PoolEntry) : undefined);
        setLoaded(true);
      },
      (error: FirestoreError) => {
        console.error(
          `usePoolEntry(${poolId}/${uid}): onSnapshot error`,
          error,
        );
        setLoaded(true);
      },
    );
    return unsubscribe;
  }, [poolId, uid, isAuthReady]);

  /**
   * Run one write against this entrant's own document, turning a payload
   * problem or a Firestore error into an outcome the page can render.
   */
  const runWrite = useCallback(
    async (
      kind: PoolWriteKind,
      build: (ref: DocumentReference, ownerUid: string) => Promise<void>,
      success: PoolEntrySubmitOutcome,
    ): Promise<PoolEntrySubmitOutcome> => {
      if (!poolId || !uid) return NOT_SIGNED_IN;
      try {
        await build(doc(db, "pools", poolId, "entries", uid), uid);
        return success;
      } catch (error) {
        if (error instanceof PoolEntryPayloadError) {
          // The client caught it before the rules did, so it names the field.
          return {
            status: "denied",
            reason: "payload",
            message: error.message,
          };
        }
        const code = (error as FirestoreError)?.code;
        if (code !== "permission-denied") {
          console.error(`usePoolEntry(${poolId}): ${kind} failed`, error);
        }
        return classifyPoolWriteFailure(code, kind);
      }
    },
    [poolId, uid],
  );

  /**
   * Create the entry. Requires an account (KD5); the sign-in gate lives at
   * this moment, not in front of the form.
   */
  const submitEntry = useCallback(
    (input: SubmitPoolEntryInput): Promise<PoolEntrySubmitOutcome> =>
      runWrite(
        "create",
        async (ref, ownerUid) => {
          const payload = buildPoolEntryPayload({
            uid: ownerUid,
            pool: input.pool,
            picks: input.picks,
            handle: input.handle,
            propBets: input.propBets,
            timestamp: serverTimestamp,
          });
          await setDoc(ref, payload);
        },
        { status: "created" },
      ),
    [runWrite],
  );

  /**
   * Revise the whole entry before the freeze (R7).
   *
   * `updateDoc`, not `setDoc`: the payload omits `created_at` and an update
   * leaves a key it was not given alone, which is the only shape the rules
   * accept. A full overwrite re-stamps `created_at` and is denied.
   */
  const updateEntry = useCallback(
    (input: SubmitPoolEntryInput): Promise<PoolEntrySubmitOutcome> =>
      runWrite(
        "update",
        async (ref, ownerUid) => {
          const payload = buildPoolEntryUpdatePayload({
            uid: ownerUid,
            pool: input.pool,
            picks: input.picks,
            handle: input.handle,
            propBets: input.propBets,
            timestamp: serverTimestamp,
          });
          await updateDoc(ref, payload);
        },
        { status: "saved" },
      ),
    [runWrite],
  );

  /**
   * Change the handle, before or after the freeze (R5, R9).
   *
   * Exactly two keys reach the server. The rules reject the same write the
   * moment a pick change rides along (AE6), and reject it outright while the
   * kill switch is thrown, so a denial here is expected rather than a bug.
   */
  const updateHandle = useCallback(
    (handle: string): Promise<PoolEntrySubmitOutcome> =>
      runWrite(
        "handle",
        async (ref) => {
          const payload = buildPoolHandleUpdatePayload({
            handle,
            timestamp: serverTimestamp,
          });
          await updateDoc(ref, payload);
        },
        { status: "saved" },
      ),
    [runWrite],
  );

  /** Take the entry back. Owner only, and never after the freeze (R7, R9). */
  const withdrawEntry = useCallback(
    (): Promise<PoolEntrySubmitOutcome> =>
      runWrite(
        "withdraw",
        async (ref) => {
          await deleteDoc(ref);
        },
        { status: "saved" },
      ),
    [runWrite],
  );

  return {
    entry,
    hasEntry: entry !== undefined,
    isLoading: !loaded,
    submitEntry,
    updateEntry,
    updateHandle,
    withdrawEntry,
  };
};
