import { describe, expect, it } from "vitest";
import {
  getRecentDrafts,
  MAX_RECENT_DRAFTS,
  recordRecentDraft,
  removeRecentDraft,
  type RecentDraftsStorage,
} from "../recentDrafts";

const USER_A = "uid_a";
const USER_B = "uid_b";
const storageKey = (uid: string) => `survivor_recent_drafts:${uid}`;

const createStorage = (): RecentDraftsStorage => {
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

const record = (n: number) => ({
  draftId: `draft_${n}` as const,
  seasonId: `season_${n}` as const,
  seasonNum: n,
});

describe("recentDrafts", () => {
  it("records and returns drafts, most-recent first", () => {
    const storage = createStorage();
    recordRecentDraft(USER_A, record(1), { storage, now: () => 100 });
    recordRecentDraft(USER_A, record(2), { storage, now: () => 200 });

    expect(getRecentDrafts(USER_A, { storage })).toEqual([
      { ...record(2), visitedAt: 200 },
      { ...record(1), visitedAt: 100 },
    ]);
  });

  it("upserts by draftId: updates visitedAt and moves to front", () => {
    const storage = createStorage();
    recordRecentDraft(USER_A, record(1), { storage, now: () => 100 });
    recordRecentDraft(USER_A, record(2), { storage, now: () => 200 });
    recordRecentDraft(USER_A, record(1), { storage, now: () => 300 });

    const drafts = getRecentDrafts(USER_A, { storage });
    expect(drafts).toEqual([
      { ...record(1), visitedAt: 300 },
      { ...record(2), visitedAt: 200 },
    ]);
    expect(drafts).toHaveLength(2);
  });

  it("caps the list, evicting the oldest", () => {
    const storage = createStorage();
    for (let i = 1; i <= MAX_RECENT_DRAFTS + 2; i++) {
      recordRecentDraft(USER_A, record(i), { storage, now: () => i });
    }

    const drafts = getRecentDrafts(USER_A, { storage });
    expect(drafts).toHaveLength(MAX_RECENT_DRAFTS);
    expect(drafts[0].draftId).toBe(`draft_${MAX_RECENT_DRAFTS + 2}`);
    expect(drafts.some((d) => d.draftId === "draft_1")).toBe(false);
  });

  it("removeRecentDraft removes only the target", () => {
    const storage = createStorage();
    recordRecentDraft(USER_A, record(1), { storage });
    recordRecentDraft(USER_A, record(2), { storage });
    removeRecentDraft(USER_A, "draft_1", { storage });

    expect(getRecentDrafts(USER_A, { storage }).map((d) => d.draftId)).toEqual([
      "draft_2",
    ]);
  });

  it("keeps each signed-in user's recent drafts separate", () => {
    const storage = createStorage();
    recordRecentDraft(USER_A, record(1), { storage, now: () => 100 });
    recordRecentDraft(USER_B, record(2), { storage, now: () => 200 });

    expect(getRecentDrafts(USER_A, { storage })).toEqual([
      { ...record(1), visitedAt: 100 },
    ]);
    expect(getRecentDrafts(USER_B, { storage })).toEqual([
      { ...record(2), visitedAt: 200 },
    ]);
  });

  it("reads malformed JSON as empty without throwing", () => {
    const storage = createStorage();
    storage.setItem(storageKey(USER_A), "not json");
    expect(getRecentDrafts(USER_A, { storage })).toEqual([]);
    expect(storage.getItem(storageKey(USER_A))).toBeNull();
  });

  it("reads a wrong version as empty", () => {
    const storage = createStorage();
    storage.setItem(
      storageKey(USER_A),
      JSON.stringify({ version: 99, records: [record(1)] }),
    );
    expect(getRecentDrafts(USER_A, { storage })).toEqual([]);
  });

  it("discards records with invalid IDs on read", () => {
    const storage = createStorage();
    recordRecentDraft(USER_A, record(1), { storage });
    storage.setItem(
      storageKey(USER_A),
      JSON.stringify({
        version: 1,
        records: [
          { ...record(1), visitedAt: 100 },
          {
            draftId: "https://evil.com",
            seasonId: "season_2",
            seasonNum: 2,
            visitedAt: 50,
          },
          {
            draftId: "draft_3",
            seasonId: "not-a-season",
            seasonNum: 3,
            visitedAt: 40,
          },
        ],
      }),
    );

    expect(getRecentDrafts(USER_A, { storage }).map((d) => d.draftId)).toEqual([
      "draft_1",
    ]);
  });

  it("sanitizes malformed records before record and remove mutations", () => {
    const storage = createStorage();
    storage.setItem(
      storageKey(USER_A),
      JSON.stringify({ version: 1, records: [null] }),
    );

    expect(() =>
      recordRecentDraft(USER_A, record(1), { storage, now: () => 100 }),
    ).not.toThrow();
    expect(getRecentDrafts(USER_A, { storage })).toEqual([
      { ...record(1), visitedAt: 100 },
    ]);

    storage.setItem(
      storageKey(USER_A),
      JSON.stringify({
        version: 1,
        records: [null, { ...record(1), visitedAt: 100 }],
      }),
    );
    expect(() =>
      removeRecentDraft(USER_A, "draft_1", { storage }),
    ).not.toThrow();
    expect(getRecentDrafts(USER_A, { storage })).toEqual([]);
  });

  it("does not throw when storage reads and writes are restricted", () => {
    const storage: RecentDraftsStorage = {
      getItem: () => {
        throw new DOMException("access denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("access denied", "SecurityError");
      },
    };

    expect(getRecentDrafts(USER_A, { storage })).toEqual([]);
    expect(() =>
      recordRecentDraft(USER_A, record(1), { storage }),
    ).not.toThrow();
    expect(() =>
      removeRecentDraft(USER_A, "draft_1", { storage }),
    ).not.toThrow();
  });

  it("works without window.localStorage via the memory fallback", () => {
    recordRecentDraft(USER_A, record(1), { now: () => 100 });
    expect(getRecentDrafts(USER_A).map((d) => d.draftId)).toEqual(["draft_1"]);
    removeRecentDraft(USER_A, "draft_1");
    expect(getRecentDrafts(USER_A)).toEqual([]);
  });
});
