import type { PoolId, PoolPick, PropBetsFormData } from "../types";

/**
 * The autosave seam (U13).
 *
 * The entry page must let a signed-out visitor fill in an entry, sign in, and
 * come back to it (R18, AE1). Exactly one browser-local copy of the
 * in-progress entry exists, and this is the interface to it. The `enter-pool`
 * auth intent deliberately carries only a pool id and a `resume` marker, and
 * that marker is `hasPoolEntryDraft()` at the moment the intent is saved.
 *
 * U13 owns the storage implementation (`src/utils/poolDraftStorage.ts`,
 * following `src/utils/recentDrafts.ts` including its try/catch fallback to
 * memory). Until it lands, the default store below is an in-memory one, so the
 * page behaves correctly within a session and simply does not survive a
 * reload. U13 replaces the default by calling `setPoolEntryDraftStore` once at
 * module load; no call site on the page changes.
 */

export type PoolEntryDraft = {
  pool_id: PoolId;
  picks: PoolPick[];
  handle: string;
  prop_bets: PropBetsFormData;
  /** Milliseconds since the epoch, for U13's own staleness policy. */
  saved_at: number;
};

export interface PoolEntryDraftStore {
  load(poolId: PoolId): PoolEntryDraft | null;
  save(draft: PoolEntryDraft): void;
  clear(poolId: PoolId): void;
}

/**
 * Session-lifetime fallback. Not persistence: it survives a route change and
 * the account-entry modal, and nothing else.
 */
const createMemoryStore = (): PoolEntryDraftStore => {
  const drafts = new Map<PoolId, PoolEntryDraft>();
  return {
    load: (poolId) => drafts.get(poolId) ?? null,
    save: (draft) => {
      drafts.set(draft.pool_id, draft);
    },
    clear: (poolId) => {
      drafts.delete(poolId);
    },
  };
};

let store: PoolEntryDraftStore = createMemoryStore();

/** U13's single wiring point. */
export const setPoolEntryDraftStore = (next: PoolEntryDraftStore): void => {
  store = next;
};

export const loadPoolEntryDraft = (poolId: PoolId): PoolEntryDraft | null =>
  store.load(poolId);

export const savePoolEntryDraft = (draft: PoolEntryDraft): void => {
  store.save(draft);
};

export const clearPoolEntryDraft = (poolId: PoolId): void => {
  store.clear(poolId);
};

/** What the `enter-pool` intent's `resume` marker is set from. */
export const hasPoolEntryDraft = (poolId: PoolId): boolean =>
  store.load(poolId) !== null;
