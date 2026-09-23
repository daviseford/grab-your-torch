import { afterEach, describe, expect, it, vi } from "vitest";
import type { Competition, Trade } from "../../types";
import {
  isRenderableTrade,
  loadStatsSources,
  pickCurrent,
  type SourceReaders,
} from "../myStatsSources";

const comp = (id: string, season: string) =>
  ({ id, season_id: season }) as Pick<Competition, "id" | "season_id">;

const okReaders = (overrides: Partial<SourceReaders> = {}): SourceReaders => ({
  readDoc: vi.fn(async () => ({ some: "data" })),
  readTrades: vi.fn(async () => [] as Trade[]),
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("loadStatsSources", () => {
  it("reads each distinct season once and each competition's trades once", async () => {
    const readers = okReaders();
    const out = await loadStatsSources(
      [
        comp("competition_1", "season_50"),
        comp("competition_2", "season_50"),
        comp("competition_3", "season_49"),
      ],
      readers,
    );
    // 2 seasons x 4 documents.
    expect(readers.readDoc).toHaveBeenCalledTimes(8);
    expect(readers.readTrades).toHaveBeenCalledTimes(3);
    expect(Object.keys(out.seasons).sort()).toEqual(["season_49", "season_50"]);
    expect(out.seasons.season_50).not.toBeNull();
  });

  it("marks only the broken season unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const readers = okReaders({
      readDoc: async (name, id) => {
        if (id === "season_49" && name === "events") throw new Error("denied");
        return { some: "data" };
      },
    });
    const out = await loadStatsSources(
      [comp("competition_1", "season_50"), comp("competition_3", "season_49")],
      readers,
    );
    expect(out.seasons.season_49).toBeNull();
    expect(out.seasons.season_50).not.toBeNull();
    expect(out.trades.competition_1).toEqual([]);
  });

  it("treats a missing result document as unavailable, not empty", async () => {
    const readers = okReaders({
      readDoc: async (name) => (name === "challenges" ? undefined : { a: 1 }),
    });
    const out = await loadStatsSources(
      [comp("competition_1", "season_50")],
      readers,
    );
    expect(out.seasons.season_50).toBeNull();
  });

  it("treats a failed trades read as unavailable for that competition only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const readers = okReaders({
      readTrades: async (id) => {
        if (id === "competition_2") throw new Error("offline");
        return [];
      },
    });
    const out = await loadStatsSources(
      [comp("competition_1", "season_50"), comp("competition_2", "season_50")],
      readers,
    );
    expect(out.trades.competition_1).toEqual([]);
    expect(out.trades.competition_2).toBeNull();
    expect(out.seasons.season_50).not.toBeNull();
  });
});

describe("pickCurrent", () => {
  it("returns a value fetched for the current account and attempt", () => {
    expect(pickCurrent({ uid: "a", attempt: 0, value: 1 }, "a", 0)).toBe(1);
  });

  it("drops a slow response for the previous account", () => {
    expect(
      pickCurrent({ uid: "a", attempt: 0, value: 1 }, "b", 0),
    ).toBeUndefined();
  });

  it("drops a superseded retry", () => {
    expect(
      pickCurrent({ uid: "a", attempt: 0, value: 1 }, "a", 1),
    ).toBeUndefined();
  });

  it("returns nothing while signed out", () => {
    expect(
      pickCurrent({ uid: "a", attempt: 0, value: 1 }, undefined, 0),
    ).toBeUndefined();
  });
});

describe("isRenderableTrade", () => {
  it("rejects trades the competition page would skip", () => {
    expect(isRenderableTrade({} as Trade)).toBe(false);
    expect(
      isRenderableTrade({
        created_at: "x",
        offered_castaway_ids: [],
        requested_castaway_ids: [],
      } as unknown as Trade),
    ).toBe(true);
  });
});
