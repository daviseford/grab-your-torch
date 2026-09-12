import { describe, expect, it } from "vitest";
import { SEASON_51_PLAYERS } from "../../data/season_51";
import type { Player } from "../../types";
import { getCastawayBio, rosterGenderBreakdown } from "../castawayBio";

describe("castaway bios", () => {
  it("uses canonical IDs when a returning castaway has changed their name", () => {
    const amber = {
      ...SEASON_51_PLAYERS[0],
      season_num: 2,
      season_id: "season_2",
      castaway_id: "US0027",
      full_name: "Amber Brkich",
    } satisfies Player;
    expect(rosterGenderBreakdown([amber])).toBe("0 male · 1 female");
  });
  it("counts the screenshot roster using documented genders", () => {
    const names = [
      "Danny Kilby",
      "Ana Sani",
      "Jenna Doore",
      "Alexis Levine",
      "Thien An Nguyen",
      "Sharonda Cox",
      "Aaliyah Puglia",
    ];
    expect(
      rosterGenderBreakdown(
        SEASON_51_PLAYERS.filter((p) => names.includes(p.full_name)),
      ),
    ).toBe("1 male · 6 female");
  });

  it("keeps unknown players unclassified and an empty roster empty", () => {
    const unknown = {
      ...SEASON_51_PLAYERS[0],
      castaway_id: "US9999",
      full_name: "Unknown",
    } satisfies Player;
    expect(rosterGenderBreakdown([unknown])).toBe(
      "0 male · 0 female · 1 unspecified",
    );
    expect(rosterGenderBreakdown([])).toBe("");
  });

  it("does not attach a provisional ID's biography to another person", () => {
    const changed = { ...SEASON_51_PLAYERS[0], full_name: "Different Person" };
    expect(getCastawayBio(changed).hobbies).toBeUndefined();
    expect(getCastawayBio(changed).gender).toBeUndefined();
  });

  it("keeps hometown separate from birthplace and current residence", () => {
    const danny = SEASON_51_PLAYERS.find((p) => p.full_name === "Danny Kilby")!;
    expect(getCastawayBio(danny)).toMatchObject({
      hometown: "Mount Forest, Ontario, Canada",
      residence: "London, Ontario, Canada",
    });
    expect(getCastawayBio(danny).birthplace).toBeUndefined();
  });

  it("preserves nonbinary source values instead of counting them as female", () => {
    const player = { ...SEASON_51_PLAYERS[0], gender: "Non-binary" };
    expect(rosterGenderBreakdown([player])).toBe(
      "0 male · 0 female · 1 non-binary",
    );
  });

  it("never imports result-bearing freeform bios into preseason details", () => {
    const player = {
      ...SEASON_51_PLAYERS[0],
      bio: "Won the season",
      description: "Eliminated in episode 2",
    };
    expect(JSON.stringify(getCastawayBio(player))).not.toMatch(
      /Won the season|Eliminated/,
    );
  });
});
