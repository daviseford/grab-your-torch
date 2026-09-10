import { describe, expect, it } from "vitest";
import { CastawayId } from "../../types";
import { PoolEntryForRanking, rankPoolEntries } from "../poolRanking";
import { SeasonPointsByCastaway } from "../seasonPoints";

const ALICE = "US0001" as CastawayId;
const BOB = "US0002" as CastawayId;
const CHARLIE = "US0003" as CastawayId;
const DANA = "US0004" as CastawayId;

const perEpisode = (...totals: number[]) =>
  totals.map((total, i) => ({
    episode_num: i + 1,
    total,
    actions: [],
  }));

/** ALICE 6, BOB 4, CHARLIE 2, DANA 0 across three episodes. */
const pointsByCastaway: SeasonPointsByCastaway = {
  [ALICE]: perEpisode(3, 2, 1),
  [BOB]: perEpisode(1, 3, 0),
  [CHARLIE]: perEpisode(0, 2, 0),
  [DANA]: perEpisode(0, 0, 0),
};

const entry = (
  uid: string,
  handle: string,
  picks: CastawayId[],
): PoolEntryForRanking => ({
  uid,
  handle,
  picks: picks.map((castaway_id) => ({
    castaway_id,
    full_name: `Castaway ${castaway_id}`,
  })),
});

const shuffle = <T>(items: T[]): T[] => {
  // Deterministic reversal-plus-rotation, so a failure reproduces.
  const reversed = [...items].reverse();
  return [...reversed.slice(1), reversed[0]];
};

describe("rankPoolEntries", () => {
  it("sums each entrant's picks across every scored episode", () => {
    const rows = rankPoolEntries(
      [entry("u1", "torchsnuffer", [ALICE, CHARLIE])],
      pointsByCastaway,
      {},
    );

    expect(rows).toEqual([
      {
        uid: "u1",
        handle: "torchsnuffer",
        rank: 1,
        total_points: 8,
        prop_bet_points: 0,
      },
    ]);
  });

  it("orders entrants by total points, highest first", () => {
    const rows = rankPoolEntries(
      [
        entry("u2", "second", [BOB]),
        entry("u1", "first", [ALICE]),
        entry("u3", "third", [CHARLIE]),
      ],
      pointsByCastaway,
      {},
    );

    expect(rows.map((r) => [r.handle, r.total_points, r.rank])).toEqual([
      ["first", 6, 1],
      ["second", 4, 2],
      ["third", 2, 3],
    ]);
  });

  it("breaks an equal total with prop bet points", () => {
    const rows = rankPoolEntries(
      [entry("u1", "no-props", [ALICE]), entry("u2", "props", [BOB, CHARLIE])],
      pointsByCastaway,
      { u1: 0, u2: 5 },
    );

    expect(rows.map((r) => r.total_points)).toEqual([6, 6]);
    expect(rows.map((r) => [r.handle, r.rank])).toEqual([
      ["props", 1],
      ["no-props", 2],
    ]);
  });

  it("keeps prop bet points out of the total", () => {
    const rows = rankPoolEntries(
      [entry("u1", "solo", [CHARLIE])],
      pointsByCastaway,
      { u1: 40 },
    );

    expect(rows[0].total_points).toBe(2);
    expect(rows[0].prop_bet_points).toBe(40);
  });

  it("shares a rank when totals and prop bets are both equal, and skips the next rank", () => {
    const rows = rankPoolEntries(
      [
        entry("u1", "tied-a", [ALICE]),
        entry("u2", "tied-b", [BOB, CHARLIE]),
        entry("u3", "behind", [CHARLIE]),
      ],
      pointsByCastaway,
      { u1: 3, u2: 3, u3: 3 },
    );

    expect(rows.map((r) => [r.handle, r.rank])).toEqual([
      ["tied-a", 1],
      ["tied-b", 1],
      ["behind", 3],
    ]);
  });

  it("emits tied rows in the same order across repeated calls with shuffled input", () => {
    const entries = [
      entry("uid-c", "cee", [ALICE]),
      entry("uid-a", "ayy", [BOB, CHARLIE]),
      entry("uid-b", "bee", [CHARLIE, BOB]),
    ];
    const propBets = { "uid-a": 1, "uid-b": 1, "uid-c": 1 };

    const first = rankPoolEntries(entries, pointsByCastaway, propBets);
    const second = rankPoolEntries(
      shuffle(entries),
      pointsByCastaway,
      propBets,
    );
    const third = rankPoolEntries(
      shuffle(shuffle(entries)),
      pointsByCastaway,
      propBets,
    );

    expect(first.map((r) => r.uid)).toEqual(["uid-a", "uid-b", "uid-c"]);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(first.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("scores a pick nobody else holds the same as one everybody holds", () => {
    const rows = rankPoolEntries(
      [
        entry("u1", "alone", [CHARLIE]),
        entry("u2", "crowd-a", [CHARLIE]),
        entry("u3", "crowd-b", [CHARLIE]),
      ],
      pointsByCastaway,
      {},
    );

    expect(rows.map((r) => r.total_points)).toEqual([2, 2, 2]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
  });

  it("treats a pick with no scoring rows as zero rather than undefined", () => {
    const rows = rankPoolEntries(
      [
        entry("u1", "unknown-pick", ["US9999" as CastawayId]),
        entry("u2", "zero-pick", [DANA]),
      ],
      pointsByCastaway,
      {},
    );

    expect(rows.every((r) => r.total_points === 0)).toBe(true);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("treats an entrant with no picks and no prop bet lookup entry as zero", () => {
    const rows = rankPoolEntries([entry("u1", "empty", [])], {}, {});

    expect(rows).toEqual([
      {
        uid: "u1",
        handle: "empty",
        rank: 1,
        total_points: 0,
        prop_bet_points: 0,
      },
    ]);
  });

  it("returns an empty array for no entries", () => {
    expect(rankPoolEntries([], pointsByCastaway, {})).toEqual([]);
  });

  it("never emits an email, even when the handle is empty", () => {
    const rows = rankPoolEntries(
      [
        { uid: "uid@example.com", handle: "", picks: [] },
        entry("u2", "handled", [ALICE]),
      ],
      pointsByCastaway,
      {},
    );

    expect(rows.map((r) => r.handle)).toEqual(["handled", ""]);
    expect(rows.every((r) => !r.handle.includes("@"))).toBe(true);
  });
});
