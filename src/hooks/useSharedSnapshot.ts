import {
  doc,
  DocumentData,
  FirestoreErrorCode,
  onSnapshot,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { useUser } from "./useUser";

export interface SharedSnapshotState {
  data: DocumentData | undefined;
  loaded: boolean;
  /**
   * True when the latest snapshot came from the local cache rather than the
   * server. A missing document in a cache-only snapshot is unconfirmed: the
   * SDK emits one when it cannot reach Firestore.
   */
  fromCache: boolean;
  /** Firestore error code once the listener has failed; it stays failed. */
  error: FirestoreErrorCode | undefined;
}

type Listener = (state: SharedSnapshotState) => void;

interface CacheEntry extends SharedSnapshotState {
  collection: string;
  docId: string;
  unsub: () => void;
  refCount: number;
  listeners: Set<Listener>;
}

const cache = new Map<string, CacheEntry>();

const INITIAL: SharedSnapshotState = {
  data: undefined,
  loaded: false,
  fromCache: false,
  error: undefined,
};

const stateOf = ({
  data,
  loaded,
  fromCache,
  error,
}: CacheEntry): SharedSnapshotState => ({ data, loaded, fromCache, error });

const notify = (path: string, entry: CacheEntry) => {
  const state = stateOf(entry);
  for (const l of entry.listeners) {
    try {
      l(state);
    } catch (e) {
      console.error(`useSharedSnapshot(${path}): listener error`, e);
    }
  }
};

const listen = (path: string, entry: CacheEntry) => {
  entry.unsub = onSnapshot(
    doc(db, entry.collection, entry.docId),
    (snap) => {
      entry.data = snap.data();
      entry.loaded = true;
      entry.fromCache = snap.metadata.fromCache;
      entry.error = undefined;
      notify(path, entry);
    },
    (error) => {
      console.error(`useSharedSnapshot(${path}): onSnapshot error`, error);
      entry.loaded = true;
      entry.error = error.code;
      notify(path, entry);
    },
  );
};

/**
 * Joins the shared listener for `path`, opening it if this is the first
 * subscriber. Returns the release function.
 */
export function subscribeSharedSnapshot(
  path: string,
  collection: string,
  docId: string,
  listener: Listener,
): () => void {
  let entry = cache.get(path);
  if (entry) {
    entry.refCount++;
    entry.listeners.add(listener);
    if (entry.loaded) listener(stateOf(entry));
  } else {
    entry = {
      ...INITIAL,
      collection,
      docId,
      unsub: () => {},
      refCount: 1,
      listeners: new Set([listener]),
    };
    cache.set(path, entry);
    listen(path, entry);
  }
  const subscribed = entry;
  return () => {
    subscribed.listeners.delete(listener);
    subscribed.refCount--;
    if (subscribed.refCount <= 0) {
      subscribed.unsub();
      if (cache.get(path) === subscribed) cache.delete(path);
    }
  };
}

/**
 * Shared Firestore document snapshot hook.
 *
 * Multiple components calling this with the same `collection/docId` path
 * share a single `onSnapshot` listener. The subscription is ref-counted
 * and closed when all subscribers unmount.
 *
 * Returns raw `snap.data()` result — `undefined` until the first snapshot
 * arrives, then the document data (or `undefined` if the document doesn't
 * exist). `loaded` becomes `true` after the first snapshot or error, and `error`
 * carries the Firestore error code. A failed listener is not reopened.
 *
 * Subscriptions wait for Firebase Auth to resolve and are keyed by the
 * signed-in user. Security rules are evaluated per user, and a listener that
 * is denied (or whose user signs out) is terminated by the SDK and never
 * recovers, so signing in or out must open a fresh listener rather than
 * reuse the dead one.
 */
export function useSharedSnapshot(
  collection: string,
  docId: string | undefined,
): SharedSnapshotState {
  const { user, isAuthReady } = useUser();
  const uid = user?.uid ?? "anonymous";
  const path =
    docId && isAuthReady ? `${uid}:${collection}/${docId}` : undefined;

  const [state, setState] = useState<SharedSnapshotState>(() => {
    const entry = path ? cache.get(path) : undefined;
    return entry?.loaded ? stateOf(entry) : INITIAL;
  });

  useEffect(() => {
    if (!path) return;
    return subscribeSharedSnapshot(path, collection, docId!, setState);
  }, [path, collection, docId]);

  return state;
}
