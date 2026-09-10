import { SCORING_REVISION } from "../data/scoringRevision.generated";
import type { PoolId, PoolStandings } from "../types";
import { poolStandingsDocId } from "./poolStandingsRead";

/**
 * The browser-local copy of a published standings summary.
 *
 * Why this exists: the homepage is the first surface in this product whose
 * read volume scales with public traffic rather than with signed-in users. A
 * returning visitor who already holds the current episode issues no read at
 * all, which is the cheapest possible answer to a traffic spike.
 *
 * Only the summary document is stored. Overflow pages are fetched on expand,
 * which is rare, and caching them would put hundreds of kilobytes into a
 * storage area that throws when it fills.
 *
 * INVALIDATION is by key, not by expiry:
 *
 *  - the episode is in the key, so the moment the recompute job flips
 *    `latest_episode_num` on the config the old entry is unreachable and one
 *    read is issued;
 *  - the scoring revision is in the key, so a deploy that changes a point
 *    value or a derivation makes every stored entry unreachable, and the
 *    visitor picks up whatever the job has published since;
 *  - the stored stamp is checked against the key on read, so a hand-edited or
 *    half-written payload reads as a miss rather than as one episode's rows
 *    labelled with another's.
 *
 * The season-data revision is deliberately NOT in the key. It lives on the
 * season document, which this path never reads (R22); see the header of
 * `poolStandingsRead.ts` for that decision in full.
 *
 * Storage access follows `recentDrafts.ts`, including its fallback to memory:
 * every read and write is wrapped, because `localStorage` throws outright in
 * some privacy modes and a public leaderboard must not be able to take the
 * homepage down with it.
 */

/** Minimal Storage-shaped boundary; injectable for deterministic tests. */
export interface PoolStandingsCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PoolStandingsCacheOptions {
  storage?: PoolStandingsCacheStorage;
  /** Defaults to the bundled `SCORING_REVISION`. */
  scoringRevision?: string;
  /**
   * The config's `standings_computed_at`. Part of the key, so a republish of
   * the same episode misses instead of serving superseded rows.
   */
  publishedAt?: string;
}

const STORAGE_KEY_PREFIX = "gyt_pool_standings";
const STORAGE_VERSION = 1;

type StoredFile = {
  version: typeof STORAGE_VERSION;
  summary: PoolStandings;
};

let fallbackStorage: PoolStandingsCacheStorage | null = null;

const createMemoryStorage = (): PoolStandingsCacheStorage => {
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

const resolveStorage = (
  storage?: PoolStandingsCacheStorage,
): PoolStandingsCacheStorage => {
  if (storage) return storage;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access itself can throw in restricted contexts; fall through.
  }
  fallbackStorage ??= createMemoryStorage();
  return fallbackStorage;
};

/**
 * `gyt_pool_standings:v1:{poolId}:{episodeId}:{scoringRevision}:{publishedAt}`.
 *
 * The episode, the scoring revision and the publish stamp are all in the key
 * rather than only in the payload, so an advance in any of them is a miss
 * rather than a comparison somebody has to remember to write.
 *
 * The publish stamp is what catches a correction. Recomputing the same
 * episode changes neither the episode number nor the scoring revision, so
 * without it a returning visitor would keep the superseded rows for as long
 * as their storage survived.
 */
export const poolStandingsCacheKey = (
  poolId: PoolId | string,
  episodeNum: number,
  scoringRevision: string,
  publishedAt?: string,
): string =>
  `${STORAGE_KEY_PREFIX}:v${STORAGE_VERSION}:${poolId}:${poolStandingsDocId(
    episodeNum,
  )}:${scoringRevision}:${publishedAt ?? "unstamped"}`;

const isStoredFile = (value: unknown): value is StoredFile => {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  if (file.version !== STORAGE_VERSION) return false;
  const summary = file.summary;
  if (typeof summary !== "object" || summary === null) return false;
  const candidate = summary as Record<string, unknown>;
  return (
    typeof candidate.episode_num === "number" &&
    typeof candidate.computed_at === "string" &&
    typeof candidate.data_revision === "string" &&
    typeof candidate.scoring_revision === "string" &&
    typeof candidate.entry_count === "number" &&
    Array.isArray(candidate.rows)
  );
};

/**
 * The stored summary for this pool and episode, or undefined for any reason
 * at all. A miss costs one read; trusting a bad payload costs a wrong public
 * leaderboard, so every doubt resolves to a miss.
 */
export const readPoolStandingsCache = (
  poolId: PoolId | string,
  episodeNum: number,
  options: PoolStandingsCacheOptions = {},
): PoolStandings | undefined => {
  const storage = resolveStorage(options.storage);
  const scoringRevision = options.scoringRevision ?? SCORING_REVISION;
  const key = poolStandingsCacheKey(
    poolId,
    episodeNum,
    scoringRevision,
    options.publishedAt,
  );

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    discard(storage, key);
    return undefined;
  }

  if (!isStoredFile(parsed)) {
    discard(storage, key);
    return undefined;
  }

  // The key says which episode and which scoring revision this is meant to
  // be. If the payload disagrees, it was not written by this code.
  const { summary } = parsed;
  if (
    summary.episode_num !== episodeNum ||
    summary.scoring_revision !== scoringRevision
  ) {
    discard(storage, key);
    return undefined;
  }

  return summary;
};

const discard = (storage: PoolStandingsCacheStorage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to do: the entry stays and reads as a miss again next time.
  }
};

/** Store a fetched summary. A failed write is a no-op, never a thrown error. */
export const writePoolStandingsCache = (
  poolId: PoolId | string,
  episodeNum: number,
  summary: PoolStandings,
  options: PoolStandingsCacheOptions = {},
): void => {
  const storage = resolveStorage(options.storage);
  const scoringRevision = options.scoringRevision ?? SCORING_REVISION;
  const file: StoredFile = { version: STORAGE_VERSION, summary };
  try {
    storage.setItem(
      poolStandingsCacheKey(
        poolId,
        episodeNum,
        scoringRevision,
        options.publishedAt,
      ),
      JSON.stringify(file),
    );
  } catch {
    // QuotaExceededError or restricted storage. The next visit reads again.
  }
};

/** Drop one entry. */
export const clearPoolStandingsCache = (
  poolId: PoolId | string,
  episodeNum: number,
  options: PoolStandingsCacheOptions = {},
): void => {
  const storage = resolveStorage(options.storage);
  const scoringRevision = options.scoringRevision ?? SCORING_REVISION;
  discard(
    storage,
    poolStandingsCacheKey(
      poolId,
      episodeNum,
      scoringRevision,
      options.publishedAt,
    ),
  );
};
