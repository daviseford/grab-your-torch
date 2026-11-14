import { describe, expect, it } from "vitest";
import { getEnhancedSurvivorPoints } from "../../utils/scoringUtils";
import * as s38 from "../season_38";
import * as s39 from "../season_39";
import * as s45 from "../season_45";
import * as s47 from "../season_47";
import * as s48 from "../season_48";
import * as s50 from "../season_50";

// Corrections from survivoR c729c775 (challenge winners in S38, S39, S50) and
// one Shot in the Dark credit per tribal (S45, S47, S48, S50).
const seasons = {
  38: [
    s38.SEASON_38_CHALLENGES,
    s38.SEASON_38_ELIMINATIONS,
    s38.SEASON_38_EVENTS,
  ],
  39: [
    s39.SEASON_39_CHALLENGES,
    s39.SEASON_39_ELIMINATIONS,
    s39.SEASON_39_EVENTS,
  ],
  45: [
    s45.SEASON_45_CHALLENGES,
    s45.SEASON_45_ELIMINATIONS,
    s45.SEASON_45_EVENTS,
  ],
  47: [
    s47.SEASON_47_CHALLENGES,
    s47.SEASON_47_ELIMINATIONS,
    s47.SEASON_47_EVENTS,
  ],
  48: [
    s48.SEASON_48_CHALLENGES,
    s48.SEASON_48_ELIMINATIONS,
    s48.SEASON_48_EVENTS,
  ],
  50: [
    s50.SEASON_50_CHALLENGES,
    s50.SEASON_50_ELIMINATIONS,
    s50.SEASON_50_EVENTS,
  ],
} as const;

const points = (season: keyof typeof seasons, ep: number, id: string) => {
  const [c, el, ev] = seasons[season].map((x) => Object.values(x));
  return getEnhancedSurvivorPoints(
    c as never,
    el as never,
    ev as never,
    ep,
    id as never,
  ).total;
};

describe("historical survivoR corrections (c729c775)", () => {
  it.each([
    // [season, episode, castaway, points before, points after]
    [38, 13, "US0557", 2, 0],
    [38, 13, "US0564", 2, 0],
    [39, 11, "US0585", 1, 0],
    [39, 11, "US0586", 0, 1],
    [39, 11, "US0587", 4, 3],
    [39, 11, "US0590", 0, 1],
    [50, 1, "US0682", 0, 3],
    [50, 1, "US0550", 4, 1],
    [45, 6, "US0673", 14, 8],
    [47, 8, "US0707", 3, 2],
    [48, 3, "US0727", 24, 6],
    [50, 8, "US0277", 10.5, 9.5],
  ] as const)(
    "S%i Episode %i %s scores %d -> %d",
    (season, ep, id, _before, after) => {
      expect(points(season, ep, id)).toBe(after);
    },
  );

  it("keeps one Shot in the Dark per castaway per episode", () => {
    for (const [season, [, , events]] of Object.entries(seasons)) {
      const seen = new Set<string>();
      for (const e of Object.values(events)) {
        if (!e.action.includes("shot_in_the_dark")) continue;
        const key = `${season}:${e.episode_num}:${e.castaway_id}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });
});
