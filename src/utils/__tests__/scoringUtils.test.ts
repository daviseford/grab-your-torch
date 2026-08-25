import { describe, expect, it } from "vitest";
import { Elimination } from "../../types";
import { getEnhancedSurvivorPoints } from "../scoringUtils";

const makeElimination = (
  id: string,
  episodeNum: number,
  order: number,
  castawayId: string,
  variant: Elimination["variant"] = "tribal",
): Elimination => ({
  id: id as Elimination["id"],
  season_id: "season_1",
  season_num: 1,
  episode_id: `episode_${episodeNum}` as Elimination["episode_id"],
  episode_num: episodeNum,
  castaway_id: castawayId as Elimination["castaway_id"],
  order,
  variant,
});

describe("getEnhancedSurvivorPoints elimination scoring", () => {
  it("awards points equal to the episode number for a sole elimination", () => {
    const eliminations = [makeElimination("elimination_1", 6, 6, "US0001")];

    const scores = getEnhancedSurvivorPoints([], eliminations, [], 6, "US0001");

    expect(scores.actions).toEqual([
      { action: "eliminated", points_awarded: 6 },
    ]);
    expect(scores.total).toBe(6);
  });

  it("adds +0.5 for each earlier elimination in the same episode", () => {
    const eliminations = [
      makeElimination("elimination_1", 6, 10, "US0001"),
      makeElimination("elimination_2", 6, 11, "US0002"),
      makeElimination("elimination_3", 6, 12, "US0003"),
    ];

    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0001").total,
    ).toBe(6);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0002").total,
    ).toBe(6.5);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0003").total,
    ).toBe(7);
  });

  it("ignores eliminations from other episodes when ranking within an episode", () => {
    const eliminations = [
      makeElimination("elimination_1", 5, 9, "US0001"),
      makeElimination("elimination_2", 6, 10, "US0002"),
    ];

    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0002").total,
    ).toBe(6);
  });

  it("breaks tied orders deterministically by id so both boots get distinct ranks", () => {
    const eliminations = [
      makeElimination("elimination_b", 6, 10, "US0001"),
      makeElimination("elimination_a", 6, 10, "US0002"),
      makeElimination("elimination_c", 6, 11, "US0003"),
    ];

    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0002").total,
    ).toBe(6);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0001").total,
    ).toBe(6.5);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0003").total,
    ).toBe(7);
  });

  it("does not count tribe switches as earlier eliminations", () => {
    const eliminations = [
      makeElimination("elimination_1", 6, 10, "US0001", "switched"),
      makeElimination("elimination_2", 6, 11, "US0002"),
    ];

    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 6, "US0002").total,
    ).toBe(6);
  });
});
