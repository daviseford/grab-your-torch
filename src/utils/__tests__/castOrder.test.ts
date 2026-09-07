import { describe, expect, it } from "vitest";
import type { CastawayLookup, Player } from "../../types";
import { castawayDisplayName, sortCastAlphabetically } from "../castOrder";

const player = (castaway_id: Player["castaway_id"], full_name: string) => ({
  castaway_id,
  full_name,
});

// Boot order, as survivoR (and the generated season files) list the cast.
const bootOrder = [
  player("US0004", "Zed Zimmer"),
  player("US0001", "Élodie Martin"),
  player("US0003", "amy lowercase"),
  player("US0002", "Boston Rob Mariano"),
];

describe("castawayDisplayName", () => {
  it("prefers the on-screen castaway name from the lookup", () => {
    const lookup: CastawayLookup = {
      US0002: { full_name: "Boston Rob Mariano", castaway: "Boston Rob" },
    };
    expect(castawayDisplayName(bootOrder[3], lookup)).toBe("Boston Rob");
  });

  it("falls back to the full name when the lookup has no entry", () => {
    expect(castawayDisplayName(bootOrder[0], {})).toBe("Zed Zimmer");
    expect(castawayDisplayName(bootOrder[0])).toBe("Zed Zimmer");
  });
});

describe("sortCastAlphabetically", () => {
  it("orders by full name when there is no lookup, ignoring case and accents", () => {
    expect(sortCastAlphabetically(bootOrder).map((p) => p.full_name)).toEqual([
      "amy lowercase",
      "Boston Rob Mariano",
      "Élodie Martin",
      "Zed Zimmer",
    ]);
  });

  it("orders by the on-screen castaway name when a lookup is given", () => {
    const lookup: CastawayLookup = {
      US0004: { full_name: "Zed Zimmer", castaway: "Zed" },
      US0001: { full_name: "Élodie Martin", castaway: "Elo" },
      US0003: { full_name: "amy lowercase", castaway: "Amy" },
      // The display name sorts ahead of the full name here.
      US0002: { full_name: "Boston Rob Mariano", castaway: "Rob" },
    };
    expect(
      sortCastAlphabetically(bootOrder, lookup).map((p) => p.castaway_id),
    ).toEqual(["US0003", "US0001", "US0002", "US0004"]);
  });

  it("breaks display-name ties by full name", () => {
    const cast = [
      player("US0011", "Mike Zimmer"),
      player("US0010", "Mike Adams"),
    ];
    const lookup: CastawayLookup = {
      US0010: { full_name: "Mike Adams", castaway: "Mike" },
      US0011: { full_name: "Mike Zimmer", castaway: "Mike" },
    };
    expect(
      sortCastAlphabetically(cast, lookup).map((p) => p.full_name),
    ).toEqual(["Mike Adams", "Mike Zimmer"]);
  });

  it("returns a new array and leaves the season data untouched", () => {
    const input = [...bootOrder];
    const sorted = sortCastAlphabetically(input);
    expect(sorted).not.toBe(input);
    expect(input).toEqual(bootOrder);
  });
});
