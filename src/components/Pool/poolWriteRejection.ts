import type { PoolId } from "../../types";

/**
 * The record of a write the boundary refused, kept until it is explained.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Firestore web SDK queues a write made while offline and replays it on
 * reconnect. The promise does not resolve until the server acknowledges, and
 * the local cache reflects the queued write immediately, so an entrant who
 * submits just before the freeze sees their entry, closes the laptop, and is
 * refused minutes later on reconnect with no form mounted to catch it. Without
 * a record, that refusal is dropped and the entrant believes they are in the
 * pool.
 *
 * WHAT IS RECORDED, AND WHAT DELIBERATELY IS NOT
 * ----------------------------------------------
 * Only a *refusal* is persisted. An in-flight write is not: the default web
 * SDK cache is memory-only, so a write that never reached the server does not
 * survive a reload either, and the entry document read on the next load is
 * then the truth. Persisting a "we are not sure" message that the very next
 * read contradicts is exactly the stale scare this record must not become.
 *
 * The record is cleared by the next server-acknowledged write, a newer server
 * snapshot from another device, or the entrant dismissing it. After the freeze there
 * may be no write left that can succeed, so waiting for an acknowledgement
 * would leave the notice on screen forever.
 *
 * WHY IT IS NOT STORED BESIDE THE ENTRY DRAFT
 * -------------------------------------------
 * `src/utils/poolEntryDraft.ts` holds the in-progress entry and is cleared the
 * moment a create succeeds. This record has the opposite lifecycle: it exists
 * precisely because a write did *not* succeed, and it must outlive the draft,
 * the form, and the page. Sharing that store would tie the two together at the
 * one boundary where they disagree. It is also written from the page rather
 * than from the hook, so a refusal arriving after the component has unmounted
 * still lands: the awaiting async function runs to completion regardless.
 */

export type PoolWriteKind = "create" | "update" | "handle" | "withdraw";

export type PoolWriteRejection = {
  pool_id: PoolId;
  kind: PoolWriteKind;
  /** Milliseconds since the epoch, for ordering and for the on-screen note. */
  at: number;
};

export type PoolWriteEvent =
  /** A write has been sent. Proves nothing yet, so any record stands. */
  | { type: "started"; pool_id: PoolId }
  /** The server accepted a write. The entrant is up to date; clear. */
  | { type: "acknowledged"; pool_id: PoolId }
  /** A server snapshot includes a newer write, possibly from another device. */
  | { type: "observed"; pool_id: PoolId; updated_at: number }
  /** The boundary refused a write. Terminal, and must be surfaced. */
  | { type: "denied"; pool_id: PoolId; kind: PoolWriteKind; at: number }
  /** Transient failure. The live page offers a retry; any record stands. */
  | { type: "failed"; pool_id: PoolId }
  /** The entrant has read the notice. */
  | { type: "dismissed"; pool_id: PoolId };

/** The whole decision, as one pure function. */
export const reducePoolWriteRejection = (
  current: PoolWriteRejection | null,
  event: PoolWriteEvent,
): PoolWriteRejection | null => {
  switch (event.type) {
    case "observed":
      return current?.pool_id === event.pool_id && event.updated_at > current.at
        ? null
        : current;
    case "denied":
      return { pool_id: event.pool_id, kind: event.kind, at: event.at };
    case "acknowledged":
    case "dismissed":
      return null;
    case "started":
    case "failed":
      return current;
  }
};

export type PoolWriteRejectionNotice = {
  /** Short caps label for the Notice component. */
  label: string;
  message: string;
};

/**
 * What a refused write says, in one place.
 *
 * The same sentence has to serve a denial caught by a mounted form and one
 * read back off a record on the next load, so there is exactly one copy of it.
 * Every sentence says what happened to the entry the entrant already has:
 * "not saved" on its own leaves them guessing whether their picks are gone.
 */
export const poolWriteDeniedMessage = (kind: PoolWriteKind): string => {
  switch (kind) {
    case "create":
      return "This pool closed before your entry reached us, so it was not saved. Your picks are still on screen.";
    case "update":
      return "This pool closed before your changes reached us, so your entry is unchanged. Your picks are still on screen.";
    case "handle":
      return "This pool is no longer open, so your new handle was not saved. Your entry is unchanged.";
    case "withdraw":
      return "This pool closed before your withdrawal reached us, so your entry is still in the pool.";
  }
};

const REJECTION_LABEL: Record<PoolWriteKind, string> = {
  create: "Not entered",
  update: "Not saved",
  handle: "Not saved",
  withdraw: "Not withdrawn",
};

/** The recorded rejection as the page renders it. */
export const describePoolWriteRejection = ({
  kind,
}: PoolWriteRejection): PoolWriteRejectionNotice => ({
  label: REJECTION_LABEL[kind],
  message: poolWriteDeniedMessage(kind),
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Minimal Storage-shaped boundary; injectable for deterministic tests. */
export interface PoolWriteRejectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY_PREFIX = "survivor_pool_write_rejection";
const STORAGE_VERSION = 1;

const WRITE_KINDS: readonly PoolWriteKind[] = [
  "create",
  "update",
  "handle",
  "withdraw",
];

let injectedStorage: PoolWriteRejectionStorage | null = null;
let fallbackStorage: PoolWriteRejectionStorage | null = null;

const createMemoryStorage = (): PoolWriteRejectionStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

/**
 * Resolved lazily so importing this module never touches browser globals, and
 * so a private-browsing localStorage that throws on access degrades to memory
 * rather than taking the page down.
 */
const resolveStorage = (): PoolWriteRejectionStorage => {
  if (injectedStorage) return injectedStorage;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Privacy modes can throw on access; fall through to memory.
  }
  fallbackStorage ??= createMemoryStorage();
  return fallbackStorage;
};

/** Test seam. Production never calls this. */
export const setPoolWriteRejectionStorage = (
  storage: PoolWriteRejectionStorage,
): void => {
  injectedStorage = storage;
};

const storageKey = (poolId: PoolId): string =>
  `${STORAGE_KEY_PREFIX}_v${STORAGE_VERSION}:${poolId}`;

const isValidRejection = (
  value: unknown,
  poolId: PoolId,
): value is PoolWriteRejection => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.pool_id === poolId &&
    typeof candidate.kind === "string" &&
    WRITE_KINDS.includes(candidate.kind as PoolWriteKind) &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at)
  );
};

export const loadPoolWriteRejection = (
  poolId: PoolId,
): PoolWriteRejection | null => {
  let raw: string | null;
  try {
    raw = resolveStorage().getItem(storageKey(poolId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidRejection(parsed, poolId)) return null;
    return { pool_id: parsed.pool_id, kind: parsed.kind, at: parsed.at };
  } catch {
    return null;
  }
};

const persist = (poolId: PoolId, next: PoolWriteRejection | null): void => {
  // A storage write that fails (quota, restricted storage) must never throw
  // into a page effect or into the tail of an async write.
  try {
    const storage = resolveStorage();
    if (next === null) storage.removeItem(storageKey(poolId));
    else storage.setItem(storageKey(poolId), JSON.stringify(next));
  } catch {
    // Ignore: the live page still shows the outcome it just received.
  }
};

/**
 * Apply one event and persist the result. This is the single call site the
 * page uses, so the reducer above stays the only place the decision is made.
 */
export const applyPoolWriteEvent = (
  event: PoolWriteEvent,
): PoolWriteRejection | null => {
  const next = reducePoolWriteRejection(
    loadPoolWriteRejection(event.pool_id),
    event,
  );
  persist(event.pool_id, next);
  return next;
};
