import { describe, expect, it } from "vitest";
import { extractExistingCastawayLookup } from "../codegen";

describe("extractExistingCastawayLookup", () => {
  it("reads castaway_id and full_name pairs from the lookup export", () => {
    const file = `
export const SEASON_51_CASTAWAY_LOOKUP: CastawayLookup = {
  US0752: { full_name: "Aaliyah Puglia", castaway: "Aaliyah" },
  "US0768": { full_name: "Ori Jean-Charles", castaway: "Ori" },
  US0999: { full_name: "Some \\"Quoted\\" Name", castaway: "Some" },
};

export const SEASON_51_PLAYERS = [
  buildPlayer({
    castaway_id: "US0752",
    full_name: "Aaliyah Puglia",
    img: "/images/season_51/Aaliyah-Puglia.jpg",
  }),
] satisfies Player<CastawayIdType, SeasonNumber>[];
`;
    expect(extractExistingCastawayLookup(file)).toEqual([
      { castawayId: "US0752", fullName: "Aaliyah Puglia" },
      { castawayId: "US0768", fullName: "Ori Jean-Charles" },
      { castawayId: "US0999", fullName: 'Some "Quoted" Name' },
    ]);
  });

  it("returns nothing for a file without a lookup", () => {
    expect(extractExistingCastawayLookup("export const X = 1;")).toEqual([]);
  });
});
