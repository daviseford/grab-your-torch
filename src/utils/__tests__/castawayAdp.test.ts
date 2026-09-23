import { describe, expect, it } from "vitest";
import type { CastawayId } from "../../types";
import {
  type AdpCompetitionSource,
  type AdpPlanInput,
  ADP_COHORT,
  castawayAdpState,
  formatAdp,
  parseCastawayAdpSummary,
  planCastawayAdp,
  premiereCutoff,
  sortByAdp,
} from "../castawayAdp";
import { snakePickIndex } from "../draftRealtime";

const SEASON = "season_51" as const;
const CAST = Array.from(
  { length: 12 },
  (_, i) => `US${String(9000 + i)}` as CastawayId,
);
const [A, B, C, D, E, F] = CAST;
const PREMIERE = "2026-09-23";
const BEFORE = new Date("2026-09-20T18:00:00Z");

let nextId = 0;

/**
 * A promoted draft: castaways listed in the order they were picked, each
 * written at its one-based overall pick number exactly as the draft page
 * writes it, with the drafter chosen by the real snake-order helper.
 */
const draft = (
  pickedInOrder: CastawayId[],
  {
    participants = 2,
    createdAt = BEFORE,
    seasonId = SEASON,
    extra = {},
  }: {
    participants?: number;
    createdAt?: Date | null;
    seasonId?: string;
    extra?: Record<string, unknown>;
  } = {},
): AdpCompetitionSource => {
  const uids = Array.from({ length: participants }, (_, i) => `uid_${i}`);
  return {
    id: `competition_${nextId++}`,
    createdAt,
    data: {
      season_id: seasonId,
      participant_uids: uids,
      draft_picks: pickedInOrder.map((castaway_id, index) => ({
        season_id: seasonId,
        order: index + 1,
        user_uid: uids[snakePickIndex(index + 1, participants)],
        user_name: "someone",
        castaway_id,
        player_name: castaway_id,
      })),
      ...extra,
    },
  };
};

const plan = (
  competitions: AdpCompetitionSource[],
  overrides: Partial<AdpPlanInput> = {},
) =>
  planCastawayAdp({
    seasonId: SEASON,
    seasonNum: 51,
    castawayIds: CAST,
    premiereAirDate: PREMIERE,
    competitions,
    computedAt: "2026-09-21T00:00:00.000Z",
    minDrafts: 1,
    ...overrides,
  });

describe("planCastawayAdp", () => {
  it("uses the one-based overall pick, not the round or roster slot", () => {
    // Three drafters, two rounds of a snake: pick 4 is round two's first
    // pick and goes to the drafter who picked third in round one.
    const result = plan([draft([A, B, C, D, E, F], { participants: 3 })]);

    expect(result.summary.castaways[A]?.adp).toBe(1);
    expect(result.summary.castaways[C]?.adp).toBe(3);
    expect(result.summary.castaways[D]?.adp).toBe(4);
    expect(result.summary.castaways[F]?.adp).toBe(6);
  });

  it("orders picks by pick number, not by the order they are stored in", () => {
    const shuffled = draft([A, B, C, D]);
    (shuffled.data.draft_picks as unknown[]).reverse();

    expect(plan([shuffled]).summary.castaways[A]?.adp).toBe(1);
    expect(plan([shuffled]).summary.castaways[D]?.adp).toBe(4);
  });

  it("averages across drafts and reports sample size and range", () => {
    const result = plan([
      draft([A, B, C, D]),
      draft([B, A, D, C]),
      draft([C, B, A, D]),
    ]);

    expect(result.summary.draft_count).toBe(3);
    expect(result.summary.castaways[A]).toEqual({
      adp: 2,
      picks: 3,
      best: 1,
      worst: 3,
    });
    expect(result.summary.castaways[D]?.adp).toBeCloseTo(11 / 3);
  });

  it("averages only drafts that picked the castaway and omits the never-drafted", () => {
    // Five castaways, two drafters: the fifth goes undrafted each time.
    const result = plan([draft([A, B, C, D]), draft([E, A, B, C])]);

    expect(result.summary.castaways[A]).toMatchObject({ adp: 1.5, picks: 2 });
    expect(result.summary.castaways[D]).toMatchObject({ adp: 4, picks: 1 });
    expect(result.summary.castaways[F]).toBeUndefined();
  });

  it("keeps a returning castaway's seasons apart", () => {
    // One survivoR id across two seasons; each season is its own summary.
    const s51 = draft([A, B, C, D]);
    const s50 = draft([D, C, B, A], { seasonId: "season_50" });

    expect(plan([s51, s50]).summary.castaways[A]?.adp).toBe(1);
    expect(plan([s51, s50]).summary.draft_count).toBe(1);
    expect(
      plan([s51, s50], { seasonId: "season_50", seasonNum: 50 }).summary
        .castaways[A]?.adp,
    ).toBe(4);
  });

  it("excludes sample and e2e fixtures", () => {
    const result = plan([
      draft([A, B, C, D]),
      draft([D, C, B, A], { extra: { sample_fixture: true } }),
      draft([D, C, B, A], { extra: { e2e_fixture: true } }),
    ]);

    expect(result.summary.draft_count).toBe(1);
    expect(result.excluded.fixture).toBe(2);
    expect(result.summary.castaways[A]?.adp).toBe(1);
  });

  it("excludes drafts promoted at or after the premiere broadcast", () => {
    const cutoff = premiereCutoff(PREMIERE);
    const result = plan([
      draft([A, B, C, D]),
      draft([D, C, B, A], { createdAt: cutoff }),
      draft([D, C, B, A], { createdAt: new Date("2026-12-01T00:00:00Z") }),
      draft([D, C, B, A], { createdAt: null }),
    ]);

    expect(result.summary.draft_count).toBe(1);
    expect(result.excluded.after_premiere).toBe(2);
    expect(result.excluded.unknown_creation_time).toBe(1);
    expect(result.summary.castaways[A]?.adp).toBe(1);
  });

  it("skips partial or damaged drafts whole", () => {
    const zeroBased = draft([A, B, C, D]);
    (zeroBased.data.draft_picks as { order: number }[]).forEach((pick) => {
      pick.order -= 1;
    });
    const gap = draft([A, B, C, D]);
    (gap.data.draft_picks as unknown[]).splice(1, 1);
    const repeated = draft([A, B, A, D]);
    const offCast = draft([A, B, C, "US0001" as CastawayId]);
    const uneven = draft([A, B, C], { participants: 2 });
    const wrongSeason = draft([A, B, C, D]);
    (wrongSeason.data.draft_picks as { season_id: string }[])[0].season_id =
      "season_50";

    const result = plan([
      draft([A, B, C, D]),
      zeroBased,
      gap,
      repeated,
      offCast,
      uneven,
      wrongSeason,
      {
        id: "competition_empty",
        createdAt: BEFORE,
        data: { season_id: SEASON },
      },
    ]);

    expect(result.summary.draft_count).toBe(1);
    expect(result.excluded.invalid_picks).toBe(7);
  });

  it("ignores trades: ADP follows who was picked when, not current rosters", () => {
    const original = draft([A, B, C, D]);
    const traded = draft([A, B, C, D], {
      extra: {
        // Not how trades are stored (they live in a subcollection the job
        // never reads), but proves no trade-shaped field reaches the math.
        trades: [
          {
            status: "accepted",
            offered_castaway_ids: [A],
            requested_castaway_ids: [D],
            effective_episode: 2,
          },
        ],
      },
    });

    expect(plan([traded]).summary.castaways).toEqual(
      plan([original]).summary.castaways,
    );
  });

  it("withholds numbers below the minimum cohort size", () => {
    const result = plan([draft([A, B, C, D]), draft([A, B, C, D])], {
      minDrafts: 3,
    });

    expect(result.published).toBe(false);
    expect(result.summary.draft_count).toBe(2);
    expect(result.summary.castaways).toEqual({});
  });

  it("publishes an honest empty summary when nothing qualifies", () => {
    const result = plan([]);

    expect(result.summary).toMatchObject({
      cohort: ADP_COHORT,
      draft_count: 0,
      castaways: {},
    });
  });
});

describe("premiereCutoff", () => {
  it("lands at or before 8 PM Eastern on the air date in both DST states", () => {
    // 8 PM EDT = 00:00Z next day; 8 PM EST = 01:00Z next day.
    expect(premiereCutoff("2026-09-23").toISOString()).toBe(
      "2026-09-24T00:00:00.000Z",
    );
    expect(premiereCutoff("2026-02-25").toISOString()).toBe(
      "2026-02-26T00:00:00.000Z",
    );
    expect(premiereCutoff("2026-12-31").toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("rejects anything that is not a calendar date", () => {
    expect(() => premiereCutoff("")).toThrow();
    expect(() => premiereCutoff("2026-13-45")).toThrow();
  });
});

describe("reading a summary", () => {
  const summary = plan([draft([A, B, C, D])]).summary;

  it("treats a missing or foreign document as no data", () => {
    expect(parseCastawayAdpSummary(undefined)).toBeNull();
    expect(parseCastawayAdpSummary({ castaways: {} })).toBeNull();
    expect(
      parseCastawayAdpSummary({ ...summary, premiere_cutoff: "soon" }),
    ).toBeNull();
    expect(parseCastawayAdpSummary(summary)).toEqual(summary);
  });

  it("maps load state to what the draft page can honestly show", () => {
    expect(castawayAdpState(false, null)).toEqual({ kind: "loading" });
    expect(castawayAdpState(true, null)).toEqual({ kind: "unavailable" });
    const thin = { ...summary, draft_count: 1, min_drafts: 3 };
    expect(
      castawayAdpState(true, thin, new Date("2026-09-20T00:00:00Z")),
    ).toEqual({ kind: "too_few", draftCount: 1, minDrafts: 3, closed: false });
    // After the premiere no more drafts can qualify, so the copy must not
    // promise numbers that will never come.
    expect(
      castawayAdpState(true, thin, new Date("2026-09-24T00:00:00Z")),
    ).toMatchObject({ kind: "too_few", closed: true });
    expect(castawayAdpState(true, summary)).toEqual({
      kind: "ready",
      summary,
    });
  });

  it("formats to one decimal", () => {
    expect(formatAdp(1)).toBe("1.0");
    expect(formatAdp(11 / 3)).toBe("3.7");
  });

  it("sorts earliest ADP first, undrafted last, ties in existing order", () => {
    const players = [F, E, D, C, B, A].map((castaway_id) => ({ castaway_id }));
    const castaways = {
      [A]: { adp: 3, picks: 1, best: 3, worst: 3 },
      [B]: { adp: 1.5, picks: 1, best: 1, worst: 2 },
      [C]: { adp: 3, picks: 1, best: 3, worst: 3 },
    };

    expect(sortByAdp(players, castaways).map((p) => p.castaway_id)).toEqual([
      B,
      C,
      A,
      F,
      E,
      D,
    ]);
  });
});
