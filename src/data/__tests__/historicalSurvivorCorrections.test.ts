import { describe, expect, it } from "vitest";
import { getEnhancedSurvivorPoints } from "../../utils/scoringUtils";
import * as s38 from "../season_38";
import * as s39 from "../season_39";
import * as s50 from "../season_50";

// Corrections from survivoR c729c775 (challenge winners in S38, S39, S50).
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
  ] as const)(
    "S%i Episode %i %s scores %d -> %d",
    (season, ep, id, _before, after) => {
      expect(points(season, ep, id)).toBe(after);
    },
  );
});
