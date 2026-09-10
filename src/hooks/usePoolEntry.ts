import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type FirestoreError,
} from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import { db } from "../firebase";
import type { PoolEntry, PoolId, PoolPick, PropBetsFormData } from "../types";
import {
  buildPoolEntryPayload,
  PoolEntryPayloadError,
  type PoolEntryPayloadPool,
} from "../utils/poolEntryPayload";
import { useUser } from "./useUser";

/**
 * The entrant's own entry document.
 *
 * `pools/{poolId}/entries/{uid}` is readable ONLY by its owner, before and
 * after the freeze (KTD6, AE5). A `list` of the entries collection is denied
 * outright, so this is a single-document listener and never a query: a `where`
 * clause here would fail rather than return fewer rows.
 *
 * Editing and withdrawal are U5's unit. The seam is deliberate: this hook owns
 * the subscription and the create path, and `updateEntry` / `withdrawEntry`
 * belong beside `submitEntry` with the same outcome shape.
 */

export type PoolEntrySubmitOutcome =
  | { status: "created" }
  /**
   * The write can never succeed as written: the freeze has passed, the kill
   * switch is thrown, or the payload is not one the rules accept. Mirrors the
   * `invalid` result in `useAuthContinuation`: never retried.
   */
  | { status: "denied"; message: string }
  /** Transient. The entered picks stay on screen and a retry is offered. */
  | { status: "failed"; message: string };

export type SubmitPoolEntryInput = {
  pool: PoolEntryPayloadPool;
  picks: readonly PoolPick[];
  handle: string;
  propBets: PropBetsFormData;
};

const CLOSED_MESSAGE =
  "This pool has closed, so your entry was not saved. Your picks are still on screen.";

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
        console.error(`usePoolEntry(${poolId}/${uid}): onSnapshot error`, error);
        setLoaded(true);
      },
    );
    return unsubscribe;
  }, [poolId, uid, isAuthReady]);

  /**
   * Create the entry. Requires an account (KD5); the sign-in gate lives at
   * this moment, not in front of the form.
   */
  const submitEntry = useCallback(
    async ({
      pool,
      picks,
      handle,
      propBets,
    }: SubmitPoolEntryInput): Promise<PoolEntrySubmitOutcome> => {
      if (!poolId || !uid) {
        return {
          status: "failed",
          message: "Sign in to submit your entry.",
        };
      }
      let payload;
      try {
        payload = buildPoolEntryPayload({
          uid,
          pool,
          picks,
          handle,
          propBets,
          timestamp: serverTimestamp,
        });
      } catch (error) {
        if (error instanceof PoolEntryPayloadError) {
          return { status: "denied", message: error.message };
        }
        throw error;
      }

      try {
        await setDoc(doc(db, "pools", poolId, "entries", uid), payload);
        return { status: "created" };
      } catch (error) {
        const code = (error as FirestoreError)?.code;
        if (code === "permission-denied") {
          // The freeze and the kill switch are enforced by rules, not by this
          // page (R10), so a denial here is the boundary talking. Terminal.
          return { status: "denied", message: CLOSED_MESSAGE };
        }
        console.error(`usePoolEntry(${poolId}): submit failed`, error);
        return {
          status: "failed",
          message:
            "We could not save your entry. Check your connection and try again.",
        };
      }
    },
    [poolId, uid],
  );

  return {
    entry,
    hasEntry: entry !== undefined,
    isLoading: !loaded,
    submitEntry,
  };
};
