import type { Pool, PoolId, PoolPick } from "../types";
import {
  clearPoolEntryDraft,
  loadPoolEntryDraft,
  setPoolEntryDraftStore,
  type PoolEntryDraft,
  type PoolEntryDraftStore,
} from "./poolEntryDraft";
import { POOL_HANDLE_MAX } from "./poolHandle";
import { isPoolPickSelected } from "./poolPicks";

/**
 * The entry autosave, in browser-local storage (U13).
 *
 * `poolEntryDraft.ts` is the seam the entry page calls; this module is the
 * implementation behind it, and importing it is what makes an in-progress
 * entry survive a reload instead of only a route change. There is exactly ONE
 * browser-local copy of an in-progress entry, and it is this one: the
 * `enter-pool` auth intent deliberately carries a pool id and a resume marker
 * and nothing else, so there is never a second copy to reconcile.
 *
 * TWO THINGS THIS MODULE OWES THE ENTRY FORM
 * ------------------------------------------
 * 1. Nothing it does may throw. Every call site is a render effect, a click
 *    handler, or a sign-out, and private-browsing and quota failures are
 *    normal. A failed read is "no draft"; a failed write is a no-op. Following
 *    `recentDrafts.ts`, an inaccessible localStorage falls back to a shared
 *    in-memory store, so the page still behaves correctly within a session.
 *
 * 2. Everything it hands back is validated first, twice. Browser-local storage
 *    is writable by anything running on this origin, and a restored draft
 *    flows straight into a form the entrant then submits, so a tampered draft
 *    would be submitted under their name. `load()` validates the stored shape;
 *    `validatePoolEntryDraftForPool()` then validates the content against the
 *    pool configuration that is in hand at restore time. An invalid draft is
 *    dropped whole, never partially repaired: an entry the entrant did not
 *    choose is worse than an empty form, because they would submit it without
 *    noticing.
 *
 * The content checks deliberately mirror what the submit path
 * (`poolEntryPayload.ts`) and `firestore.rules` already enforce, rather than
 * inventing a second rule set. The difference is only that a draft is allowed
 * to be UNFINISHED: fewer picks than the limit, a half-typed handle, and
 * unanswered prop bets are all normal mid-entry states, so the restore check
 * bounds what a draft may contain without requiring it to be complete.
 */

/** Minimal Storage-shaped boundary; injectable for deterministic tests. */
export interface PoolDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PoolDraftStorageOptions {
  storage?: PoolDraftStorage;
  now?: () => number;
}

/** What the pool configuration must supply to validate a restored draft. */
export type PoolEntryDraftPool = Pick<
  Pool,
  "id" | "roster" | "picks_per_entry" | "prop_bet_keys"
>;

/**
 * Distinct from `survivor_auth_intents` and `survivor_recent_drafts`: each of
 * those owns its own key, and a shared key would make one feature's cleanup
 * another feature's data loss. One key holds every pool's draft rather than a
 * key per pool, because sign-out has to erase all of them without being able
 * to enumerate which pools this browser has seen.
 */
export const POOL_ENTRY_DRAFT_STORAGE_KEY = "survivor_pool_entry_drafts";

const STORAGE_VERSION = 1;

/**
 * How long an abandoned entry may sit in a browser (30 days).
 *
 * This is hygiene, not correctness: drafts are keyed by pool id, so next
 * season's pool can never read this season's draft, and the content check
 * below drops anything whose picks no longer match the pool's cast. The window
 * exists because a shared or public machine should not keep someone's entry
 * indefinitely, and 30 days comfortably exceeds the days-to-weeks between a
 * pool opening and its season premiering, which is the whole period in which
 * an entry can still be filled in.
 */
export const POOL_ENTRY_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many pools' drafts are kept. More than one because a browser can hold an
 * unfinished entry for a pool while looking at another; bounded because the
 * whole file is rewritten on every keystroke-driven save and localStorage
 * quota is shared with the rest of the app.
 */
export const MAX_POOL_ENTRY_DRAFTS = 3;

/**
 * The longest a prop bet answer can be. Answers are a castaway id or "Yes" /
 * "No" chosen from a Select, so this bounds what a tampered payload can smuggle
 * into a submitted entry without second-guessing the question set.
 */
const PROP_BET_ANSWER_MAX = 64;

const POOL_ID_PATTERN = /^pool_[A-Za-z0-9_-]+$/;
const CASTAWAY_ID_PATTERN = /^US[A-Za-z0-9]+$/;

/**
 * The character class inside `POOL_HANDLE_PATTERN`, applied to the whole
 * string. A draft handle is mid-typing, so it cannot be held to the full
 * pattern: "T" and "Torch " are both legitimate on the way to a valid handle,
 * and rejecting them would discard live work. What it can be held to is the
 * alphabet, which is what keeps a URL, markup, a control character, a
 * zero-width joiner, or a bidi override out of a handle that later lands on a
 * crawlable public leaderboard. Every handle `validatePoolHandle` accepts
 * matches this, and a test beside this module asserts that.
 */
const POOL_HANDLE_CHARACTERS = /^[A-Za-z0-9 _-]*$/;

type StoredFile = {
  version: typeof STORAGE_VERSION;
  drafts: PoolEntryDraft[];
};

const emptyFile = (): StoredFile => ({
  version: STORAGE_VERSION,
  drafts: [],
});

let fallbackStorage: PoolDraftStorage | null = null;

const createMemoryStorage = (): PoolDraftStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

/**
 * Resolve the storage boundary lazily so importing this module never touches
 * browser globals. Uses localStorage when available, otherwise a shared
 * in-memory fallback.
 */
const resolveStorage = (storage?: PoolDraftStorage): PoolDraftStorage => {
  if (storage) return storage;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access to localStorage can throw (privacy modes); fall through.
  }
  fallbackStorage ??= createMemoryStorage();
  return fallbackStorage;
};

const resolveNow = (now?: () => number): (() => number) => now ?? Date.now;

// ---------------------------------------------------------------------------
// Stored-shape validation (no pool configuration needed)
// ---------------------------------------------------------------------------

const isPickShaped = (value: unknown): value is PoolPick => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.castaway_id === "string" &&
    CASTAWAY_ID_PATTERN.test(candidate.castaway_id) &&
    typeof candidate.full_name === "string"
  );
};

const isPropBetsShaped = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (answer) => typeof answer === "string",
  );
};

const isDraftShaped = (value: unknown): value is PoolEntryDraft => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.pool_id === "string" &&
    POOL_ID_PATTERN.test(candidate.pool_id) &&
    Array.isArray(candidate.picks) &&
    candidate.picks.every(isPickShaped) &&
    typeof candidate.handle === "string" &&
    isPropBetsShaped(candidate.prop_bets) &&
    typeof candidate.saved_at === "number" &&
    Number.isFinite(candidate.saved_at)
  );
};

/** A draft older than the retention window is treated as absent. */
const isExpired = (candidate: PoolEntryDraft, now: number): boolean =>
  now - candidate.saved_at >= POOL_ENTRY_DRAFT_TTL_MS;

// ---------------------------------------------------------------------------
// Content validation (needs the pool configuration)
// ---------------------------------------------------------------------------

/**
 * The restored entry, or null when this browser's copy is one the entrant
 * cannot have produced.
 *
 * Called at restore time, when the pool configuration is in hand, because the
 * cast and the question set are what make a pick or an answer legitimate and
 * neither is knowable from the stored bytes alone.
 */
export const validatePoolEntryDraftForPool = (
  candidate: PoolEntryDraft,
  pool: PoolEntryDraftPool,
): PoolEntryDraft | null => {
  if (!isDraftShaped(candidate)) return null;
  if (candidate.pool_id !== pool.id) return null;

  // Picks. The submit path resolves each pick against `pool.roster` and sends
  // the roster's own object, and the rules match the whole `{castaway_id,
  // full_name}` pair, so a name that disagrees with the cast is never
  // something the page produced.
  if (candidate.picks.length > pool.picks_per_entry) return null;
  const seen: PoolPick[] = [];
  for (const pick of candidate.picks) {
    if (isPoolPickSelected(seen, pick.castaway_id)) return null;
    const rosterEntry = pool.roster.find(
      (entry) => entry.castaway_id === pick.castaway_id,
    );
    if (!rosterEntry) return null;
    if (rosterEntry.full_name !== pick.full_name) return null;
    seen.push(pick);
  }

  // Handle. Length and alphabet only: a draft handle is mid-typing.
  if (candidate.handle.length > POOL_HANDLE_MAX) return null;
  if (!POOL_HANDLE_CHARACTERS.test(candidate.handle)) return null;

  // Prop bets. The rules accept only this pool's question keys
  // (`keys().hasOnly(pool.prop_bet_keys)`), so a draft carrying any other key
  // is not an entry this pool could ever hold.
  const allowed = new Set<string>(pool.prop_bet_keys as string[]);
  for (const [key, answer] of Object.entries(candidate.prop_bets)) {
    if (!allowed.has(key)) return null;
    if (typeof answer !== "string") return null;
    if (answer.length > PROP_BET_ANSWER_MAX) return null;
  }

  return candidate;
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const writeFile = (storage: PoolDraftStorage, file: StoredFile): void => {
  // Private-mode and quota write failures must never throw into a render
  // effect or a click handler; a failed write degrades to a no-op and the
  // entry simply is not autosaved.
  try {
    if (file.drafts.length === 0) {
      storage.removeItem(POOL_ENTRY_DRAFT_STORAGE_KEY);
      return;
    }
    storage.setItem(POOL_ENTRY_DRAFT_STORAGE_KEY, JSON.stringify(file));
  } catch {
    // Storage write failed (QuotaExceededError, restricted storage); ignore.
  }
};

const readFile = (storage: PoolDraftStorage, now: number): StoredFile => {
  let raw: string | null;
  try {
    raw = storage.getItem(POOL_ENTRY_DRAFT_STORAGE_KEY);
  } catch {
    return emptyFile();
  }
  if (raw === null) return emptyFile();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as StoredFile).version === STORAGE_VERSION &&
      Array.isArray((parsed as StoredFile).drafts)
    ) {
      const stored = (parsed as StoredFile).drafts;
      const drafts = stored.filter(
        (entry) => isDraftShaped(entry) && !isExpired(entry, now),
      );
      if (drafts.length !== stored.length) {
        // Malformed or expired records are pruned on read, so a rejected
        // draft never waits around for the next restore to consider it.
        writeFile(storage, { version: STORAGE_VERSION, drafts });
      }
      return { version: STORAGE_VERSION, drafts };
    }
  } catch {
    // Malformed payload; discard below.
  }
  writeFile(storage, emptyFile());
  return emptyFile();
};

/**
 * A `PoolEntryDraftStore` backed by browser-local storage. Drafts are kept
 * most-recently-saved first and capped at MAX_POOL_ENTRY_DRAFTS.
 */
export const createPoolEntryDraftStore = (
  options: PoolDraftStorageOptions = {},
): PoolEntryDraftStore => {
  const now = resolveNow(options.now);
  return {
    load: (poolId) => {
      const storage = resolveStorage(options.storage);
      const file = readFile(storage, now());
      return file.drafts.find((entry) => entry.pool_id === poolId) ?? null;
    },
    save: (nextDraft) => {
      const storage = resolveStorage(options.storage);
      const file = readFile(storage, now());
      const drafts = file.drafts.filter(
        (entry) => entry.pool_id !== nextDraft.pool_id,
      );
      drafts.unshift(nextDraft);
      writeFile(storage, {
        version: STORAGE_VERSION,
        drafts: drafts.slice(0, MAX_POOL_ENTRY_DRAFTS),
      });
    },
    clear: (poolId) => {
      const storage = resolveStorage(options.storage);
      const file = readFile(storage, now());
      const drafts = file.drafts.filter((entry) => entry.pool_id !== poolId);
      if (drafts.length !== file.drafts.length) {
        writeFile(storage, { version: STORAGE_VERSION, drafts });
      }
    },
  };
};

/**
 * Restore this browser's in-progress entry for a pool, or null.
 *
 * The one restore path the page uses, for both the first render and the
 * post-sign-in resume, so there is a single answer to what survives. A draft
 * that fails the content check is erased rather than returned: leaving it
 * would mean the next load reconsiders the same rejected entry, and the
 * `resume` marker on a later `enter-pool` intent would still see it.
 */
export const readPoolEntryDraftForPool = (
  poolId: PoolId,
  pool: PoolEntryDraftPool,
  options: { store?: PoolEntryDraftStore } = {},
): PoolEntryDraft | null => {
  const load = options.store
    ? (id: PoolId) => (options.store as PoolEntryDraftStore).load(id)
    : loadPoolEntryDraft;
  const clear = options.store
    ? (id: PoolId) => (options.store as PoolEntryDraftStore).clear(id)
    : clearPoolEntryDraft;

  const stored = load(poolId);
  if (!stored) return null;
  const valid = validatePoolEntryDraftForPool(stored, pool);
  if (!valid) {
    clear(poolId);
    return null;
  }
  return valid;
};

/**
 * Erase every autosaved entry in this browser.
 *
 * Sign-out calls this beside `clearAuthIntents()`. The two have to move
 * together: the intent carries the resume marker and the autosave carries the
 * entry, so clearing one without the other leaves either an orphaned entry
 * that a later visitor's restore would surface, or a marker pointing at
 * nothing.
 */
export const clearAllPoolEntryDrafts = (
  options: Pick<PoolDraftStorageOptions, "storage"> = {},
): void => {
  try {
    resolveStorage(options.storage).removeItem(POOL_ENTRY_DRAFT_STORAGE_KEY);
  } catch {
    // Storage write failed (QuotaExceededError, restricted storage); ignore.
  }
};

/**
 * U13's single wiring point: importing this module replaces U4's session-only
 * default with the storage-backed store. No call site on the entry page
 * changes; it keeps calling `loadPoolEntryDraft` / `savePoolEntryDraft` /
 * `clearPoolEntryDraft` / `hasPoolEntryDraft`.
 */
setPoolEntryDraftStore(createPoolEntryDraftStore());
