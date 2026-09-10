import { describe, expect, it } from "vitest";
import { PropBetQuestionKeys } from "../../src/data/propbets.js";
import { SEASON_METADATA } from "../../src/data/season-metadata.js";
import { SEASON_51_PLAYERS } from "../../src/data/season_51/index.js";
import {
  buildPoolCounters,
  buildPoolDocument,
  buildProvisionWrites,
  checkOverwriteAllowed,
  checkSeasonEligible,
  computeFreezeInstant,
  formatFreezeInEastern,
  poolIdForSeason,
} from "../create-pool.js";

const season51 = SEASON_METADATA.season_51;

const rosterInput = SEASON_51_PLAYERS.map((p) => ({
  castaway_id: p.castaway_id,
  full_name: p.full_name,
}));

const buildS51 = () =>
  buildPoolDocument({
    seasonNum: 51,
    seasonName: season51.name,
    premiere: season51.premiere!,
    players: rosterInput,
  });

describe("computeFreezeInstant", () => {
  it("puts the Season 51 premiere freeze at 2026-09-24T00:00:00Z", () => {
    // 2026-09-23 20:00 EDT (UTC-4) is midnight UTC the following day.
    expect(computeFreezeInstant("2026-09-23").toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    );
  });

  it("uses the standard-time offset for a winter premiere", () => {
    // 2026-02-10 20:00 EST (UTC-5).
    expect(computeFreezeInstant("2026-02-10").toISOString()).toBe(
      "2026-02-11T01:00:00.000Z",
    );
  });

  it("holds across the spring daylight-saving boundary", () => {
    // US DST begins 2026-03-08. The day before is EST, the day itself is EDT.
    expect(computeFreezeInstant("2026-03-07").toISOString()).toBe(
      "2026-03-08T01:00:00.000Z",
    );
    expect(computeFreezeInstant("2026-03-08").toISOString()).toBe(
      "2026-03-09T00:00:00.000Z",
    );
  });

  it("holds across the autumn daylight-saving boundary", () => {
    // US DST ends 2026-11-01. The day before is EDT, the day itself is EST.
    expect(computeFreezeInstant("2026-10-31").toISOString()).toBe(
      "2026-11-01T00:00:00.000Z",
    );
    expect(computeFreezeInstant("2026-11-01").toISOString()).toBe(
      "2026-11-02T01:00:00.000Z",
    );
  });

  it("formats the instant in Eastern with the right abbreviation", () => {
    expect(formatFreezeInEastern(computeFreezeInstant("2026-09-23"))).toBe(
      "2026-09-23 20:00 EDT",
    );
    expect(formatFreezeInEastern(computeFreezeInstant("2026-02-10"))).toBe(
      "2026-02-10 20:00 EST",
    );
  });

  it("rejects a premiere that is not an ISO date", () => {
    expect(() => computeFreezeInstant("September 23, 2026")).toThrow();
  });
});

describe("poolIdForSeason", () => {
  it("derives a stable id from the season number", () => {
    expect(poolIdForSeason(51)).toBe("pool_season_51");
  });

  it("matches the id shape the auth intent validates", () => {
    expect(poolIdForSeason(51)).toMatch(/^pool_[A-Za-z0-9_-]+$/);
  });
});

describe("buildPoolDocument", () => {
  it("floors picks_per_entry at one third of the cast", () => {
    const pick = (count: number) =>
      buildPoolDocument({
        seasonNum: 99,
        seasonName: "Survivor 99",
        premiere: "2026-09-23",
        players: Array.from({ length: count }, (_, i) => ({
          castaway_id: `US${String(900 + i).padStart(4, "0")}` as const,
          full_name: `Castaway ${i}`,
        })),
      }).picks_per_entry;

    expect(pick(21)).toBe(7);
    expect(pick(20)).toBe(6);
    expect(pick(22)).toBe(7);
  });

  it("gives Season 51 seven picks from a twenty-one name roster", () => {
    const pool = buildS51();
    expect(pool.roster).toHaveLength(21);
    expect(pool.picks_per_entry).toBe(7);
    expect(pool.roster.every((r) => r.full_name.trim().length > 0)).toBe(true);
    expect(pool.roster.every((r) => /^US\d{4}$/.test(r.castaway_id))).toBe(
      true,
    );
    // Every roster pair carries only the two contract fields (R23).
    expect(Object.keys(pool.roster[0]).sort()).toEqual([
      "castaway_id",
      "full_name",
    ]);
  });

  it("mirrors the prop bet question list", () => {
    expect(buildS51().prop_bet_keys).toEqual(PropBetQuestionKeys);
  });

  it("writes the contract fields a closed, unstarted pool needs", () => {
    const pool = buildS51();
    expect(pool.id).toBe("pool_season_51");
    expect(pool.season_id).toBe("season_51");
    expect(pool.season_num).toBe(51);
    expect(pool.status).toBe("closed");
    expect(pool.display_mode).toBe("full");
    expect(pool.latest_episode_num).toBeNull();
    expect(pool.season_complete).toBe(false);
  });

  it("stores freeze_at as a timestamp, not a string", () => {
    const pool = buildS51();
    expect(typeof pool.freeze_at).toBe("object");
    expect(pool.freeze_at.toDate().toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    );
  });

  it("refuses an empty roster", () => {
    expect(() =>
      buildPoolDocument({
        seasonNum: 99,
        seasonName: "Survivor 99",
        premiere: "2026-09-23",
        players: [],
      }),
    ).toThrow(/roster/i);
  });

  it("refuses a castaway with no name", () => {
    expect(() =>
      buildPoolDocument({
        seasonNum: 99,
        seasonName: "Survivor 99",
        premiere: "2026-09-23",
        players: [{ castaway_id: "US0901", full_name: "  " }],
      }),
    ).toThrow(/full_name/i);
  });
});

describe("buildPoolCounters", () => {
  it("starts the entrant count at zero", () => {
    const counters = buildPoolCounters(new Date("2026-09-10T12:00:00.000Z"));
    expect(counters.entry_count).toBe(0);
    expect(counters.updated_at).toBe("2026-09-10T12:00:00.000Z");
  });
});

describe("buildProvisionWrites", () => {
  it("plans both the config and the counters document", () => {
    const writes = buildProvisionWrites({
      seasonNum: 51,
      seasonName: season51.name,
      premiere: season51.premiere!,
      players: rosterInput,
      now: new Date("2026-09-10T12:00:00.000Z"),
    });

    expect(writes.map((w) => w.path)).toEqual([
      "pools/pool_season_51",
      "pools/pool_season_51/meta/counters",
    ]);

    const config = writes.find((w) => w.kind === "pool")!;
    const counters = writes.find((w) => w.kind === "counters")!;
    expect(config.data.status).toBe("closed");
    expect(counters.data.entry_count).toBe(0);
  });
});

describe("checkSeasonEligible", () => {
  const before = new Date("2026-09-10T12:00:00.000Z");
  const after = new Date("2026-09-24T12:00:00.000Z");

  it("allows an upcoming season", () => {
    expect(checkSeasonEligible(season51, before)).toEqual({ ok: true });
  });

  it("refuses a season that is already airing", () => {
    const result = checkSeasonEligible(season51, after);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/live/);
  });

  it("refuses a complete season", () => {
    const result = checkSeasonEligible(SEASON_METADATA.season_50, before);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/complete/);
  });

  it("refuses a season with no premiere date", () => {
    const result = checkSeasonEligible(
      { complete: false, name: "Survivor 99" },
      before,
    );
    expect(result.ok).toBe(false);
  });
});

describe("checkOverwriteAllowed", () => {
  it("allows provisioning when no pool exists", () => {
    expect(checkOverwriteAllowed(false, false)).toEqual({ ok: true });
  });

  it("refuses an existing pool without the overwrite flag", () => {
    const result = checkOverwriteAllowed(true, false);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/--overwrite/);
  });

  it("allows an existing pool with the overwrite flag", () => {
    expect(checkOverwriteAllowed(true, true)).toEqual({ ok: true });
  });
});
