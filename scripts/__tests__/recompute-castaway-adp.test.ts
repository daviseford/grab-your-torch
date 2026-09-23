import { describe, expect, it } from "vitest";
import type { CastawayId, Episode, Player, Season } from "../../src/types";
import {
  competitionsFromFixture,
  describePlan,
  loadCompetitions,
  parseArgs,
  planSeason,
  resolvePremiereAirDate,
  type CompetitionReader,
} from "../recompute-castaway-adp";

const CAST = ["US9001", "US9002", "US9003", "US9004"] as CastawayId[];

const season = (
  episodes: Partial<Episode>[] = [{ order: 1, air_date: "2026-09-23" }],
  id: Season["id"] = "season_51",
) =>
  ({
    id,
    order: Number(id.replace("season_", "")),
    players: CAST.map((castaway_id) => ({ castaway_id }) as Player),
    episodes: episodes as Episode[],
  }) as const;

const competition = (id: string, createdAt: string, picks: CastawayId[]) => ({
  id,
  created_at: createdAt,
  data: {
    season_id: "season_51",
    participant_uids: ["uid_private_a", "uid_private_b"],
    competition_name: "A private league name",
    draft_picks: picks.map((castaway_id, index) => ({
      order: index + 1,
      castaway_id,
      user_uid: index % 2 ? "uid_private_b" : "uid_private_a",
      user_name: "Private Person",
    })),
  },
});

describe("parseArgs", () => {
  it("accepts season numbers or ids and defaults to a dry run", () => {
    expect(parseArgs(["51", "season_50"])).toEqual({
      seasonIds: ["season_51", "season_50"],
      write: false,
      fixture: null,
    });
    expect(parseArgs(["51", "--fixture", "f.json"]).fixture).toBe("f.json");
    expect(parseArgs(["51", "--write"]).write).toBe(true);
  });

  it("rejects anything it does not understand rather than guessing", () => {
    expect(() => parseArgs(["51", "--wrte"])).toThrow(/--wrte/);
  });
});

describe("resolvePremiereAirDate", () => {
  it("prefers the aired first episode, then the listing, then the catalog", () => {
    expect(resolvePremiereAirDate(season())).toBe("2026-09-23");
    expect(
      resolvePremiereAirDate(season([]), {
        season_51: [{ order: 1, air_date: "2026-09-30" }],
      }),
    ).toBe("2026-09-30");
    expect(
      resolvePremiereAirDate(season([]), {}, {
        season_51: { premiere: "2026-10-07" },
      } as never),
    ).toBe("2026-10-07");
    expect(resolvePremiereAirDate(season([]), {}, {} as never)).toBeNull();
  });
});

describe("loadCompetitions", () => {
  it("uses the document's own create time as the promotion instant", async () => {
    const created = new Date("2026-09-20T12:00:00Z");
    const db: CompetitionReader = {
      collection: () => ({
        get: async () => ({
          docs: [
            {
              id: "competition_a",
              data: () => ({ season_id: "season_51" }),
              createTime: { toDate: () => created },
            },
            { id: "competition_b", data: () => undefined },
          ],
        }),
      }),
    };

    expect(await loadCompetitions(db)).toEqual([
      {
        id: "competition_a",
        createdAt: created,
        data: { season_id: "season_51" },
      },
      { id: "competition_b", createdAt: null, data: {} },
    ]);
  });
});

describe("planSeason", () => {
  const competitions = competitionsFromFixture([
    competition("competition_one", "2026-09-01T00:00:00Z", CAST),
    competition("competition_two", "2026-09-02T00:00:00Z", CAST),
    competition("competition_three", "2026-09-03T00:00:00Z", [
      CAST[1],
      CAST[0],
      CAST[2],
      CAST[3],
    ]),
    competition("competition_late", "2026-10-01T00:00:00Z", CAST),
  ]);

  it("refuses a season with no known premiere instead of guessing a cutoff", () => {
    expect(
      planSeason(season([], "season_9"), "season_9", competitions, "now"),
    ).toMatchObject({ ok: false });
    expect(planSeason(undefined, "season_99", competitions, "now")).toEqual({
      seasonId: "season_99",
      ok: false,
      reason: "not a registered season",
    });
  });

  it("plans from the fixture and reports without naming anyone", () => {
    const result = planSeason(season(), "season_51", competitions, "now");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.draft_count).toBe(3);
    expect(result.plan.excluded.after_premiere).toBe(1);
    expect(result.plan.summary.castaways[CAST[0]]?.adp).toBeCloseTo(4 / 3);

    const report = describePlan(result).join("\n");
    expect(report).toContain("US9001  ADP 1.3");
    expect(report).not.toMatch(/competition_|uid_|Private|league/);
  });
});
