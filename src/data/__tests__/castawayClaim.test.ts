import { describe, expect, it } from "vitest";
import { SEASONS } from "../seasons";

/**
 * The homepage claims "700+ castaways". Keep that claim honest against the
 * season data: it must count unique people (castaway ids), not appearances,
 * and it must be the current count rounded down to the hundreds.
 */
describe("homepage castaway claim", () => {
  it("matches the unique castaway count rounded down to the hundreds", () => {
    const unique = new Set(
      Object.values(SEASONS).flatMap((season) =>
        season.players.map((player) => player.castaway_id),
      ),
    );
    expect(unique.size).toBeGreaterThanOrEqual(700);
    expect(Math.floor(unique.size / 100) * 100).toBe(700);
  });
});
