import { describe, expect, it } from "vitest";
import type { CastawayId } from "../../types";
import {
  type AdpCompetitionSource,
  type AdpPlanInput,
  adpSummaryFingerprint,
  allDraftsOffered,
  type AllDraftsOptIn,
  allDraftsOptInFor,
  allDraftsOptInKey,
  castawayAdpState,
  formatAdp,
  MIN_ADP_CREATORS,
  MIN_ADP_DRAFTS,
  parseCastawayAdpSummary,
  planCastawayAdp,
  premiereCutoff,
  sortByAdp,
} from "../castawayAdp";
import { accountsFor, BEFORE_PREMIERE, promoted } from "./castawayAdpFixtures";

const SEASON = "season_51" as const;
const CAST = Array.from(
  { length: 12 },
  (_, i) => `US${String(9000 + i)}` as CastawayId,
);
const [A, B, C, D, E, F] = CAST;
const PREMIERE = "2026-09-23";
const CUTOFF = premiereCutoff(PREMIERE);
const AFTER = new Date("2026-10-01T00:00:00Z");

/** Plans with thresholds of one so the math tests can use tiny cohorts. */
const plan = (
  competitions: AdpCompetitionSource[],
  overrides: Partial<AdpPlanInput> = {},
) =>
  planCastawayAdp({
    seasonId: SEASON,
    seasonNum: 51,
    cohort: "pre_premiere",
    castawayIds: CAST,
    premiereAirDate: PREMIERE,
    competitions,
    accounts: accountsFor(competitions),
    computedAt: "2026-09-21T00:00:00.000Z",
    minDrafts: 1,
    minCreators: 1,
    ...overrides,
  });

type PickRecord = {
  order: number;
  castaway_id: string;
  season_id: string;
  user_uid: string;
};

/** Apply the same damage to the competition's picks and its source draft's. */
const damageBoth = (
  source: AdpCompetitionSource,
  damage: (picks: PickRecord[]) => PickRecord[] | void,
): AdpCompetitionSource => {
  const picks = source.data.draft_picks as PickRecord[];
  const damaged = damage(picks) ?? picks;
  source.data.draft_picks = damaged;
  source.sourceDraft!.draft_picks = damaged.map((pick) => ({ ...pick }));
  return source;
};

describe("planCastawayAdp: the average", () => {
  it("uses the one-based overall pick, not the round or roster slot", () => {
    // Three drafters, two rounds of a snake: pick 4 is round two's first
    // pick and goes to the drafter who picked third in round one.
    const result = plan([promoted([A, B, C, D, E, F], { participants: 3 })]);

    expect(result.summary.castaways[A]?.adp).toBe(1);
    expect(result.summary.castaways[C]?.adp).toBe(3);
    expect(result.summary.castaways[D]?.adp).toBe(4);
    expect(result.summary.castaways[F]?.adp).toBe(6);
  });

  it("orders picks by pick number, not by the order they are stored in", () => {
    const shuffled = promoted([A, B, C, D]);
    (shuffled.data.draft_picks as unknown[]).reverse();

    expect(plan([shuffled]).summary.castaways[A]?.adp).toBe(1);
    expect(plan([shuffled]).summary.castaways[D]?.adp).toBe(4);
  });

  it("averages across drafts with the sample size and no per-draft extremes", () => {
    const result = plan([
      promoted([A, B, C, D]),
      promoted([B, A, D, C]),
      promoted([C, B, A, D]),
    ]);

    expect(result.summary.draft_count).toBe(3);
    expect(result.summary.castaways[A]).toEqual({ adp: 2, picks: 3 });
    expect(result.summary.castaways[D]?.adp).toBeCloseTo(11 / 3);
  });

  it("averages only drafts that picked the castaway and omits the never-drafted", () => {
    // Five castaways, two drafters: the fifth goes undrafted each time.
    const result = plan([promoted([A, B, C, D]), promoted([E, A, B, C])]);

    expect(result.summary.castaways[A]).toEqual({ adp: 1.5, picks: 2 });
    expect(result.summary.castaways[D]).toEqual({ adp: 4, picks: 1 });
    expect(result.summary.castaways[F]).toBeUndefined();
  });

  it("keeps a returning castaway's seasons apart", () => {
    const s51 = promoted([A, B, C, D]);
    const s50 = promoted([D, C, B, A], { seasonId: "season_50" });

    expect(plan([s51, s50]).summary.castaways[A]?.adp).toBe(1);
    expect(plan([s51, s50]).summary.draft_count).toBe(1);
    expect(
      plan([s51, s50], { seasonId: "season_50", seasonNum: 50 }).summary
        .castaways[A]?.adp,
    ).toBe(4);
  });

  it("ignores trades: ADP follows who was picked when, not current rosters", () => {
    const original = promoted([A, B, C, D]);
    const traded = promoted([A, B, C, D], {
      extra: {
        // Not how trades are stored (they live in a subcollection the job
        // never reads), but proves no trade-shaped field reaches the math.
        trades: [{ status: "accepted", offered_castaway_ids: [A] }],
      },
    });

    expect(plan([traded]).summary.castaways).toEqual(
      plan([original]).summary.castaways,
    );
  });
});

describe("planCastawayAdp: cohorts", () => {
  const sources = () => [
    promoted([A, B, C, D]),
    promoted([D, C, B, A], { createdAt: CUTOFF }),
    promoted([D, C, B, A], { createdAt: AFTER }),
    promoted([D, C, B, A], { createdAt: null }),
  ];

  it("pre-premiere counts only drafts saved strictly before the cutoff", () => {
    const result = plan(sources());

    expect(result.summary).toMatchObject({
      cohort: "pre_premiere",
      draft_count: 1,
      premiere_cutoff: "2026-09-24T00:00:00.000Z",
    });
    expect(result.excluded.after_premiere).toBe(2);
    expect(result.excluded.unknown_creation_time).toBe(1);
    expect(result.summary.castaways[A]?.adp).toBe(1);
  });

  it("the boundary is the save time, not when the draft finished", () => {
    // Finished at 7:50 PM ET but saved as a competition after 8 PM: out.
    const lateSave = promoted([A, B, C, D], {
      createdAt: new Date("2026-09-24T00:05:00Z"),
    });
    const justBefore = promoted([B, A, C, D], {
      createdAt: new Date("2026-09-23T23:59:59Z"),
    });
    const result = plan([lateSave, justBefore]);
    expect(result.summary.draft_count).toBe(1);
    expect(result.summary.castaways[A]?.adp).toBe(2);
  });

  it("all-drafts counts every qualifying draft regardless of timing", () => {
    const result = plan(sources(), { cohort: "all_drafts" });

    expect(result.summary).toMatchObject({
      cohort: "all_drafts",
      draft_count: 3,
      premiere_cutoff: null,
    });
    expect(result.excluded.unknown_creation_time).toBe(1);
    expect(result.summary.castaways[A]?.adp).toBeCloseTo((1 + 4 + 4) / 3);
  });

  it("all-drafts needs no premiere date; pre-premiere refuses without one", () => {
    expect(
      plan(sources(), { cohort: "all_drafts", premiereAirDate: null }).summary
        .draft_count,
    ).toBe(3);
    expect(() => plan(sources(), { premiereAirDate: null })).toThrow();
  });

  it("pre-premiere fails closed: a record written since the cutoff, or of unknown write time, is out", () => {
    const sources = () => [
      promoted([A, B, C, D]),
      promoted([B, A, C, D], { updatedAt: AFTER }),
      promoted([C, A, B, D], { updatedAt: CUTOFF }),
      promoted([D, A, B, C], { updatedAt: null }),
      promoted([A, C, B, D], {
        updatedAt: new Date(CUTOFF.getTime() - 1),
      }),
    ];
    const result = plan(sources());
    expect(result.summary.draft_count).toBe(2);
    expect(result.excluded.edited_after_premiere).toBe(2);
    expect(result.excluded.unknown_update_time).toBe(1);
    expect(result.summary.castaways[A]?.adp).toBe(1);
    expect(result.summary).not.toHaveProperty("sealed_count");

    // All drafts keeps them: it is opt-in and says it may reflect results.
    const all = plan(sources(), { cohort: "all_drafts" });
    expect(all.summary.draft_count).toBe(5);
    expect(all.excluded.edited_after_premiere).toBe(0);
    expect(all.excluded.unknown_update_time).toBe(0);
  });

  it("keeps hindsight out: a legacy record repointed at a forged draft after the premiere is not counted", () => {
    // The D1 review's repro, as the job would read it back: saved before the
    // premiere, then (under the old rules) repointed by its creator at a
    // finished draft written after the premiere, with the picks swapped for
    // hindsight picks. Record and source agree, so every other check passes.
    const honest = Array.from({ length: 10 }, (_, i) =>
      promoted([A, B, C, D], {
        uids: [`uid_creator_${i}`, `uid_partner_${i}`],
      }),
    );
    const forged = promoted([D, C, B, A], {
      uids: ["uid_alice", "uid_bob"],
      createdAt: new Date("2026-09-20T00:00:00Z"),
      updatedAt: new Date("2026-09-30T00:00:00Z"),
    });
    const sources = [...honest, forged];
    const thresholds = {
      minDrafts: MIN_ADP_DRAFTS,
      minCreators: MIN_ADP_CREATORS,
    };

    const result = plan(sources, thresholds);
    expect(result.summary.draft_count).toBe(10);
    expect(result.excluded.edited_after_premiere).toBe(1);
    expect(result.summary.castaways[D]).toEqual({ adp: 4, picks: 10 });
    expect(Object.values(result.excluded).reduce((a, b) => a + b)).toBe(1);

    // It would otherwise have counted, and moved D's average.
    const all = plan(sources, { ...thresholds, cohort: "all_drafts" });
    expect(all.summary.draft_count).toBe(11);
    expect(all.summary.castaways[D]?.adp).toBeCloseTo(41 / 11);
  });
});

describe("planCastawayAdp: integrity", () => {
  it("excludes sample and e2e fixtures", () => {
    const result = plan([
      promoted([A, B, C, D]),
      promoted([D, C, B, A], { extra: { sample_fixture: true } }),
      promoted([D, C, B, A], { extra: { e2e_fixture: true } }),
    ]);

    expect(result.summary.draft_count).toBe(1);
    expect(result.excluded.fixture).toBe(2);
  });

  it("rejects one-person and repeated-person drafts", () => {
    const solo = promoted([A, B], { participants: 1 });
    const repeated = promoted([A, B, C, D], { uids: ["uid_x", "uid_x"] });
    const result = plan([promoted([A, B, C, D]), solo, repeated]);

    expect(result.summary.draft_count).toBe(1);
    expect(result.excluded.solo).toBe(2);
  });

  it("skips partial or damaged drafts whole", () => {
    const damaged = [
      damageBoth(promoted([A, B, C, D]), (picks) =>
        picks.forEach((pick) => (pick.order -= 1)),
      ),
      damageBoth(promoted([A, B, C, D]), (picks) => {
        picks.splice(1, 1);
      }),
      promoted([A, B, A, D]),
      promoted([A, B, C, "US0001" as CastawayId]),
      promoted([A, B, C]),
      damageBoth(promoted([A, B, C, D]), (picks) => {
        picks[0].season_id = "season_50";
      }),
      // A pick credited to someone outside the draft.
      damageBoth(promoted([A, B, C, D]), (picks) => {
        picks[0].user_uid = "uid_outsider";
      }),
      // One drafter holding three picks and the other one.
      damageBoth(promoted([A, B, C, D]), (picks) => {
        picks[1].user_uid = picks[0].user_uid;
      }),
      {
        id: "competition_empty",
        createdAt: BEFORE_PREMIERE,
        updatedAt: BEFORE_PREMIERE,
        data: { season_id: SEASON, participant_uids: ["uid_p", "uid_q"] },
        sourceDraft: null,
      },
    ];
    const result = plan([promoted([A, B, C, D]), ...damaged]);

    expect(result.summary.draft_count).toBe(1);
    expect(result.excluded.invalid_picks).toBe(damaged.length);
  });

  it("requires the draft the competition says it came from", () => {
    const missing = promoted([A, B, C, D]);
    missing.sourceDraft = null;
    const result = plan([promoted([A, B, C, D]), missing]);

    expect(result.excluded.no_source_draft).toBe(1);
    expect(result.summary.draft_count).toBe(1);
  });

  it("rejects a competition that disagrees with its source draft", () => {
    const cases: ((source: AdpCompetitionSource) => void)[] = [
      // Picks rewritten on the competition after the draft finished.
      (s) => {
        const picks = s.data.draft_picks as PickRecord[];
        [picks[0].castaway_id, picks[3].castaway_id] = [
          picks[3].castaway_id,
          picks[0].castaway_id,
        ];
      },
      // Source draft never finished.
      (s) => {
        s.sourceDraft!.state = { started: true, finished: false };
      },
      // Different people.
      (s) => {
        s.sourceDraft!.participants = { uid_other: { uid: "uid_other" } };
      },
      // A different draft, season, creator, or competition.
      (s) => {
        s.sourceDraft!.id = "draft_elsewhere";
      },
      (s) => {
        s.sourceDraft!.season_id = "season_50";
      },
      (s) => {
        s.sourceDraft!.creator_uid = "uid_other";
      },
      (s) => {
        s.sourceDraft!.competiton_id = "competition_elsewhere";
      },
      // A pick made out of turn.
      (s) => {
        const turns = s.sourceDraft!.turns as Record<string, string>;
        [turns["1"], turns["2"]] = [turns["2"], turns["1"]];
      },
    ];
    const bad = cases.map((mutate) => {
      const source = promoted([A, B, C, D]);
      mutate(source);
      return source;
    });
    const result = plan([promoted([A, B, C, D]), ...bad]);

    expect(result.excluded.source_mismatch).toBe(cases.length);
    expect(result.summary.draft_count).toBe(1);
  });

  it("accepts legacy source drafts stored as arrays without a turn map", () => {
    const legacy = promoted([A, B, C, D]);
    const source = legacy.sourceDraft!;
    source.draft_picks = [null, ...(legacy.data.draft_picks as unknown[])];
    source.participants = Object.values(
      source.participants as Record<string, unknown>,
    );
    delete source.turns;
    delete source.competiton_id;

    expect(plan([legacy]).summary.draft_count).toBe(1);
  });

  it("requires every participant to be a real account older than the save", () => {
    const fake = promoted([A, B, C, D]);
    const young = promoted([B, A, C, D]);
    const accounts = new Map(accountsFor([fake, young]));
    accounts.delete((fake.data.participant_uids as string[])[1]);
    accounts.set((young.data.participant_uids as string[])[0], AFTER);

    const result = plan([fake, young], { accounts });
    expect(result.excluded.unverified_participants).toBe(2);
    expect(result.summary.draft_count).toBe(0);
  });

  it("counts the same group, or one creator repeating a board, once", () => {
    const group = ["uid_g1", "uid_g2"];
    const first = promoted([A, B, C, D], { uids: group });
    const again = promoted([D, C, B, A], {
      uids: [...group].reverse(),
      createdAt: new Date(BEFORE_PREMIERE.getTime() + 1000),
    });
    const board = promoted([A, B, C, D], {
      uids: ["uid_g1", "uid_g3"],
      createdAt: new Date(BEFORE_PREMIERE.getTime() + 2000),
    });
    const result = plan([again, first, board]);

    expect(result.excluded.duplicate).toBe(2);
    expect(result.summary.draft_count).toBe(1);
    // The earliest copy stands.
    expect(result.summary.castaways[A]?.adp).toBe(1);
  });
});

describe("planCastawayAdp: thresholds", () => {
  // Orders of B, C, D; a creator repeating a board would count once.
  const TAILS = [
    [B, C, D],
    [B, D, C],
    [C, B, D],
    [C, D, B],
    [D, B, C],
    [D, C, B],
  ];
  /** `drafts` drafts by `creators` distinct creators, A always first. */
  const cohort = (drafts: number, creators: number) =>
    Array.from({ length: drafts }, (_, i) =>
      promoted([A, ...TAILS[Math.floor(i / creators)]], {
        uids: [`uid_creator_${i % creators}`, `uid_partner_${i}`],
      }),
    );
  const planDefault = (sources: AdpCompetitionSource[]) =>
    plan(sources, {
      minDrafts: MIN_ADP_DRAFTS,
      minCreators: MIN_ADP_CREATORS,
    });

  it("uses Davis's defaults: 10 drafts from 5 creators", () => {
    expect(MIN_ADP_DRAFTS).toBe(10);
    expect(MIN_ADP_CREATORS).toBe(5);
  });

  it("publishes a castaway at exactly 10 drafts from 5 creators", () => {
    const result = planDefault(cohort(10, 5));
    expect(result.published).toBe(true);
    expect(result.summary.castaways[A]).toEqual({ adp: 1, picks: 10 });
    expect(result.summary).toMatchObject({ min_drafts: 10, min_creators: 5 });
  });

  it("withholds at 9 drafts, or at 10 drafts from only 4 creators", () => {
    for (const sources of [cohort(9, 5), cohort(10, 4)]) {
      const result = planDefault(sources);
      expect(result.published).toBe(false);
      expect(result.summary.castaways).toEqual({});
      expect(result.withheld).toBe(4);
      expect(result.summary.draft_count).toBe(sources.length);
    }
  });

  it("withholds only the castaways below the threshold", () => {
    const sources = cohort(10, 5);
    // One more draft picks E; E has 1 pick and stays hidden.
    sources.push(promoted([E, A, B, C], { uids: ["uid_new", "uid_newer"] }));
    const result = planDefault(sources);
    expect(result.summary.castaways[A]?.picks).toBe(11);
    expect(result.summary.castaways[E]).toBeUndefined();
    expect(result.summary.castaways[D]?.picks).toBe(10);
    expect(result.withheld).toBe(1);
  });

  it("publishes no field that identifies a draft, a group, or a person", () => {
    const summary = planDefault(cohort(10, 5)).summary;
    const text = JSON.stringify(summary);
    expect(text).not.toMatch(/uid_|competition_|draft_\d|someone/);
    for (const stat of Object.values(summary.castaways)) {
      expect(Object.keys(stat!).sort()).toEqual(["adp", "picks"]);
    }
  });

  it("publishes an honest empty summary when nothing qualifies", () => {
    expect(plan([]).summary).toMatchObject({
      cohort: "pre_premiere",
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

describe("adpSummaryFingerprint", () => {
  it("ignores computed_at and key order, and sees any content change", () => {
    const summary = plan([promoted([A, B, C, D])]).summary;
    const later = { ...summary, computed_at: "2027-01-01T00:00:00.000Z" };
    const reordered = Object.fromEntries(Object.entries(summary).reverse());

    expect(adpSummaryFingerprint(later)).toBe(adpSummaryFingerprint(summary));
    expect(adpSummaryFingerprint(reordered)).toBe(
      adpSummaryFingerprint(summary),
    );
    expect(adpSummaryFingerprint({ ...summary, draft_count: 2 })).not.toBe(
      adpSummaryFingerprint(summary),
    );
  });
});

describe("reading a summary", () => {
  /** What the job publishes at the real thresholds: 10 drafts, 5 creators. */
  const published = (cohort: "pre_premiere" | "all_drafts") =>
    plan(
      Array.from({ length: 12 }, (_, i) =>
        promoted(i % 2 ? [A, B, C, D] : [B, A, D, C], {
          uids: [`uid_creator_${i}`, `uid_partner_${i}`],
        }),
      ),
      { cohort, minDrafts: MIN_ADP_DRAFTS, minCreators: MIN_ADP_CREATORS },
    ).summary;
  const summary = published("pre_premiere");
  const allDrafts = published("all_drafts");
  const CAST_SIZE = CAST.length;
  const read = (raw: unknown, cohort: "pre_premiere" | "all_drafts") =>
    parseCastawayAdpSummary(raw, cohort, CAST_SIZE);

  it("round-trips what the job publishes, per cohort", () => {
    expect(Object.keys(summary.castaways)).toHaveLength(4);
    expect(read(summary, "pre_premiere")).toEqual(summary);
    expect(read(allDrafts, "all_drafts")).toEqual(allDrafts);
  });

  it("treats a missing, foreign, or other-cohort document as no data", () => {
    expect(read(undefined, "pre_premiere")).toBeNull();
    expect(read([], "pre_premiere")).toBeNull();
    expect(read({ castaways: {} }, "pre_premiere")).toBeNull();
    expect(read(summary, "all_drafts")).toBeNull();
    expect(read(allDrafts, "pre_premiere")).toBeNull();
    for (const broken of [
      { premiere_cutoff: "soon" },
      { draft_count: "3" },
      { draft_count: -1 },
      { draft_count: 1.5 },
      { min_drafts: null },
      { min_creators: "5" },
      { computed_at: 5 },
      { season_id: "US0001" },
      { castaways: null },
      { castaways: [] },
    ]) {
      expect(read({ ...summary, ...broken }, "pre_premiere")).toBeNull();
    }
    // Without a real cast size nothing can be bounded, so nothing is read.
    expect(parseCastawayAdpSummary(summary, "pre_premiere", 0)).toBeNull();
    expect(parseCastawayAdpSummary(summary, "pre_premiere", 2.5)).toBeNull();
  });

  it("refuses a summary claiming thresholds below the published policy", () => {
    for (const lowered of [
      { min_drafts: MIN_ADP_DRAFTS - 1 },
      { min_drafts: 0 },
      { min_creators: MIN_ADP_CREATORS - 1 },
      { min_creators: 1 },
    ]) {
      expect(read({ ...summary, ...lowered }, "pre_premiere")).toBeNull();
      expect(read({ ...allDrafts, ...lowered }, "all_drafts")).toBeNull();
    }
    // A stricter summary is still read, at its own stricter draft threshold.
    const stricter = read(
      {
        ...summary,
        draft_count: 20,
        min_drafts: 15,
        min_creators: 8,
        castaways: {
          [A]: { adp: 2, picks: 15 },
          [B]: { adp: 3, picks: 14 },
        },
      },
      "pre_premiere",
    );
    expect(stricter?.castaways).toEqual({ [A]: { adp: 2, picks: 15 } });
  });

  it("drops malformed, below-threshold, and impossible castaway entries instead of crashing the draft page", () => {
    const parsed = read(
      {
        ...summary,
        draft_count: 20,
        castaways: {
          [A]: { adp: 1.5, picks: 12 },
          [B]: { adp: "3", picks: 12 },
          [C]: { adp: Number.NaN, picks: 12 },
          [D]: { adp: 2 },
          [E]: { adp: 0.5, picks: 12 },
          [F]: { adp: 2, picks: 21 },
          US9006: null,
          US9007: { adp: Infinity, picks: 12 },
          // Below the 10-draft threshold, though the shape is fine.
          US9008: { adp: 4, picks: 9 },
          US9009: { adp: 4, picks: 1 },
          // Later than the last possible pick in a 12-castaway season.
          US9010: { adp: CAST_SIZE + 0.5, picks: 12 },
          US9011: { adp: CAST_SIZE, picks: 12 },
        },
      },
      "pre_premiere",
    );
    expect(parsed?.castaways).toEqual({
      [A]: { adp: 1.5, picks: 12 },
      US9011: { adp: CAST_SIZE, picks: 12 },
    });
    // And the survivors format and sort without throwing.
    expect(formatAdp(parsed!.castaways[A]!.adp)).toBe("1.5");
  });

  it("maps load state to what the draft page can honestly show", () => {
    expect(castawayAdpState(false, null)).toEqual({ kind: "loading" });
    expect(castawayAdpState(true, null)).toEqual({ kind: "unavailable" });
    const thin = { ...summary, castaways: {} };
    expect(
      castawayAdpState(true, thin, new Date("2026-09-20T00:00:00Z")),
    ).toEqual({ kind: "too_few", summary: thin, closed: false });
    // After the premiere no more drafts can qualify, so the copy must not
    // promise numbers that will never come.
    expect(
      castawayAdpState(true, thin, new Date("2026-09-24T00:00:00Z")),
    ).toMatchObject({ kind: "too_few", closed: true });
    // All-drafts never closes.
    expect(
      castawayAdpState(
        true,
        { ...allDrafts, castaways: {} },
        new Date("2030-01-01T00:00:00Z"),
      ),
    ).toMatchObject({ kind: "too_few", closed: false });
    expect(castawayAdpState(true, summary)).toEqual({
      kind: "ready",
      summary,
    });
  });

  it("offers the all-drafts opt-in only once the premiere has aired", () => {
    const before = new Date("2026-09-23T12:00:00Z");
    const after = new Date("2026-09-24T00:00:00Z");
    const ready = castawayAdpState(true, summary);
    expect(allDraftsOffered({ kind: "loading" }, after)).toBe(false);
    expect(allDraftsOffered(ready, before)).toBe(false);
    expect(allDraftsOffered(ready, after)).toBe(true);
    expect(allDraftsOffered({ kind: "unavailable" }, before)).toBe(true);
  });

  it("clears the opt-in on any change of season or account, even back again", () => {
    const S51 = allDraftsOptInKey("season_51", "uid_a");
    const S50 = allDraftsOptInKey("season_50", "uid_a");
    const confirmed: AllDraftsOptIn = { key: S51, on: true };

    // Same key: untouched, and the same object so the page does not re-set it.
    expect(allDraftsOptInFor(confirmed, S51)).toBe(confirmed);

    // Season A, then B, then A again: off on return.
    const inB = allDraftsOptInFor(confirmed, S50);
    expect(inB).toEqual({ key: S50, on: false });
    expect(allDraftsOptInFor(inB, S51)).toEqual({ key: S51, on: false });

    // Signing out and back in as the same account: off.
    const signedOut = allDraftsOptInFor(confirmed, null);
    expect(signedOut).toEqual({ key: null, on: false });
    expect(allDraftsOptInFor(signedOut, S51)).toEqual({ key: S51, on: false });

    // Another account on the same season: off.
    expect(
      allDraftsOptInFor(confirmed, allDraftsOptInKey("season_51", "uid_b")),
    ).toEqual({ key: "season_51:uid_b", on: false });
  });

  it("binds an all-drafts opt-in to one season and one account", () => {
    const confirmed = allDraftsOptInKey("season_51", "uid_a");
    expect(confirmed).not.toBeNull();
    expect(allDraftsOptInKey("season_51", "uid_a")).toBe(confirmed);
    // Another season or another account no longer matches, so the page
    // falls back to pre-premiere numbers.
    expect(allDraftsOptInKey("season_50", "uid_a")).not.toBe(confirmed);
    expect(allDraftsOptInKey("season_51", "uid_b")).not.toBe(confirmed);
    // Signed out, or before the season loads, nothing can match.
    expect(allDraftsOptInKey("season_51", undefined)).toBeNull();
    expect(allDraftsOptInKey(undefined, "uid_a")).toBeNull();
  });

  it("formats to one decimal", () => {
    expect(formatAdp(1)).toBe("1.0");
    expect(formatAdp(11 / 3)).toBe("3.7");
  });

  it("sorts earliest ADP first, withheld last, ties in existing order", () => {
    const players = [F, E, D, C, B, A].map((castaway_id) => ({ castaway_id }));
    const castaways = {
      [A]: { adp: 3, picks: 1 },
      [B]: { adp: 1.5, picks: 1 },
      [C]: { adp: 3, picks: 1 },
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
