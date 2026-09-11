import { describe, expect, it } from "vitest";
import { PropBetQuestionKeys } from "../../src/data/propbets";
import { SCORING_REVISION } from "../../src/data/scoringRevision.generated";
import type {
  CastawayId,
  Challenge,
  Elimination,
  Episode,
  FirestoreTimestamp,
  GameEvent,
  Pool,
  PoolPick,
} from "../../src/types";
import { rankPoolEntries } from "../../src/utils/poolRanking";
import { getSeasonPointsByCastaway } from "../../src/utils/seasonPoints";
import {
  RecomputeRefusal,
  applyStandingsWrites,
  buildJobSummary,
  buildStandingsWrites,
  clusterIdenticalEntries,
  createFixtureDb,
  latestEpisodeWithData,
  loadPoolStandingsInputs,
  planRecompute,
  poolStandingsDocId,
  sanitizePropBetAnswers,
  type RecomputeEntry,
  type RecomputeInput,
  type StandingsWrite,
} from "../recompute-pool-standings.js";
import type { ReadableDb, ReadableNode } from "../snapshot-firestore.js";

/* ------------------------------------------------------------------ *
 * Fixtures
 *
 * A four-castaway pool with two picks per entry. Point values come from
 * src/data/scoring.ts: immunity 3, find_idol 1, eliminated = episode_num.
 * ------------------------------------------------------------------ */

const SEASON_ID = "season_99" as const;
const POOL_ID = "pool_season_99";

const id = (raw: string) => raw as CastawayId;

const ADA = { castaway_id: id("US9001"), full_name: "Ada Nolan" };
const BEN = { castaway_id: id("US9002"), full_name: "Ben Ortiz" };
const CASS = { castaway_id: id("US9003"), full_name: "Cass Lin" };
const DEV = { castaway_id: id("US9004"), full_name: "Dev Rao" };

const ROSTER: PoolPick[] = [ADA, BEN, CASS, DEV];

const ts = (isoDate: string): FirestoreTimestamp => {
  const date = new Date(isoDate);
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => date,
  };
};

const FREEZE_AT = ts("2026-09-23T20:00:00-04:00");

const episode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: SEASON_ID,
  season_num: 99,
  order,
  name: `Episode ${order}`,
  finale: false,
  post_merge: order >= 7,
  merge_occurs: order === 7,
});

const episodes = (count: number): Episode[] =>
  Array.from({ length: count }, (_, i) => episode(i + 1));

const immunity = (episodeNum: number, winner: CastawayId): Challenge => ({
  id: `challenge_imm_${episodeNum}_${winner}`,
  season_id: SEASON_ID,
  season_num: 99,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  order: 1,
  variant: "immunity",
  winning_castaways: [winner],
});

const boot = (episodeNum: number, castaway: CastawayId): Elimination => ({
  id: `elimination_${episodeNum}`,
  season_id: SEASON_ID,
  season_num: 99,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  castaway_id: castaway,
  order: 1,
  variant: "tribal",
});

const idolFind = (episodeNum: number, castaway: CastawayId): GameEvent => ({
  id: `event_idol_${episodeNum}_${castaway}`,
  season_id: SEASON_ID,
  season_num: 99,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  action: "find_idol",
  multiplier: null,
  castaway_id: castaway,
});

const winSurvivor = (episodeNum: number, castaway: CastawayId): GameEvent => ({
  id: `event_win_${episodeNum}`,
  season_id: SEASON_ID,
  season_num: 99,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  action: "win_survivor",
  multiplier: null,
  castaway_id: castaway,
});

const pool = (overrides: Partial<Pool> = {}): RecomputeInput["pool"] => ({
  id: "pool_season_99",
  season_id: SEASON_ID,
  season_num: 99,
  name: "Survivor 99 Season Pool",
  freeze_at: FREEZE_AT,
  roster: ROSTER,
  picks_per_entry: 2,
  prop_bet_keys: [...PropBetQuestionKeys],
  prop_bet_answers: [...ROSTER.map((pick) => pick.castaway_id), "Yes", "No"],
  status: "closed",
  display_mode: "full",
  latest_episode_num: null,
  season_complete: false,
  ...overrides,
});

const entry = (
  uid: string,
  handle: string,
  picks: PoolPick[],
  prop_bets: Record<string, unknown> = {},
): RecomputeEntry => ({ uid, handle, picks, prop_bets });

/**
 * The hand-computed fixture.
 *
 * Episode 1: Ada wins immunity (3). Dev is booted (1).
 * Episode 2: Ben wins immunity (3) and finds an idol (1).
 * Episode 3: Cass finds an idol (1). Ben is booted (3, the episode number).
 *
 * Cumulative per castaway:
 *   after ep1 -> Ada 3, Ben 0, Cass 0, Dev 1
 *   after ep2 -> Ada 3, Ben 4, Cass 0, Dev 1
 *   after ep3 -> Ada 3, Ben 7, Cass 1, Dev 1
 *
 * So alpha (Ada + Ben) reads 3, 7, 10 and bravo (Cass + Dev) reads 1, 1, 2.
 */
const HAND_DATA = () => ({
  episodes: episodes(3),
  challenges: [immunity(1, ADA.castaway_id), immunity(2, BEN.castaway_id)],
  eliminations: [boot(1, DEV.castaway_id), boot(3, BEN.castaway_id)],
  events: [idolFind(2, BEN.castaway_id), idolFind(3, CASS.castaway_id)],
});

const input = (overrides: Partial<RecomputeInput> = {}): RecomputeInput => ({
  pool: pool(),
  entries: [
    entry("uid_a", "alpha", [ADA, BEN]),
    entry("uid_b", "bravo", [CASS, DEV]),
  ],
  data: HAND_DATA(),
  revisions: { data_revision: "rev_1", scoring_revision: SCORING_REVISION },
  existingStandings: [],
  computedAt: "2026-10-01T00:00:00.000Z",
  force: false,
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * Episode ordering, including the episode-10 trap
 * ------------------------------------------------------------------ */

describe("episode ordering", () => {
  it("names standings documents by episode number", () => {
    expect(poolStandingsDocId(1)).toBe("episode_1");
    expect(poolStandingsDocId(10)).toBe("episode_10");
  });

  it("finds the newest episode numerically, not lexicographically", () => {
    const data = {
      episodes: episodes(13),
      challenges: [immunity(10, ADA.castaway_id)],
      eliminations: [boot(2, DEV.castaway_id)],
      events: [],
    };
    expect(latestEpisodeWithData(data)).toBe(10);
  });

  it("returns null when no result record exists yet", () => {
    expect(
      latestEpisodeWithData({
        episodes: episodes(13),
        challenges: [],
        eliminations: [],
        events: [],
      }),
    ).toBeNull();
  });

  it("never reports an episode the season document does not have", () => {
    expect(
      latestEpisodeWithData({
        episodes: episodes(2),
        challenges: [immunity(9, ADA.castaway_id)],
        eliminations: [],
        events: [],
      }),
    ).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * Scoring and ranking
 * ------------------------------------------------------------------ */

describe("planRecompute scoring", () => {
  it("matches the hand-computed fixture at every episode", () => {
    const plan = planRecompute(input());
    expect(plan.status).toBe("ok");

    const totals = (episodeNum: number) =>
      Object.fromEntries(
        plan.episodes
          .find((e) => e.episode_num === episodeNum)!
          .summary.rows.map((r) => [r.handle, r.total]),
      );

    // alpha = Ada + Ben, bravo = Cass + Dev
    expect(totals(1)).toEqual({ alpha: 3, bravo: 1 });
    expect(totals(2)).toEqual({ alpha: 7, bravo: 1 });
    expect(totals(3)).toEqual({ alpha: 10, bravo: 2 });
  });

  it("scores two entrants with identical rosters identically", () => {
    const plan = planRecompute(
      input({
        entries: [
          entry("uid_a", "alpha", [ADA, BEN]),
          entry("uid_z", "zulu", [BEN, ADA]),
        ],
      }),
    );

    const rows = plan.episodes.at(-1)!.summary.rows;
    expect(rows.map((r) => r.total)).toEqual([10, 10]);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });

  it("orders rows exactly as rankPoolEntries does for the same inputs", () => {
    const entries = [
      entry("uid_b", "bravo", [CASS, DEV]),
      entry("uid_a", "alpha", [ADA, BEN]),
      entry("uid_c", "charlie", [ADA, CASS]),
    ];
    const plan = planRecompute(input({ entries }));

    const data = HAND_DATA();
    const expected = rankPoolEntries(
      entries.map((e) => ({ uid: e.uid, handle: e.handle, picks: e.picks })),
      getSeasonPointsByCastaway(
        data.challenges,
        data.eliminations,
        data.events,
        data.episodes,
        ROSTER.map((r) => r.castaway_id),
      ),
      {},
    );

    const rows = plan.episodes.at(-1)!.summary.rows;
    expect(rows.map((r) => r.handle)).toEqual(expected.map((r) => r.handle));
    expect(rows.map((r) => r.total)).toEqual(
      expected.map((r) => r.total_points),
    );
    expect(rows.map((r) => r.rank)).toEqual(expected.map((r) => r.rank));
  });

  it("never publishes a uid", () => {
    const plan = planRecompute(input());
    const serialized = JSON.stringify(plan.episodes);
    expect(serialized).not.toContain("uid_a");
    expect(serialized).not.toContain("uid_b");
  });

  it("produces a single row at rank one for a pool with one entry", () => {
    const plan = planRecompute(
      input({ entries: [entry("uid_a", "alpha", [ADA, BEN])] }),
    );
    const rows = plan.episodes.at(-1)!.summary.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "alpha", rank: 1 });
  });

  it("is stable: rerunning with unchanged inputs changes only computed_at", () => {
    const first = planRecompute(input());
    const second = planRecompute(
      input({ computedAt: "2026-11-11T11:11:11.111Z" }),
    );

    const strip = (plan: typeof first) =>
      JSON.parse(
        JSON.stringify(plan.episodes).replaceAll(
          /"computed_at":"[^"]+"/g,
          '"computed_at":"X"',
        ),
      );

    expect(strip(second)).toEqual(strip(first));
    expect(second.episodes[0].summary.computed_at).toBe(
      "2026-11-11T11:11:11.111Z",
    );
  });

  it("leaves earlier episodes untouched when a later episode's event changes", () => {
    const before = planRecompute(input());

    const data = HAND_DATA();
    data.events.push(idolFind(3, DEV.castaway_id));
    const after = planRecompute(input({ data }));

    const rowsAt = (plan: typeof before, episodeNum: number) =>
      plan.episodes.find((e) => e.episode_num === episodeNum)!.summary.rows;

    expect(rowsAt(after, 1)).toEqual(rowsAt(before, 1));
    expect(rowsAt(after, 2)).toEqual(rowsAt(before, 2));
    expect(rowsAt(after, 3)).not.toEqual(rowsAt(before, 3));
  });

  it("stamps the run's revisions and freeze instant on every document", () => {
    const plan = planRecompute(input());
    for (const ep of plan.episodes) {
      expect(ep.summary.data_revision).toBe("rev_1");
      expect(ep.summary.scoring_revision).toBe(SCORING_REVISION);
      expect(ep.summary.freeze_at).toEqual(FREEZE_AT);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Prop bets
 * ------------------------------------------------------------------ */

describe("prop bets", () => {
  it("breaks a tie without changing the total", () => {
    const plan = planRecompute(
      input({
        entries: [
          entry("uid_a", "alpha", [ADA, BEN]),
          entry("uid_z", "zulu", [BEN, ADA], {
            propbet_first_vote: DEV.castaway_id,
          }),
        ],
      }),
    );

    const rows = plan.episodes.at(-1)!.summary.rows;
    expect(rows.map((r) => r.handle)).toEqual(["zulu", "alpha"]);
    expect(rows.map((r) => r.total)).toEqual([10, 10]);
    expect(rows[0].prop_bet_points).toBeGreaterThan(0);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });

  it("drops answer values the rules cannot validate", () => {
    const rosterIds = new Set(ROSTER.map((r) => r.castaway_id));

    expect(
      sanitizePropBetAnswers(
        {
          propbet_first_vote: DEV.castaway_id,
          propbet_winner: { nested: "map" },
          propbet_ftc: 12345,
          propbet_idols: "US_NOT_ON_ROSTER",
          propbet_quit: "definitely",
          propbet_medical_evac: "Yes",
          not_a_question: "ignored",
        },
        [...PropBetQuestionKeys],
        rosterIds,
      ),
    ).toEqual({
      propbet_first_vote: DEV.castaway_id,
      propbet_medical_evac: "Yes",
    });
  });

  it("treats an unrecognized answer as zero rather than throwing", () => {
    const plan = planRecompute(
      input({
        entries: [
          entry("uid_a", "alpha", [ADA, BEN], {
            propbet_first_vote: { evil: "payload" },
          }),
        ],
      }),
    );
    expect(plan.episodes.at(-1)!.summary.rows[0].prop_bet_points).toBe(0);
  });

  it("never lets an answer value reach a published row", () => {
    const plan = planRecompute(
      input({
        entries: [
          entry("uid_a", "alpha", [ADA, BEN], {
            propbet_first_vote: DEV.castaway_id,
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(plan.episodes);
    expect(serialized).not.toContain(DEV.castaway_id);
    expect(serialized).not.toContain("Dev Rao");
  });
});

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

describe("refusals", () => {
  it("refuses to publish while a pick is unrepairable", () => {
    const stale: PoolPick = {
      castaway_id: id("US9999"),
      full_name: "Ghost Entrant",
    };

    expect(() =>
      planRecompute(
        input({ entries: [entry("uid_a", "alpha", [ADA, stale])] }),
      ),
    ).toThrow(RecomputeRefusal);

    try {
      planRecompute(
        input({ entries: [entry("uid_a", "alpha", [ADA, stale])] }),
      );
    } catch (err) {
      expect((err as RecomputeRefusal).code).toBe("pick_audit");
    }
  });

  it("refuses when a stored pick disagrees with the roster by id", () => {
    const remapped: PoolPick = {
      castaway_id: id("US9099"),
      full_name: "Ada Nolan",
    };
    expect(() =>
      planRecompute(
        input({ entries: [entry("uid_a", "alpha", [remapped, BEN])] }),
      ),
    ).toThrow(RecomputeRefusal);
  });

  it("refuses when freeze_at disagrees with the earliest standings document", () => {
    const moved = ts("2026-09-30T20:00:00-04:00");

    try {
      planRecompute(
        input({
          existingStandings: [
            { episode_num: 1, entry_count: 2, freeze_at: moved },
            { episode_num: 2, entry_count: 2, freeze_at: FREEZE_AT },
          ],
        }),
      );
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(RecomputeRefusal);
      expect((err as RecomputeRefusal).code).toBe("freeze_drift");
    }
  });

  it("compares against the earliest standings document numerically", () => {
    // episode_10 sorts before episode_2 lexicographically. The earliest
    // document is episode 2, and it is the one that must be compared.
    const moved = ts("2026-09-30T20:00:00-04:00");

    expect(() =>
      planRecompute(
        input({
          existingStandings: [
            { episode_num: 10, entry_count: 2, freeze_at: moved },
            { episode_num: 2, entry_count: 2, freeze_at: FREEZE_AT },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it("refuses when the entrant count regresses", () => {
    try {
      planRecompute(
        input({
          existingStandings: [
            { episode_num: 1, entry_count: 5, freeze_at: FREEZE_AT },
          ],
        }),
      );
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(RecomputeRefusal);
      expect((err as RecomputeRefusal).code).toBe("entry_count_regression");
    }
  });

  it("allows a regression when forced", () => {
    const plan = planRecompute(
      input({
        force: true,
        existingStandings: [
          { episode_num: 1, entry_count: 5, freeze_at: FREEZE_AT },
        ],
      }),
    );
    expect(plan.status).toBe("ok");
  });
});

/* ------------------------------------------------------------------ *
 * Clean exits
 * ------------------------------------------------------------------ */

describe("clean exits", () => {
  it("writes nothing for a pool with no entries", () => {
    const plan = planRecompute(input({ entries: [] }));
    expect(plan.status).toBe("empty");
    expect(plan.episodes).toEqual([]);

    expect(buildStandingsWrites(POOL_ID, plan)).toEqual([]);
  });

  it("exits cleanly when the season has no episodes yet", () => {
    const plan = planRecompute(
      input({
        data: { episodes: [], challenges: [], eliminations: [], events: [] },
      }),
    );
    expect(plan.status).toBe("no_data");

    expect(buildStandingsWrites(POOL_ID, plan)).toEqual([]);
  });

  it("exits cleanly when episodes exist but no result has landed", () => {
    const plan = planRecompute(
      input({
        data: {
          episodes: episodes(13),
          challenges: [],
          eliminations: [],
          events: [],
        },
      }),
    );
    expect(plan.status).toBe("no_data");
  });
});

/* ------------------------------------------------------------------ *
 * Write order
 * ------------------------------------------------------------------ */

describe("write order", () => {
  it("writes episodes ascending and flips the pointer last", () => {
    const plan = planRecompute(input());
    const writes = buildStandingsWrites(POOL_ID, plan);

    // Publish episodes before the pointer so readers never land on absent data.
    expect(writes.map((w) => w.path)).toEqual([
      `pools/${POOL_ID}/standings/episode_1`,
      `pools/${POOL_ID}/standings/episode_2`,
      `pools/${POOL_ID}/standings/episode_3`,
      `pools/${POOL_ID}`,
    ]);

    const last = writes.at(-1)!;
    expect(last.kind).toBe("config");
    expect(last.op).toBe("update");
    expect(last.data).toMatchObject({ latest_episode_num: 3 });
  });

  it("orders a thirteen-episode run numerically, not lexicographically", () => {
    const data = {
      episodes: episodes(13),
      challenges: episodes(13).map((e) => immunity(e.order, ADA.castaway_id)),
      eliminations: [],
      events: [],
    };
    const writes = buildStandingsWrites(
      POOL_ID,
      planRecompute(input({ data })),
    );

    const standingsIds = writes
      .filter((w) => w.kind === "standings")
      .map((w) => w.path.split("/").at(-1));

    expect(standingsIds).toEqual(
      Array.from({ length: 13 }, (_, i) => `episode_${i + 1}`),
    );
  });

  it("writes overflow pages before the summary that counts them", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      entry(`uid_${String(i).padStart(4, "0")}`, `handle_${i}`, [ADA, BEN]),
    );
    const plan = planRecompute(input({ entries: many }));
    const writes = buildStandingsWrites(POOL_ID, plan);

    const episodeOne = writes.filter((w) => w.path.includes("episode_1"));
    expect(episodeOne[0].kind).toBe("standings_page");
    expect(episodeOne.at(-1)!.kind).toBe("standings");
    expect(episodeOne.at(-1)!.path).toBe(
      `pools/${POOL_ID}/standings/episode_1`,
    );
  });

  it("does not advance latest_episode_num when a mid-run write fails", async () => {
    const plan = planRecompute(input());
    const writes = buildStandingsWrites(POOL_ID, plan);

    const applied: string[] = [];
    const writer = {
      set: async (path: string) => {
        if (path.endsWith("episode_2")) throw new Error("network");
        applied.push(path);
      },
      update: async (path: string) => {
        applied.push(path);
      },
    };

    await expect(applyStandingsWrites(writer, writes)).rejects.toThrow(
      "network",
    );
    expect(applied).toEqual([`pools/${POOL_ID}/standings/episode_1`]);
    expect(applied).not.toContain(`pools/${POOL_ID}`);
  });

  it("stamps season_complete when a win_survivor event is present", () => {
    const data = HAND_DATA();
    data.events.push(winSurvivor(3, ADA.castaway_id));
    const writes = buildStandingsWrites(
      POOL_ID,
      planRecompute(input({ data })),
    );

    expect(writes.at(-1)!.data).toMatchObject({
      latest_episode_num: 3,
      season_complete: true,
    });
  });

  it("never overwrites the live entrant count from an earlier entry snapshot", () => {
    const writes = buildStandingsWrites(POOL_ID, planRecompute(input()));
    expect(writes.some((w) => w.path.endsWith("/meta/counters"))).toBe(false);
    const config = writes.find((w) => w.kind === "config")!;

    expect(Object.keys(config.data as object)).toEqual([
      "latest_episode_num",
      "season_complete",
      "standings_computed_at",
    ]);
    // The stamp is what makes a browser cache miss after an in-place
    // republish of the same episode.
    expect(config.data).toMatchObject({
      standings_computed_at: expect.any(String),
    });
  });
});

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * The shipped fixture database, instrumented.
 *
 * Deliberately not a second implementation: the read accounting below has to
 * measure the same code path a `--fixture` run takes, or it proves nothing
 * about the job.
 */
const countingDb = (tree: ReadableNode) => {
  const reads: string[] = [];
  const db: ReadableDb = createFixtureDb(tree, (path) => reads.push(path));
  return { db, reads };
};

const fixtureTree = (entryCount: number, episodeCount: number) => {
  const entries: ReadableNode = {};
  for (let i = 0; i < entryCount; i += 1) {
    entries[`uid_${String(i).padStart(4, "0")}`] = {
      __data: {
        handle: `handle_${i}`,
        picks: [ADA, BEN],
        prop_bets: {},
      },
    };
  }

  const byId = <T extends { id: string }>(items: T[]) =>
    Object.fromEntries(items.map((x) => [x.id, x]));

  const eps = episodes(episodeCount);

  return {
    pools: {
      [POOL_ID]: {
        __data: pool(),
        entries,
        standings: {},
        meta: {},
      },
    },
    seasons: {
      [SEASON_ID]: {
        __data: {
          id: SEASON_ID,
          episodes: eps,
          data_revision: "rev_1",
          scoring_revision: SCORING_REVISION,
        },
      },
    },
    challenges: {
      [SEASON_ID]: {
        __data: byId(eps.map((e) => immunity(e.order, ADA.castaway_id))),
      },
    },
    eliminations: { [SEASON_ID]: { __data: {} } },
    events: { [SEASON_ID]: { __data: {} } },
  } as unknown as ReadableNode;
};

describe("reads", () => {
  it("reads entries once per run, not once per episode", async () => {
    const { db, reads } = countingDb(fixtureTree(1000, 13));

    const loaded = await loadPoolStandingsInputs(db, POOL_ID);
    const plan = planRecompute({
      ...loaded,
      computedAt: "2026-10-01T00:00:00.000Z",
    });

    expect(plan.episodes).toHaveLength(13);
    expect(plan.episodes.at(-1)!.summary.entry_count).toBe(1000);

    const entryReads = reads.filter((r) => r.endsWith("/entries"));
    expect(entryReads).toHaveLength(1);

    // Thirteen episodes, one thousand entrants, and the whole run costs a
    // fixed handful of reads.
    expect(reads).toEqual([
      `pools/${POOL_ID}`,
      `pools/${POOL_ID}/entries`,
      `pools/${POOL_ID}/standings`,
      `seasons/${SEASON_ID}`,
      `challenges/${SEASON_ID}`,
      `eliminations/${SEASON_ID}`,
      `events/${SEASON_ID}`,
    ]);
  });

  it("throws when the pool configuration document is absent", async () => {
    const { db } = countingDb({ pools: {} } as unknown as ReadableNode);
    await expect(loadPoolStandingsInputs(db, POOL_ID)).rejects.toThrow(
      /pool_season_99/,
    );
  });

  it("survives an absent season document", async () => {
    const tree = fixtureTree(2, 3) as Record<string, unknown>;
    tree.seasons = {};
    const { db } = countingDb(tree as ReadableNode);

    const loaded = await loadPoolStandingsInputs(db, POOL_ID);
    expect(loaded.data.episodes).toEqual([]);
    expect(
      planRecompute({ ...loaded, computedAt: "2026-10-01T00:00:00.000Z" })
        .status,
    ).toBe("no_data");
  });
});

/* ------------------------------------------------------------------ *
 * Job summary
 * ------------------------------------------------------------------ */

describe("job summary", () => {
  it("reports aggregate cluster sizes only", () => {
    const entries = [
      entry("uid_a", "alpha", [ADA, BEN]),
      entry("uid_b", "bravo", [BEN, ADA]),
      entry("uid_c", "charlie", [BEN, ADA]),
      entry("uid_d", "delta", [CASS, DEV]),
    ];

    expect(clusterIdenticalEntries(entries)).toEqual([3]);
  });

  it("names no handle, pick, castaway, or uid", () => {
    const plan = planRecompute(input());
    const summary = buildJobSummary(POOL_ID, plan, 1234);

    for (const secret of [
      "alpha",
      "bravo",
      "uid_a",
      "uid_b",
      "Ada Nolan",
      "US9001",
    ]) {
      expect(summary).not.toContain(secret);
    }
  });

  it("carries entry count, bytes, per-episode rows, and duration", () => {
    const plan = planRecompute(input());
    const summary = buildJobSummary(POOL_ID, plan, 1234);

    expect(summary).toContain("Entrants");
    expect(summary).toContain("1234");
    expect(summary).toMatch(/bytes/i);
    expect(summary).toContain("episode_3");
  });
});

/* ------------------------------------------------------------------ *
 * Type-level guard: the plan never sees a database
 * ------------------------------------------------------------------ */

describe("purity", () => {
  it("plans from data alone", () => {
    const plan = planRecompute(input());
    const writes: StandingsWrite[] = buildStandingsWrites(POOL_ID, plan);
    expect(writes.length).toBeGreaterThan(0);
    // planRecompute takes RecomputeInput, which has no db member at all.
    expect("db" in (input() as object)).toBe(false);
  });
});
