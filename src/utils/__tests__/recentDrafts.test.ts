import { describe, expect, it } from "vitest";
import {
  getRecentDrafts,
  MAX_RECENT_DRAFTS,
  recordRecentDraft,
  removeRecentDraft,
  type RecentDraftsStorage,
} from "../recentDrafts";

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
    recordRecentDraft(record(1), { storage, now: () => 100 });
    recordRecentDraft(record(2), { storage, now: () => 200 });

    expect(getRecentDrafts({ storage })).toEqual([
      { ...record(2), visitedAt: 200 },
      { ...record(1), visitedAt: 100 },
    ]);
  });

  it("upserts by draftId: updates visitedAt and moves to front", () => {
    const storage = createStorage();
    recordRecentDraft(record(1), { storage, now: () => 100 });
    recordRecentDraft(record(2), { storage, now: () => 200 });
    recordRecentDraft(record(1), { storage, now: () => 300 });

    const drafts = getRecentDrafts({ storage });
    expect(drafts).toEqual([
      { ...record(1), visitedAt: 300 },
      { ...record(2), visitedAt: 200 },
    ]);
    expect(drafts).toHaveLength(2);
  });

  it("caps the list, evicting the oldest", () => {
    const storage = createStorage();
    for (let i = 1; i <= MAX_RECENT_DRAFTS + 2; i++) {
      recordRecentDraft(record(i), { storage, now: () => i });
    }

    const drafts = getRecentDrafts({ storage });
    expect(drafts).toHaveLength(MAX_RECENT_DRAFTS);
    expect(drafts[0].draftId).toBe(`draft_${MAX_RECENT_DRAFTS + 2}`);
    expect(drafts.some((d) => d.draftId === "draft_1")).toBe(false);
  });

  it("removeRecentDraft removes only the target", () => {
    const storage = createStorage();
    recordRecentDraft(record(1), { storage });
    recordRecentDraft(record(2), { storage });
    removeRecentDraft("draft_1", { storage });

    expect(getRecentDrafts({ storage }).map((d) => d.draftId)).toEqual([
      "draft_2",
    ]);
  });

  it("reads malformed JSON as empty without throwing", () => {
    const storage = createStorage();
    storage.setItem("survivor_recent_drafts", "not json");
    expect(getRecentDrafts({ storage })).toEqual([]);
    expect(storage.getItem("survivor_recent_drafts")).toBeNull();
  });

  it("reads a wrong version as empty", () => {
    const storage = createStorage();
    storage.setItem(
      "survivor_recent_drafts",
      JSON.stringify({ version: 99, records: [record(1)] }),
    );
    expect(getRecentDrafts({ storage })).toEqual([]);
  });

  it("discards records with invalid IDs on read", () => {
    const storage = createStorage();
    recordRecentDraft(record(1), { storage });
    storage.setItem(
      "survivor_recent_drafts",
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

    expect(getRecentDrafts({ storage }).map((d) => d.draftId)).toEqual([
      "draft_1",
    ]);
  });

  it("works without window.localStorage via the memory fallback", () => {
    recordRecentDraft(record(1), { now: () => 100 });
    expect(getRecentDrafts().map((d) => d.draftId)).toEqual(["draft_1"]);
    removeRecentDraft("draft_1");
    expect(getRecentDrafts()).toEqual([]);
  });
});
