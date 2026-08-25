import { describe, expect, it } from "vitest";
import { BASE_PLAYER_SCORING } from "../../data/scoring";
import { Elimination } from "../../types";
import { getEnhancedSurvivorPoints } from "../scoringUtils";

const MEDICAL_POINTS =
  BASE_PLAYER_SCORING.find((x) => x.action === "medically_evacuated")
    ?.fixed_value ?? 0;

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

  it("ranks final tribal council runners-up after the finale boots", () => {
    // Mirrors the season 50 finale: two tribal boots, then two finalists
    // who lost at final tribal council.
    const eliminations = [
      makeElimination("elimination_1", 13, 20, "US0695"),
      makeElimination("elimination_2", 13, 21, "US0745"),
      makeElimination(
        "elimination_3",
        13,
        22,
        "US0722",
        "final_tribal_council",
      ),
      makeElimination(
        "elimination_4",
        13,
        23,
        "US0700",
        "final_tribal_council",
      ),
    ];

    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 13, "US0695").total,
    ).toBe(13);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 13, "US0745").total,
    ).toBe(13.5);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 13, "US0722").total,
    ).toBe(14);
    expect(
      getEnhancedSurvivorPoints([], eliminations, [], 13, "US0700").total,
    ).toBe(14.5);
  });

  it("stacks the later-boot bonus with a medical evacuation's fixed points", () => {
    const eliminations = [
      makeElimination("elimination_1", 6, 10, "US0001"),
      makeElimination("elimination_2", 6, 11, "US0002", "medical"),
    ];

    const scores = getEnhancedSurvivorPoints([], eliminations, [], 6, "US0002");

    expect(scores.actions).toEqual([
      { action: "eliminated", points_awarded: 6.5 },
      { action: "medically_evacuated", points_awarded: MEDICAL_POINTS },
    ]);
    expect(scores.total).toBe(6.5 + MEDICAL_POINTS);
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
