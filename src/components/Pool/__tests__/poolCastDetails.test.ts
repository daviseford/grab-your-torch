import { describe, expect, it } from "vitest";
import { SEASON_51_PLAYERS } from "../../../data/season_51";
import type { PoolPick } from "../../../types";
import { buildPoolCastDetails } from "../poolCastDetails";

const roster: PoolPick[] = SEASON_51_PLAYERS.map((p) => ({
  castaway_id: p.castaway_id,
  full_name: p.full_name,
}));

describe("buildPoolCastDetails", () => {
  // Written against names, not ids, so it holds whether the bundle carries
  // the provisional ids or survivoR's (docs/castaway-id-mapping.md).
  const byName = (name: string) =>
    SEASON_51_PLAYERS.find((p) => p.full_name === name)!;

  it("decorates every castaway when the roster and bundle agree", () => {
    const details = buildPoolCastDetails("season_51", roster);
    expect(details.size).toBe(SEASON_51_PLAYERS.length);
    const ana = byName("Ana Sani");
    expect(details.get(ana.castaway_id)?.player.full_name).toBe("Ana Sani");
  });

  it("shows no portrait rather than another castaway's when an id moved", () => {
    // The roster names Ana Sani under the id the bundle gives Brady Booker,
    // as it would between the stored roster and the bundle being remapped.
    const moved = byName("Brady Booker").castaway_id;
    const aaliyah = byName("Aaliyah Puglia");
    const remapped: PoolPick[] = [
      { castaway_id: moved, full_name: "Ana Sani" },
      { castaway_id: aaliyah.castaway_id, full_name: "Aaliyah Puglia" },
    ];
    const details = buildPoolCastDetails("season_51", remapped);
    expect(details.has(moved)).toBe(false);
    expect(details.get(aaliyah.castaway_id)?.player.full_name).toBe(
      "Aaliyah Puglia",
    );
  });

  it("is empty for a season without a bundled cast", () => {
    expect(buildPoolCastDetails("season_50", roster).size).toBe(0);
  });
});
