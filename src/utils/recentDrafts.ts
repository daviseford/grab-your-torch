import type { Draft, Season, SlimUser } from "../types";

/**
 * Recent drafts the signed-in user participates in (browser-local only).
 *
 * Clients cannot list `/drafts` in RTDB (rules only allow per-draft reads),
 * so this is how the Home page can offer a way back into a lobby or live
 * draft after a player accidentally navigates away. Records are written when
 * a participant visits a draft, capped, and pruned when the draft finishes
 * or is deleted. All payloads are validated on read so malformed or stale
 * data degrades to an empty list.
 */

export type RecentDraftRecord = {
  draftId: Draft["id"];
  seasonId: Season["id"];
  seasonNum: number;
  visitedAt: number;
};

/** Minimal Storage-shaped boundary; injectable for deterministic tests. */
export interface RecentDraftsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecentDraftsOptions {
  storage?: RecentDraftsStorage;
  now?: () => number;
}

export const MAX_RECENT_DRAFTS = 5;

const STORAGE_KEY_PREFIX = "survivor_recent_drafts";
const STORAGE_VERSION = 1;

const SEASON_ID_PATTERN = /^season_\d+$/;
const DRAFT_ID_PATTERN = /^draft_[A-Za-z0-9_-]+$/;

type StoredFile = {
  version: typeof STORAGE_VERSION;
  records: RecentDraftRecord[];
};

let fallbackStorage: RecentDraftsStorage | null = null;

const createMemoryStorage = (): RecentDraftsStorage => {
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
const resolveStorage = (storage?: RecentDraftsStorage): RecentDraftsStorage => {
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

const storageKeyForUser = (userUid: SlimUser["uid"]): string =>
  `${STORAGE_KEY_PREFIX}:${userUid}`;

const isValidRecord = (value: unknown): value is RecentDraftRecord => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.draftId === "string" &&
    DRAFT_ID_PATTERN.test(candidate.draftId) &&
    typeof candidate.seasonId === "string" &&
    SEASON_ID_PATTERN.test(candidate.seasonId) &&
    typeof candidate.seasonNum === "number" &&
    typeof candidate.visitedAt === "number"
  );
};

const writeFile = (
  storage: RecentDraftsStorage,
  storageKey: string,
  file: StoredFile,
): void => {
  // Same constraint as authIntent: private-mode/quota write failures must
  // never throw into page lifecycle effects; a failed write is a no-op.
  try {
    if (file.records.length === 0) {
      storage.removeItem(storageKey);
      return;
    }
    storage.setItem(storageKey, JSON.stringify(file));
  } catch {
    // Storage write failed (QuotaExceededError, restricted storage); ignore.
  }
};

const readFile = (
  storage: RecentDraftsStorage,
  storageKey: string,
): StoredFile => {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return { version: STORAGE_VERSION, records: [] };
  }
  if (raw === null) return { version: STORAGE_VERSION, records: [] };

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as StoredFile).version === STORAGE_VERSION &&
      Array.isArray((parsed as StoredFile).records)
    ) {
      const records = (parsed as StoredFile).records.filter(isValidRecord);
      if (records.length !== (parsed as StoredFile).records.length) {
        writeFile(storage, storageKey, { version: STORAGE_VERSION, records });
      }
      return { version: STORAGE_VERSION, records };
    }
  } catch {
    // Malformed payload; discard below.
  }
  writeFile(storage, storageKey, { version: STORAGE_VERSION, records: [] });
  return { version: STORAGE_VERSION, records: [] };
};

/**
 * Record that the user visited a draft they participate in. Upserts by
 * `draftId`, keeps the list most-recent first, and caps it at
 * MAX_RECENT_DRAFTS entries.
 */
export const recordRecentDraft = (
  userUid: SlimUser["uid"],
  record: Omit<RecentDraftRecord, "visitedAt">,
  options: RecentDraftsOptions = {},
): void => {
  const storage = resolveStorage(options.storage);
  const storageKey = storageKeyForUser(userUid);
  const now = resolveNow(options.now);
  const file = readFile(storage, storageKey);
  const records = file.records.filter(
    (existing) => existing.draftId !== record.draftId,
  );
  records.unshift({ ...record, visitedAt: now() });
  writeFile(storage, storageKey, {
    version: STORAGE_VERSION,
    records: records.slice(0, MAX_RECENT_DRAFTS),
  });
};

/**
 * Return stored records, most-recent first. Malformed entries are discarded
 * from storage; a malformed payload reads as empty.
 */
export const getRecentDrafts = (
  userUid: SlimUser["uid"],
  options: RecentDraftsOptions = {},
): RecentDraftRecord[] => {
  const storage = resolveStorage(options.storage);
  return readFile(storage, storageKeyForUser(userUid)).records;
};

/** Remove a single record (e.g. the draft finished or was deleted). */
export const removeRecentDraft = (
  userUid: SlimUser["uid"],
  draftId: Draft["id"],
  options: RecentDraftsOptions = {},
): void => {
  const storage = resolveStorage(options.storage);
  const storageKey = storageKeyForUser(userUid);
  const file = readFile(storage, storageKey);
  const records = file.records.filter(
    (existing) => existing.draftId !== draftId,
  );
  if (records.length !== file.records.length) {
    writeFile(storage, storageKey, { version: STORAGE_VERSION, records });
  }
};
