import { describe, expect, it } from "vitest";
import { SEASON_51_PLAYERS } from "../../../data/season_51";
import type { PoolPick } from "../../../types";
import { buildPoolCastDetails } from "../poolCastDetails";

const roster: PoolPick[] = SEASON_51_PLAYERS.map((p) => ({
  castaway_id: p.castaway_id,
  full_name: p.full_name,
}));

describe("buildPoolCastDetails", () => {
  it("decorates every castaway when the roster and bundle agree", () => {
    const details = buildPoolCastDetails("season_51", roster);
    expect(details.size).toBe(SEASON_51_PLAYERS.length);
    expect(details.get("US0754")?.player.full_name).toBe("Ana Sani");
  });

  it("shows no portrait rather than another castaway's when an id moved", () => {
    // survivoR's US0755 is Ana Sani; in the provisional bundle it is Brady.
    const remapped: PoolPick[] = [
      { castaway_id: "US0755", full_name: "Ana Sani" },
      { castaway_id: "US0752", full_name: "Aaliyah Puglia" },
    ];
    const details = buildPoolCastDetails("season_51", remapped);
    expect(details.has("US0755")).toBe(false);
    expect(details.get("US0752")?.player.full_name).toBe("Aaliyah Puglia");
  });

  it("is empty for a season without a bundled cast", () => {
    expect(buildPoolCastDetails("season_50", roster).size).toBe(0);
  });
});
