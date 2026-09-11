import { describe, expect, it } from "vitest";
import type {
  CastawayId,
  Challenge,
  Elimination,
  Episode,
  GameEvent,
  PoolEntryId,
  PoolPick,
  PoolStandingsRow,
  PoolStandingsStamp,
} from "../../types";
import {
  formatPoolPoints,
  latestScoredPoolEpisode,
  projectPoolEntryScores,
  resolvePoolEntryBreakdownAccess,
  type PoolEntryScores,
} from "../../utils/poolEntryScoring";
import { rankPoolEntries } from "../../utils/poolRanking";
import { buildPoolStandingsDocuments } from "../../utils/poolStandings";
import { getSeasonPointsByCastaway } from "../../utils/seasonPoints";

it.each([
  [0, "0"],
  [12, "12"],
  [2.5, "2.5"],
  [-0.5, "-0.5"],
] as const)("formats %s points as %s", (points, label) => {
  expect(formatPoolPoints(points)).toBe(label);
});

/* ------------------------------------------------------------------ *
 * The fixture
 *
 * Deliberately the same SHAPE as `scripts/__tests__/recompute-pool-standings.test.ts`
 * (a season 99 pool, two picks an entry, point values from src/data/scoring.ts:
 * immunity 3, find_idol 1, eliminated = episode number). The agreement test
 * below feeds this ONE object to both the entrant's own derivation and to the
 * published-standings job, so the two sides cannot be agreeing because each
 * was handed data that suited it.
 * ------------------------------------------------------------------ */

const SEASON_ID = "season_99" as const;
const id = (raw: string) => raw as CastawayId;

const ADA = { castaway_id: id("US9001"), full_name: "Ada Nolan" };
const BEN = { castaway_id: id("US9002"), full_name: "Ben Ortiz" };
const CASS = { castaway_id: id("US9003"), full_name: "Cass Lin" };
const DEV = { castaway_id: id("US9004"), full_name: "Dev Rao" };
/** In the cast, in nobody's records: proves a silent pick scores zero. */
const ERI = { castaway_id: id("US9005"), full_name: "Eri Takada" };

const ROSTER: PoolPick[] = [ADA, BEN, CASS, DEV, ERI];

const episode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: SEASON_ID,
  season_num: 99,
  order,
  name: `Episode ${order}`,
  finale: false,
  post_merge: order >= 4,
  merge_occurs: order === 4,
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

/**
 * Hand-computed, five episodes.
 *
 *   ep1  Ada wins immunity (3).  Dev is booted (1 = the episode number).
 *   ep2  Ben wins immunity (3) and finds an idol (1).
 *   ep3  Cass finds an idol (1). Ben is booted (3).
 *   ep4  Ada finds an idol (1).
 *   ep5  Cass wins immunity (3).
 *
 * Per castaway, per episode:
 *   Ada  [3, 0, 0, 1, 0]  total 4
 *   Ben  [0, 4, 3, 0, 0]  total 7   <- out in ep3, nothing after
 *   Cass [0, 0, 1, 0, 3]  total 4
 *   Dev  [1, 0, 0, 0, 0]  total 1   <- out in ep1
 *   Eri  [0, 0, 0, 0, 0]  total 0   <- never appears in a record
 */
const HAND_DATA = () => ({
  episodes: episodes(5),
  challenges: [
    immunity(1, ADA.castaway_id),
    immunity(2, BEN.castaway_id),
    immunity(5, CASS.castaway_id),
  ],
  eliminations: [boot(1, DEV.castaway_id), boot(3, BEN.castaway_id)],
  events: [
    idolFind(2, BEN.castaway_id),
    idolFind(3, CASS.castaway_id),
    idolFind(4, ADA.castaway_id),
  ],
});

const ALPHA_PICKS: PoolPick[] = [ADA, BEN];
const BRAVO_PICKS: PoolPick[] = [CASS, DEV];
const CAROL_PICKS: PoolPick[] = [ERI, DEV];

/** Cumulative entry totals per episode, computed by hand from the table above. */
const HAND_CUMULATIVE: Record<string, number[]> = {
  // Ada 3,0,0,1,0 + Ben 0,4,3,0,0 -> 3,4,3,1,0
  alpha: [3, 7, 10, 11, 11],
  // Cass 0,0,1,0,3 + Dev 1,0,0,0,0 -> 1,0,1,0,3
  bravo: [1, 1, 2, 2, 5],
  // Eri 0,0,0,0,0 + Dev 1,0,0,0,0 -> 1,0,0,0,0
  carol: [1, 1, 1, 1, 1],
};

const project = (picks: PoolPick[], data = HAND_DATA()): PoolEntryScores =>
  projectPoolEntryScores({
    picks,
    episodes: data.episodes,
    challenges: data.challenges,
    eliminations: data.eliminations,
    events: data.events,
  });

const ready = (scores: PoolEntryScores) => {
  if (scores.kind !== "ready") {
    throw new Error(`expected a ready breakdown, got ${scores.kind}`);
  }
  return scores;
};

const pickRow = (scores: PoolEntryScores, castawayId: CastawayId) => {
  const row = ready(scores).picks.find(
    (entryPick) => entryPick.castaway_id === castawayId,
  );
  if (!row) throw new Error(`no row for ${castawayId}`);
  return row;
};

/* ------------------------------------------------------------------ *
 * The per-pick per-episode projection
 * ------------------------------------------------------------------ */

describe("projectPoolEntryScores", () => {
  it("gives every pick one dense row per scored episode", () => {
    const scores = ready(project(ALPHA_PICKS));

    expect(scores.episodes.map((e) => e.order)).toEqual([1, 2, 3, 4, 5]);
    scores.picks.forEach((entryPick) => {
      expect(entryPick.per_episode).toHaveLength(5);
      entryPick.per_episode.forEach((points) => {
        expect(typeof points).toBe("number");
      });
    });
  });

  it("matches the hand-computed points for each pick", () => {
    const alpha = project(ALPHA_PICKS);

    expect(pickRow(alpha, ADA.castaway_id).per_episode).toEqual([
      3, 0, 0, 1, 0,
    ]);
    expect(pickRow(alpha, ADA.castaway_id).total).toBe(4);
    expect(pickRow(alpha, BEN.castaway_id).per_episode).toEqual([
      0, 4, 3, 0, 0,
    ]);
    expect(pickRow(alpha, BEN.castaway_id).total).toBe(7);
    expect(ready(alpha).total).toBe(11);
  });

  it("scores an episode with no records for a pick as zero, never undefined", () => {
    const alpha = project(ALPHA_PICKS);
    const ada = pickRow(alpha, ADA.castaway_id);

    // Episode 2 has nothing at all for Ada.
    expect(ada.per_episode[1]).toBe(0);
    expect(ada.per_episode[1]).not.toBeUndefined();
  });

  it("scores a pick that appears in no record at all as a row of zeros", () => {
    const carol = project(CAROL_PICKS);
    const eri = pickRow(carol, ERI.castaway_id);

    expect(eri.per_episode).toEqual([0, 0, 0, 0, 0]);
    expect(eri.total).toBe(0);
    expect(eri.out_episode_num).toBeNull();
    // The entry still totals Dev's single point rather than NaN.
    expect(ready(carol).total).toBe(1);
  });

  it("stops a castaway accruing after their elimination and keeps what they earned", () => {
    const alpha = project(ALPHA_PICKS);
    const ben = pickRow(alpha, BEN.castaway_id);

    expect(ben.out_episode_num).toBe(3);
    // Kept: the 4 from episode 2 and the 3 the boot itself is worth.
    expect(ben.per_episode.slice(0, 3)).toEqual([0, 4, 3]);
    // Stopped: every episode after the boot contributes zero.
    expect(ben.per_episode.slice(3)).toEqual([0, 0]);
    expect(ben.total).toBe(7);
  });

  it("marks a first-episode boot as out without zeroing the boot points", () => {
    const bravo = project(BRAVO_PICKS);
    const dev = pickRow(bravo, DEV.castaway_id);

    expect(dev.out_episode_num).toBe(1);
    expect(dev.per_episode).toEqual([1, 0, 0, 0, 0]);
    expect(dev.total).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The no-data state, which is season 51's normal state today
 * ------------------------------------------------------------------ */

describe("the awaiting-data state", () => {
  it("is what an entrant sees when the season document has no episodes", () => {
    // Season 51 today: SEASON_51_EPISODES is [] and every result collection
    // is empty, because the season document arrives with the survivoR sync
    // after the premiere.
    expect(
      projectPoolEntryScores({
        picks: ALPHA_PICKS,
        episodes: [],
        challenges: [],
        eliminations: [],
        events: [],
      }),
    ).toEqual({ kind: "awaiting-data" });
  });

  it("is what an entrant sees when episodes exist but nothing has been scored", () => {
    expect(
      projectPoolEntryScores({
        picks: ALPHA_PICKS,
        episodes: episodes(5),
        challenges: [],
        eliminations: [],
        events: [],
      }),
    ).toEqual({ kind: "awaiting-data" });
  });

  it("is what an entrant with no picks sees, rather than an empty table", () => {
    expect(project([])).toEqual({ kind: "awaiting-data" });
  });

  it("never reports an episode the season document does not carry", () => {
    // A stray record numbered beyond the season's episode list must not
    // conjure an episode column.
    expect(
      latestScoredPoolEpisode({
        episodes: episodes(2),
        challenges: [immunity(9, ADA.castaway_id)],
        eliminations: [],
        events: [],
      }),
    ).toBe(2);
  });

  it("stops at the newest episode with data, numerically", () => {
    // `episode_10` sorts before `episode_2`; nothing here sorts ids.
    expect(
      latestScoredPoolEpisode({
        episodes: episodes(13),
        challenges: [immunity(10, ADA.castaway_id)],
        eliminations: [],
        events: [],
      }),
    ).toBe(10);

    expect(
      latestScoredPoolEpisode({
        episodes: episodes(13),
        challenges: [],
        eliminations: [],
        events: [],
      }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Owner scoping (R26, R25)
 * ------------------------------------------------------------------ */

describe("resolvePoolEntryBreakdownAccess", () => {
  const entryId = (uid: string) => `pool_entry_${uid}` as PoolEntryId;

  it("shows the breakdown to the entry's owner", () => {
    expect(
      resolvePoolEntryBreakdownAccess({
        entryId: entryId("uid_a"),
        viewerUid: "uid_a",
      }),
    ).toBe("breakdown");
  });

  it("shows nothing to another entrant", () => {
    expect(
      resolvePoolEntryBreakdownAccess({
        entryId: entryId("uid_a"),
        viewerUid: "uid_b",
      }),
    ).toBe("nothing");
  });

  it("shows nothing to a signed-out visitor", () => {
    expect(
      resolvePoolEntryBreakdownAccess({
        entryId: entryId("uid_a"),
        viewerUid: undefined,
      }),
    ).toBe("nothing");
  });

  it("shows nothing when there is no entry", () => {
    expect(
      resolvePoolEntryBreakdownAccess({
        entryId: undefined,
        viewerUid: "uid_a",
      }),
    ).toBe("nothing");
  });

  it("does not treat a uid that merely looks like an entry id as ownership", () => {
    expect(
      resolvePoolEntryBreakdownAccess({
        entryId: entryId("uid_a"),
        viewerUid: "pool_entry_uid_a",
      }),
    ).toBe("nothing");
  });
});

/* ------------------------------------------------------------------ *
 * The agreement test: this unit's verification
 *
 * The entrant's own breakdown and the published leaderboard must report the
 * same number for the same episode.
 *
 * THE PUBLISHED SIDE IS NOT THIS UNIT'S CODE. It runs `rankPoolEntries` and
 * `buildPoolStandingsDocuments`, the shared implementations
 * `scripts/recompute-pool-standings.ts` itself calls (KTD11), driven by the
 * same per-episode loop that job runs: derive once over the whole cast, then
 * slice the dense per-castaway arrays to the first N episodes and rank. The
 * job module is not imported directly because it lives outside `tsconfig`'s
 * `include` and needs an ES2022 lib for `Array.prototype.at`; pulling it into
 * the browser type program to satisfy a test would be the tail wagging the
 * dog. `scripts/__tests__/recompute-pool-standings.test.ts` covers the job.
 *
 * WHAT THE TWO SIDES SHARE is `getSeasonPointsByCastaway` (U3) and this one
 * fixture object, which is the point: they must agree because they score the
 * same castaways from the same records, not because one reads the other's
 * answer. Everything above that differs. The breakdown scopes episodes with
 * `latestScoredPoolEpisode`, projects one dense row per PICK, and sums across
 * picks. The published side scopes with its own filter, derives over the whole
 * five-castaway CAST including two nobody picked, ranks, breaks ties on prop
 * bets and pages the rows. And both are independently pinned to the
 * hand-computed table in `HAND_CUMULATIVE`, so a shared misunderstanding would
 * have to survive three-way arithmetic.
 * ------------------------------------------------------------------ */

const STAMP: PoolStandingsStamp = {
  episode_num: 0,
  computed_at: "2026-10-01T00:00:00.000Z",
  data_revision: "rev_1",
  scoring_revision: "scoring_rev_1",
  freeze_at: {
    seconds: 1_790_000_000,
    nanoseconds: 0,
  } as PoolStandingsStamp["freeze_at"],
};

/**
 * The recompute job's publish path, over the same data.
 *
 * A verbatim transcription of the loop in `planRecompute`: scope to the newest
 * episode with data, derive the whole cast once, then rank against the first
 * N per-episode entries for each episode N. Prop bets are empty here, so the
 * tiebreak is inert and totals are the only thing under test.
 */
const publish = (data = HAND_DATA()) => {
  const recorded = [...data.challenges, ...data.eliminations, ...data.events]
    .map((record) => record.episode_num)
    .filter((num) => Number.isFinite(num));
  const highest = Math.max(...recorded);
  const aired = data.episodes
    .filter((e) => e.order <= highest)
    .slice()
    .sort((a, b) => a.order - b.order);
  const latest = Math.max(...aired.map((e) => e.order));

  const inScope = <T extends { episode_num: number }>(records: T[]): T[] =>
    records.filter((record) => record.episode_num <= latest);

  const fullPoints = getSeasonPointsByCastaway(
    inScope(data.challenges),
    inScope(data.eliminations),
    inScope(data.events),
    aired,
    ROSTER.map((member) => member.castaway_id),
  );

  const entries = [
    { uid: "uid_a", handle: "alpha", picks: ALPHA_PICKS },
    { uid: "uid_b", handle: "bravo", picks: BRAVO_PICKS },
    { uid: "uid_c", handle: "carol", picks: CAROL_PICKS },
  ];
  const propBetPointsByUid = { uid_a: 0, uid_b: 0, uid_c: 0 };

  return aired.map((episode, index) => {
    const pointsThrough = Object.fromEntries(
      Object.entries(fullPoints).map(([castawayId, perEpisode]) => [
        castawayId,
        perEpisode.slice(0, index + 1),
      ]),
    );

    const rows: PoolStandingsRow[] = rankPoolEntries(
      entries,
      pointsThrough,
      propBetPointsByUid,
    ).map((row) => ({
      handle: row.handle,
      total: row.total_points,
      prop_bet_points: row.prop_bet_points,
      rank: row.rank,
    }));

    const { summary } = buildPoolStandingsDocuments(rows, {
      ...STAMP,
      episode_num: episode.order,
    });

    return { episode_num: episode.order, summary };
  });
};

/** The entrant's own cumulative total through `episodeNum`, from the breakdown. */
const ownTotalThrough = (picks: PoolPick[], episodeNum: number): number => {
  const scores = ready(project(picks));
  const upTo = scores.episodes.findIndex((e) => e.order === episodeNum) + 1;
  return scores.picks.reduce(
    (total, entryPick) =>
      total +
      entryPick.per_episode.slice(0, upTo).reduce((sum, pts) => sum + pts, 0),
    0,
  );
};

describe("an entrant's own breakdown agrees with the published leaderboard", () => {
  const PICKS_BY_HANDLE: Record<string, PoolPick[]> = {
    alpha: ALPHA_PICKS,
    bravo: BRAVO_PICKS,
    carol: CAROL_PICKS,
  };

  it("pins the hand-computed cumulative totals on the breakdown side", () => {
    // If this drifts, the agreement below is not proving what it claims.
    Object.entries(HAND_CUMULATIVE).forEach(([handle, expected]) => {
      expect(
        [1, 2, 3, 4, 5].map((episodeNum) =>
          ownTotalThrough(PICKS_BY_HANDLE[handle], episodeNum),
        ),
      ).toEqual(expected);
    });
  });

  it("pins the same hand-computed totals on the published side", () => {
    // The other half of the three-way check: the leaderboard side must also
    // land on the hand arithmetic before the two are compared to each other.
    const published = publish();
    Object.entries(HAND_CUMULATIVE).forEach(([handle, expected]) => {
      expect(
        published.map(
          ({ summary }) =>
            summary.rows.find((row) => row.handle === handle)?.total,
        ),
      ).toEqual(expected);
    });
  });

  it("matches the published total for every entrant at every episode", () => {
    const published = publish();
    expect(published).toHaveLength(5);

    published.forEach(({ episode_num, summary }) => {
      expect(summary.rows).toHaveLength(3);
      summary.rows.forEach((row) => {
        expect({
          handle: row.handle,
          episode_num,
          total: row.total,
        }).toEqual({
          handle: row.handle,
          episode_num,
          total: ownTotalThrough(PICKS_BY_HANDLE[row.handle], episode_num),
        });
      });
    });
  });

  it("matches the newest published total, which is what the breakdown shows", () => {
    const published = publish();
    const newest = published[published.length - 1];

    Object.entries(PICKS_BY_HANDLE).forEach(([handle, picks]) => {
      const row = newest.summary.rows.find((r) => r.handle === handle);
      expect(row?.total).toBe(ready(project(picks)).total);
    });
  });

  it("moves both sides together when one scoring input changes", () => {
    // A perturbation of the fixture rather than of either derivation: if the
    // assertion above were vacuous (both sides reading the same cached
    // number, or both reading zero) this would not notice a change at all.
    const before = publish();
    const beforeNewest = before[before.length - 1];
    const beforeAlpha = beforeNewest.summary.rows.find(
      (r) => r.handle === "alpha",
    );

    const perturbed = HAND_DATA();
    perturbed.events = [
      ...perturbed.events,
      idolFind(5, ADA.castaway_id), // one more point for Ada, in the last episode
    ];

    const after = publish(perturbed);
    const afterNewest = after[after.length - 1];
    const afterAlpha = afterNewest.summary.rows.find(
      (r) => r.handle === "alpha",
    );

    const ownBefore = ready(project(ALPHA_PICKS)).total;
    const ownAfter = ready(project(ALPHA_PICKS, perturbed)).total;

    expect(afterAlpha?.total).toBe((beforeAlpha?.total ?? 0) + 1);
    expect(ownAfter).toBe(ownBefore + 1);
    expect(ownAfter).toBe(afterAlpha?.total);

    // The untouched entrants do not move, so the perturbation is targeted.
    expect(
      afterNewest.summary.rows.find((r) => r.handle === "bravo")?.total,
    ).toBe(beforeNewest.summary.rows.find((r) => r.handle === "bravo")?.total);
  });
});

/* ------------------------------------------------------------------ *
 * The U10 import boundary, for the modules importBoundaries.test.ts does not
 * name. That test already forbids the ownership and draft-grid helpers; this
 * one forbids the competition SCORING surfaces, which carry drafted-by
 * vocabulary and assume exclusive ownership.
 * ------------------------------------------------------------------ */

/**
 * Sources are read through Vite's glob rather than `node:fs`: the app tsconfig
 * targets the browser and has no node types. Same pattern as
 * `src/utils/__tests__/importBoundaries.test.ts`. Keys are relative to this
 * file, so `../../x` is `src/x`.
 */
const SOURCES = import.meta.glob(
  [
    "../../components/Pool/PoolEntryBreakdown.tsx",
    "../usePoolEntryScores.ts",
    "../../utils/poolEntryScoring.ts",
    "../../pages/Pool.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const BREAKDOWN_SOURCE = "../../components/Pool/PoolEntryBreakdown.tsx";

const sourceOf = (key: string): string => {
  const text = SOURCES[key];
  if (typeof text !== "string") {
    throw new Error(`no source globbed for ${key}`);
  }
  return text;
};

describe("the pool breakdown imports no competition scoring surface", () => {
  const FORBIDDEN = [
    "ScoringTables",
    "MyPlayers",
    "MyTeam",
    "DraftTable",
    "useScoringCalculations",
    "tradeUtils",
  ];

  const IMPORT_SPECIFIER =
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;

  Object.keys(SOURCES).forEach((file) => {
    it(`${file} reaches none of them`, () => {
      const source = sourceOf(file);
      const specifiers: string[] = [];
      for (const match of source.matchAll(IMPORT_SPECIFIER)) {
        specifiers.push(match[1]);
      }

      expect(specifiers.length).toBeGreaterThan(0);
      specifiers.forEach((specifier) => {
        FORBIDDEN.forEach((banned) => {
          expect(specifier).not.toContain(banned);
        });
      });
    });
  });
});

/* ------------------------------------------------------------------ *
 * Vocabulary (U10)
 * ------------------------------------------------------------------ */

describe("the breakdown's user-facing copy", () => {
  const source = () => sourceOf(BREAKDOWN_SOURCE);

  it("uses none of the competition vocabulary the pool retired", () => {
    const text = source();
    ["roster", "drafted by", "pick number", "your turn", "team name"].forEach(
      (banned) => {
        expect(text.toLowerCase()).not.toContain(banned);
      },
    );
  });

  it("contains no em-dash in any string it renders", () => {
    expect(source()).not.toContain("—");
  });
});
