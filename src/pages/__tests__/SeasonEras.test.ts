import { describe, expect, it } from "vitest";
import type { SeasonMeta } from "../../data/season-metadata";
import {
  getSeasonArt,
  getSeasonDisplayTitle,
  getSeasonEra,
  SEASON_ERAS,
} from "../SeasonEras";

const meta = (overrides: Partial<SeasonMeta>): SeasonMeta => ({
  id: "season_12",
  order: 12,
  name: "Survivor: Panama",
  subtitle: "Exile Island",
  location: "Pearl Islands, Panama",
  year: 2006,
  contestantCount: 16,
  img: "/images/season_12/season-12-logo.png",
  complete: true,
  ...overrides,
});

describe("getSeasonEra", () => {
  it("places every band boundary in its own era", () => {
    const ids = SEASON_ERAS.map((era) => era.id);
    expect(
      [1, 8, 9, 20, 21, 33, 34, 50].map((n) => getSeasonEra(n).id),
    ).toEqual([ids[0], ids[0], ids[1], ids[1], ids[2], ids[2], ids[3], ids[3]]);
  });

  it("treats seasons past the last band as the newest era", () => {
    expect(getSeasonEra(51).id).toBe("new");
    expect(getSeasonEra(0).id).toBe("new");
  });

  it("covers 1 through 50 without gaps", () => {
    for (let n = 1; n <= 50; n++) {
      const era = getSeasonEra(n);
      expect(n >= era.min && n <= era.max, `season ${n}`).toBe(true);
    }
  });
});

describe("getSeasonDisplayTitle", () => {
  it("keeps a name that already carries the season number", () => {
    expect(
      getSeasonDisplayTitle(meta({ order: 50, name: "Survivor 50" })),
    ).toBe("Survivor 50");
  });

  it("prefers the subtitle when the name has no number", () => {
    expect(getSeasonDisplayTitle(meta({}))).toBe("S12: Exile Island");
  });

  it("strips the Survivor prefix when there is no subtitle", () => {
    expect(
      getSeasonDisplayTitle(
        meta({ order: 3, name: "Survivor: Africa", subtitle: null }),
      ),
    ).toBe("S3: Africa");
  });
});

describe("getSeasonArt", () => {
  it("uses the registered image by default", () => {
    expect(getSeasonArt(meta({}))).toBe("/images/season_12/season-12-logo.png");
  });

  it("swaps in the clean png for season 50", () => {
    expect(
      getSeasonArt(
        meta({
          id: "season_50",
          order: 50,
          img: "/images/season_50/season-50-logo.webp",
        }),
      ),
    ).toBe("/images/season_50/season-50-logo.png");
  });
});
