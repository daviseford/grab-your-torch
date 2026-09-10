/**
 * The public leaderboard read path (U8).
 *
 * This project has no React Testing Library and no `.test.tsx` files, so the
 * hook itself is deliberately thin and every decision it makes lives in a pure
 * function tested here:
 *
 *  - `planPoolStandingsFetch` / `planPoolStandingsPagesFetch` decide which
 *    documents are read, and at exactly which paths. This is where the
 *    episode-10 ordering trap and the `display_mode` rollback lever are
 *    proven, and where "issues no standings fetch" is a testable claim rather
 *    than an assertion about a browser.
 *  - `resolvePoolStandingsFreshness` distinguishes fresh, stale and missing
 *    (KTD8). It can never answer "zeroed", which is the outcome the plan
 *    forbids.
 *  - `resolvePoolStandingsView` turns those into the four things that can be
 *    on screen: hidden, pending, empty, ready.
 *  - `projectPoolStandingsRows` proves no field beyond handle, total and rank
 *    can reach the rendered output (R17).
 *  - `poolStandingsCache` is the revision-keyed browser-local store.
 *
 * DELIBERATE NO-TEST EXCEPTION: `src/components/Pool/PoolLeaderboard.tsx`
 * renders these values and is not unit tested, for the same reason every other
 * component in this repo is not. Its replacement verification is
 * `yarn e2e --project=chromium-signed-out` (the project U9 adds), which
 * asserts the signed-out network behaviour on real request URLs.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { SCORING_REVISION } from "../../data/scoringRevision.generated";
import type {
  FirestoreTimestamp,
  Pool,
  PoolStandings,
  PoolStandingsPage,
  PoolStandingsRow,
  PoolStandingsStamp,
} from "../../types";
import {
  clearPoolStandingsCache,
  poolStandingsCacheKey,
  readPoolStandingsCache,
  writePoolStandingsCache,
  type PoolStandingsCacheStorage,
} from "../../utils/poolStandingsCache";
import {
  describePoolStandingsAsOf,
  groupPoolStandingsRows,
  planPoolStandingsFetch,
  planPoolStandingsPagesFetch,
  poolStandingsDocId,
  poolStandingsPagePath,
  poolStandingsSummaryPath,
  projectPoolStandingsRows,
  resolvePoolStandingsFreshness,
  resolvePoolStandingsView,
} from "../../utils/poolStandingsRead";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const timestamp = (seconds: number): FirestoreTimestamp => ({
  seconds,
  nanoseconds: 0,
  toDate: () => new Date(seconds * 1000),
});

const FREEZE_AT = timestamp(1_758_672_000);
const DATA_REVISION = "data-rev-abc";

const stamp = (
  overrides: Partial<PoolStandingsStamp> = {},
): PoolStandingsStamp => ({
  episode_num: 7,
  computed_at: "2026-09-30T04:12:00.000Z",
  data_revision: DATA_REVISION,
  scoring_revision: SCORING_REVISION,
  freeze_at: FREEZE_AT,
  ...overrides,
});

const row = (
  handle: string,
  total: number,
  rank: number,
  propBetPoints = 0,
): PoolStandingsRow => ({
  handle,
  total,
  prop_bet_points: propBetPoints,
  rank,
});

const summaryDoc = (
  rows: PoolStandingsRow[],
  overrides: Partial<PoolStandings> = {},
): PoolStandings => ({
  ...stamp(),
  entry_count: rows.length,
  rows,
  page_count: 0,
  ...overrides,
});

const poolDoc = (overrides: Partial<Pool> = {}): Pool =>
  ({
    id: "pool_season_51",
    season_id: "season_51",
    season_num: 51,
    name: "Survivor 51 Season Pool",
    freeze_at: FREEZE_AT,
    roster: [],
    picks_per_entry: 7,
    prop_bet_keys: [],
    status: "closed",
    display_mode: "full",
    latest_episode_num: 7,
    season_complete: false,
    ...overrides,
  }) as Pool;

/** Every collection a public read path must never touch. */
const FORBIDDEN_COLLECTIONS = [
  "events",
  "challenges",
  "eliminations",
  "seasons",
];

const touchesForbiddenCollection = (paths: readonly string[]): boolean =>
  paths.some((path) =>
    FORBIDDEN_COLLECTIONS.some((collection) =>
      path.split("/").includes(collection),
    ),
  );

// ---------------------------------------------------------------------------
// Fetch planner
// ---------------------------------------------------------------------------

describe("planPoolStandingsFetch", () => {
  it("reads the summary document by direct path when nothing is cached", () => {
    const plan = planPoolStandingsFetch({
      poolId: "pool_season_51",
      displayMode: "full",
      latestEpisodeNum: 7,
      cacheHit: false,
    });
    expect(plan.reason).toBe("fetch");
    expect(plan.paths).toEqual(["pools/pool_season_51/standings/episode_7"]);
  });

  it("resolves episode 10 to episode 10, not episode 9", () => {
    // `episode_${n}` ids sort lexicographically, so `episode_10` precedes
    // `episode_2`. Anything that asks Firestore for "the newest" silently
    // freezes the leaderboard at episode 9 forever. The pointer plus a direct
    // path is the whole mitigation.
    const plan = planPoolStandingsFetch({
      poolId: "pool_season_51",
      displayMode: "full",
      latestEpisodeNum: 10,
      cacheHit: false,
    });
    expect(plan.paths).toEqual(["pools/pool_season_51/standings/episode_10"]);
    expect(plan.paths[0]).not.toContain("episode_9");
    expect(poolStandingsDocId(10)).toBe("episode_10");

    // And the trap itself, so the reason this code exists stays visible.
    expect(["episode_10", "episode_2", "episode_9"].sort()).toEqual([
      "episode_10",
      "episode_2",
      "episode_9",
    ]);
  });

  it("issues no standings fetch when display_mode is not full", () => {
    for (const latestEpisodeNum of [null, 1, 10]) {
      const plan = planPoolStandingsFetch({
        poolId: "pool_season_51",
        displayMode: "leaderboard",
        latestEpisodeNum,
        cacheHit: false,
      });
      expect(plan.reason).toBe("hidden");
      expect(plan.paths).toEqual([]);
    }
  });

  it("checks display_mode before anything else, so the lever works with no pointer", () => {
    const plan = planPoolStandingsFetch({
      poolId: undefined,
      displayMode: "leaderboard",
      latestEpisodeNum: 7,
      cacheHit: false,
    });
    expect(plan.reason).toBe("hidden");
    expect(plan.paths).toEqual([]);
  });

  it("issues no fetch when a revision-matching cache is already in hand", () => {
    const plan = planPoolStandingsFetch({
      poolId: "pool_season_51",
      displayMode: "full",
      latestEpisodeNum: 7,
      cacheHit: true,
    });
    expect(plan.reason).toBe("cached");
    expect(plan.paths).toEqual([]);
  });

  it("issues no fetch before the first episode is scored", () => {
    const plan = planPoolStandingsFetch({
      poolId: "pool_season_51",
      displayMode: "full",
      latestEpisodeNum: null,
      cacheHit: false,
    });
    expect(plan.reason).toBe("not-scored");
    expect(plan.paths).toEqual([]);
  });

  it("issues no fetch when there is no pool", () => {
    const plan = planPoolStandingsFetch({
      poolId: undefined,
      displayMode: "full",
      latestEpisodeNum: 7,
      cacheHit: false,
    });
    expect(plan.reason).toBe("no-pool");
    expect(plan.paths).toEqual([]);
  });

  it("never plans a read against a result collection or a season document", () => {
    const plans = [
      planPoolStandingsFetch({
        poolId: "pool_season_51",
        displayMode: "full",
        latestEpisodeNum: 10,
        cacheHit: false,
      }),
      planPoolStandingsFetch({
        poolId: "pool_season_51",
        displayMode: "full",
        latestEpisodeNum: 1,
        cacheHit: true,
      }),
    ];
    for (const plan of plans) {
      expect(touchesForbiddenCollection(plan.paths)).toBe(false);
    }
  });
});

describe("planPoolStandingsPagesFetch", () => {
  it("fetches no page until the visitor expands the list", () => {
    expect(
      planPoolStandingsPagesFetch({
        poolId: "pool_season_51",
        displayMode: "full",
        latestEpisodeNum: 7,
        pageCount: 3,
        expanded: false,
      }).paths,
    ).toEqual([]);
  });

  it("fetches every overflow page by direct path once expanded", () => {
    expect(
      planPoolStandingsPagesFetch({
        poolId: "pool_season_51",
        displayMode: "full",
        latestEpisodeNum: 10,
        pageCount: 3,
        expanded: true,
      }).paths,
    ).toEqual([
      "pools/pool_season_51/standings/episode_10/pages/0",
      "pools/pool_season_51/standings/episode_10/pages/1",
      "pools/pool_season_51/standings/episode_10/pages/2",
    ]);
  });

  it("fetches no page when display_mode is not full, even when expanded", () => {
    expect(
      planPoolStandingsPagesFetch({
        poolId: "pool_season_51",
        displayMode: "leaderboard",
        latestEpisodeNum: 7,
        pageCount: 3,
        expanded: true,
      }).paths,
    ).toEqual([]);
  });

  it("fetches no page when the summary reported none", () => {
    expect(
      planPoolStandingsPagesFetch({
        poolId: "pool_season_51",
        displayMode: "full",
        latestEpisodeNum: 7,
        pageCount: 0,
        expanded: true,
      }).paths,
    ).toEqual([]);
  });

  it("builds the same paths the helpers do", () => {
    expect(poolStandingsSummaryPath("pool_season_51", 10)).toBe(
      "pools/pool_season_51/standings/episode_10",
    );
    expect(poolStandingsPagePath("pool_season_51", 10, 2)).toBe(
      "pools/pool_season_51/standings/episode_10/pages/2",
    );
  });
});

// ---------------------------------------------------------------------------
// Freshness resolver
// ---------------------------------------------------------------------------

describe("resolvePoolStandingsFreshness", () => {
  it("reports missing for an absent document", () => {
    expect(
      resolvePoolStandingsFreshness({
        standings: undefined,
        scoringRevision: SCORING_REVISION,
        dataRevision: DATA_REVISION,
      }),
    ).toBe("missing");
    expect(
      resolvePoolStandingsFreshness({
        standings: null,
        scoringRevision: SCORING_REVISION,
      }),
    ).toBe("missing");
  });

  it("reports fresh when both revisions match", () => {
    expect(
      resolvePoolStandingsFreshness({
        standings: stamp(),
        scoringRevision: SCORING_REVISION,
        dataRevision: DATA_REVISION,
      }),
    ).toBe("fresh");
  });

  it("reports stale when the scoring revision moved, with no data revision in hand", () => {
    // This is the only staleness signal the homepage has, and it is free: the
    // scoring revision is a bundled constant. Reading the season document to
    // compare the data revision is exactly what R22 forbids there.
    expect(
      resolvePoolStandingsFreshness({
        standings: stamp({ scoring_revision: "some-older-build" }),
        scoringRevision: SCORING_REVISION,
      }),
    ).toBe("stale");
  });

  it("reports stale when the data revision moved, for a surface that has one", () => {
    expect(
      resolvePoolStandingsFreshness({
        standings: stamp({ data_revision: "an-older-season-revision" }),
        scoringRevision: SCORING_REVISION,
        dataRevision: DATA_REVISION,
      }),
    ).toBe("stale");
  });

  it("does not compare the data revision when the caller supplies none", () => {
    // A homepage caller passes nothing, and a mismatched data revision it
    // could not have known about must not be invented into a stale reading.
    expect(
      resolvePoolStandingsFreshness({
        standings: stamp({ data_revision: "an-older-season-revision" }),
        scoringRevision: SCORING_REVISION,
      }),
    ).toBe("fresh");
    expect(
      resolvePoolStandingsFreshness({
        standings: stamp({ data_revision: "an-older-season-revision" }),
        scoringRevision: SCORING_REVISION,
        dataRevision: null,
      }),
    ).toBe("fresh");
  });

  it("never answers anything but fresh, stale or missing", () => {
    const answers = new Set(
      [
        { standings: undefined },
        { standings: stamp() },
        { standings: stamp({ data_revision: "x" }) },
        { standings: stamp({ scoring_revision: "x" }) },
      ].map((input) =>
        resolvePoolStandingsFreshness({
          ...input,
          scoringRevision: SCORING_REVISION,
          dataRevision: DATA_REVISION,
        }),
      ),
    );
    expect([...answers].sort()).toEqual(["fresh", "missing", "stale"]);
  });
});

// ---------------------------------------------------------------------------
// View resolver: stale versus missing on screen
// ---------------------------------------------------------------------------

describe("resolvePoolStandingsView", () => {
  const base = {
    poolLoaded: true,
    summaryLoaded: true,
    scoringRevision: SCORING_REVISION,
  };

  it("renders a revision-matching cache with no result-collection read", () => {
    const view = resolvePoolStandingsView({
      ...base,
      pool: poolDoc(),
      summary: summaryDoc([row("wanda", 42, 1), row("pete", 30, 2)]),
      dataRevision: DATA_REVISION,
    });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.freshness).toBe("fresh");
    expect(view.rows).toEqual([
      { handle: "wanda", total: 42, rank: 1 },
      { handle: "pete", total: 30, rank: 2 },
    ]);
  });

  it("renders a stale cache with its as-of stamp for a signed-out visitor", () => {
    const view = resolvePoolStandingsView({
      ...base,
      pool: poolDoc(),
      summary: summaryDoc([row("wanda", 42, 1)], {
        ...stamp({ scoring_revision: "an-older-build" }),
        entry_count: 1,
        rows: [row("wanda", 42, 1)],
        page_count: 0,
      }),
      // Signed out: no data revision, because there is no season read.
    });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.freshness).toBe("stale");
    expect(view.rows).toEqual([{ handle: "wanda", total: 42, rank: 1 }]);
    expect(view.episodeNum).toBe(7);
    expect(describePoolStandingsAsOf(view).label).toContain("episode 7");
  });

  it("renders a stale cache with its as-of stamp for a signed-in visitor", () => {
    const view = resolvePoolStandingsView({
      ...base,
      pool: poolDoc(),
      summary: summaryDoc([row("wanda", 42, 1)]),
      dataRevision: "a-newer-season-revision",
    });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.freshness).toBe("stale");
    expect(view.rows).toEqual([{ handle: "wanda", total: 42, rank: 1 }]);
    expect(describePoolStandingsAsOf(view).label).toContain("episode 7");
  });

  it("renders the empty state, not zeros, when the document is absent", () => {
    for (const dataRevision of [DATA_REVISION, undefined]) {
      const view = resolvePoolStandingsView({
        ...base,
        pool: poolDoc(),
        summary: undefined,
        dataRevision,
      });
      expect(view.kind).toBe("empty");
      if (view.kind !== "empty") return;
      expect(view.reason).toBe("absent");
      expect(view).not.toHaveProperty("rows");
    }
  });

  it("renders the empty state before the first episode is scored", () => {
    const view = resolvePoolStandingsView({
      ...base,
      pool: poolDoc({ latest_episode_num: null }),
      summary: undefined,
    });
    expect(view).toEqual({ kind: "empty", reason: "not-scored" });
  });

  it("renders nothing at all when display_mode is not full", () => {
    const view = resolvePoolStandingsView({
      ...base,
      pool: poolDoc({ display_mode: "leaderboard" }),
      summary: summaryDoc([row("wanda", 42, 1)]),
      dataRevision: DATA_REVISION,
    });
    expect(view).toEqual({ kind: "hidden" });
  });

  it("is pending until the config resolves, and never empty in the meantime", () => {
    const view = resolvePoolStandingsView({
      ...base,
      poolLoaded: false,
      pool: undefined,
      summary: undefined,
    });
    expect(view).toEqual({ kind: "pending" });
  });

  it("is pending while the summary read is in flight", () => {
    const view = resolvePoolStandingsView({
      ...base,
      summaryLoaded: false,
      pool: poolDoc(),
      summary: undefined,
    });
    expect(view).toEqual({ kind: "pending" });
  });

  it("reports no pool once the config resolves absent", () => {
    const view = resolvePoolStandingsView({
      ...base,
      pool: undefined,
      summary: undefined,
    });
    expect(view).toEqual({ kind: "empty", reason: "no-pool" });
  });

  it("renders every overflow page in order once expanded", () => {
    const pageRows = (start: number, count: number) =>
      Array.from({ length: count }, (_unused, i) =>
        row(`entrant-${start + i}`, 100 - start - i, start + i + 1),
      );
    const pages: PoolStandingsPage[] = [
      { ...stamp(), page: 0, rows: pageRows(0, 3) },
      { ...stamp(), page: 1, rows: pageRows(3, 2) },
    ];
    const view = resolvePoolStandingsView({
      ...base,
      pool: poolDoc(),
      summary: summaryDoc(pageRows(0, 3), { entry_count: 5, page_count: 2 }),
      // Pages arrive in whatever order the fetches settled.
      pages: [pages[1], pages[0]],
      dataRevision: DATA_REVISION,
    });
    expect(view.kind).toBe("ready");
    if (view.kind !== "ready") return;
    expect(view.rows.map((r) => r.handle)).toEqual([
      "entrant-0",
      "entrant-1",
      "entrant-2",
      "entrant-3",
      "entrant-4",
    ]);
    expect(view.totalRows).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Row projection: R17
// ---------------------------------------------------------------------------

describe("projectPoolStandingsRows", () => {
  it("keeps handle, total and rank and nothing else", () => {
    expect(projectPoolStandingsRows([row("wanda", 42, 1, 6)])).toEqual([
      { handle: "wanda", total: 42, rank: 1 },
    ]);
  });

  it("drops every field a row might carry beyond the three R17 allows", () => {
    // The property under test: whatever arrives, only three keys leave.
    const contaminated = [
      {
        handle: "wanda",
        total: 42,
        rank: 1,
        prop_bet_points: 6,
        uid: "firebase-uid-1234",
        email: "someone@example.com",
        picks: [{ castaway_id: "US0752", full_name: "Alex Moore" }],
        castaway_id: "US0753",
        full_name: "Jamie Rivera",
        eliminated: true,
        eliminated_episode: 4,
        notes: "Kelley Wentworth",
      },
      {
        handle: "pete",
        total: 30,
        rank: 2,
        roster: ["Sandra Diaz-Twine", "Parvati Shallow"],
      },
    ];

    const projected = projectPoolStandingsRows(contaminated);
    const serialized = JSON.stringify(projected);

    for (const leak of [
      "Alex Moore",
      "Jamie Rivera",
      "Kelley Wentworth",
      "Sandra Diaz-Twine",
      "Parvati Shallow",
      "US0752",
      "US0753",
      "firebase-uid-1234",
      "@",
      "eliminated",
      "prop_bet_points",
      "picks",
    ]) {
      expect(serialized).not.toContain(leak);
    }
    for (const projectedRow of projected) {
      expect(Object.keys(projectedRow).sort()).toEqual([
        "handle",
        "rank",
        "total",
      ]);
    }
  });

  it("drops a row whose shape cannot be trusted rather than rendering junk", () => {
    expect(
      projectPoolStandingsRows([
        { handle: "wanda", total: 42, rank: 1 },
        { handle: 12, total: 42, rank: 1 },
        { handle: "pete", total: "lots", rank: 2 },
        { handle: "sue", total: 10, rank: null },
        null,
        "not a row",
      ]),
    ).toEqual([{ handle: "wanda", total: 42, rank: 1 }]);
  });

  it("preserves the order it was given", () => {
    // rankPoolEntries emits final published order, including its deterministic
    // uid tie-break. Reordering here would visibly reshuffle tied rows.
    const rows = [
      row("c", 10, 1),
      row("a", 10, 1),
      row("b", 10, 1),
      row("z", 4, 4),
    ];
    expect(projectPoolStandingsRows(rows).map((r) => r.handle)).toEqual([
      "c",
      "a",
      "b",
      "z",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Shared ranks (KD4): the common case, not an edge case
// ---------------------------------------------------------------------------

describe("groupPoolStandingsRows", () => {
  it("renders a run of tied entrants as one shared position", () => {
    const rows = projectPoolStandingsRows([
      row("a", 10, 1),
      row("b", 10, 1),
      row("c", 10, 1),
      row("d", 4, 4),
    ]);
    const grouped = groupPoolStandingsRows(rows);
    expect(grouped.map((g) => g.showRank)).toEqual([true, false, false, true]);
    expect(grouped.map((g) => g.tiedCount)).toEqual([3, 3, 3, 1]);
    expect(grouped.map((g) => g.row.rank)).toEqual([1, 1, 1, 4]);
  });

  it("handles fifteen entrants sharing rank one", () => {
    const rows = projectPoolStandingsRows(
      Array.from({ length: 15 }, (_unused, i) => row(`entrant-${i}`, 0, 1)),
    );
    const grouped = groupPoolStandingsRows(rows);
    expect(grouped.filter((g) => g.showRank)).toHaveLength(1);
    expect(grouped.every((g) => g.tiedCount === 15)).toBe(true);
  });

  it("keeps the order rankPoolEntries produced", () => {
    const rows = projectPoolStandingsRows([
      row("zeta", 10, 1),
      row("alpha", 10, 1),
      row("mid", 9, 3),
    ]);
    expect(groupPoolStandingsRows(rows).map((g) => g.row.handle)).toEqual([
      "zeta",
      "alpha",
      "mid",
    ]);
  });
});

// ---------------------------------------------------------------------------
// As-of copy
// ---------------------------------------------------------------------------

describe("describePoolStandingsAsOf", () => {
  const readyView = (freshness: "fresh" | "stale") => ({
    kind: "ready" as const,
    freshness,
    episodeNum: 7,
    computedAt: "2026-09-30T04:12:00.000Z",
    entryCount: 12,
    rows: [],
    totalRows: 12,
    pageCount: 0,
    seasonComplete: false,
  });

  it("names the episode, which R25 accepts as disclosed by design", () => {
    expect(describePoolStandingsAsOf(readyView("fresh")).label).toBe(
      "Standings as of episode 7",
    );
  });

  it("says the totals are the last published ones when stale", () => {
    const described = describePoolStandingsAsOf(readyView("stale"));
    expect(described.label).toBe("Standings as of episode 7");
    expect(described.note).toBeTruthy();
    expect(described.note).toContain("last published");
  });

  it("announces a finished season rather than an episode number", () => {
    const described = describePoolStandingsAsOf({
      ...readyView("fresh"),
      seasonComplete: true,
    });
    expect(described.label).toBe("Final standings");
  });

  it("uses no em-dash in any copy it produces", () => {
    for (const freshness of ["fresh", "stale"] as const) {
      for (const seasonComplete of [false, true]) {
        const described = describePoolStandingsAsOf({
          ...readyView(freshness),
          seasonComplete,
        });
        expect(described.label).not.toContain("—");
        expect(described.note ?? "").not.toContain("—");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Browser-local cache
// ---------------------------------------------------------------------------

const createMemoryStorage = (): PoolStandingsCacheStorage & {
  map: Map<string, string>;
} => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

describe("poolStandingsCache", () => {
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("round-trips a summary document so a returning visitor issues no read", () => {
    const summary = summaryDoc([row("wanda", 42, 1)]);
    writePoolStandingsCache("pool_season_51", 7, summary, { storage });
    const restored = readPoolStandingsCache("pool_season_51", 7, { storage });
    // JSON is the storage format, so a restored `freeze_at` is the plain
    // `{seconds, nanoseconds}` pair without the SDK's `toDate`. Nothing on
    // the read path calls it: the freeze instant is recorded in a standings
    // document so the recompute job can shout when it moves (KTD4), not so
    // the leaderboard can render it.
    expect(restored).toEqual(JSON.parse(JSON.stringify(summary)));
    expect(restored?.rows).toEqual([row("wanda", 42, 1)]);
    expect(restored?.episode_num).toBe(7);
  });

  it("keys the entry by pool, episode, scoring revision and publish stamp", () => {
    expect(poolStandingsCacheKey("pool_season_51", 7, "rev-a", "t1")).toBe(
      "gyt_pool_standings:v1:pool_season_51:episode_7:rev-a:t1",
    );
    expect(poolStandingsCacheKey("pool_season_51", 10, "rev-a", "t1")).not.toBe(
      poolStandingsCacheKey("pool_season_51", 1, "rev-a", "t1"),
    );
  });

  it("misses after an in-place republish of the same episode", () => {
    // A correction republishes the same episode under the same scoring
    // revision, so neither of those segments moves. The publish stamp is the
    // only thing that does, and without it a returning visitor would keep
    // the superseded rows for as long as their storage survived.
    expect(poolStandingsCacheKey("pool_season_51", 7, "rev-a", "t2")).not.toBe(
      poolStandingsCacheKey("pool_season_51", 7, "rev-a", "t1"),
    );
  });

  it("falls back to a stable segment before the first publish", () => {
    expect(poolStandingsCacheKey("pool_season_51", 7, "rev-a")).toBe(
      "gyt_pool_standings:v1:pool_season_51:episode_7:rev-a:unstamped",
    );
  });

  it("misses when the scoring revision has moved, so the deploy forces one read", () => {
    writePoolStandingsCache(
      "pool_season_51",
      7,
      summaryDoc([row("wanda", 42, 1)], {
        ...stamp({ scoring_revision: "old-build" }),
        entry_count: 1,
        rows: [row("wanda", 42, 1)],
        page_count: 0,
      }),
      { storage, scoringRevision: "old-build" },
    );
    expect(
      readPoolStandingsCache("pool_season_51", 7, {
        storage,
        scoringRevision: "new-build",
      }),
    ).toBeUndefined();
    expect(
      readPoolStandingsCache("pool_season_51", 7, {
        storage,
        scoringRevision: "old-build",
      }),
    ).toBeTruthy();
  });

  it("misses when the pointer advances to a new episode", () => {
    writePoolStandingsCache(
      "pool_season_51",
      9,
      summaryDoc([row("wanda", 42, 1)]),
      { storage },
    );
    expect(
      readPoolStandingsCache("pool_season_51", 10, { storage }),
    ).toBeUndefined();
  });

  it("rejects a payload whose stored stamp disagrees with the key", () => {
    // Hand-edited or half-written storage must not be trusted onto a public
    // surface. A mismatched episode reads as a miss, not as episode 9's rows
    // labelled episode 10.
    storage.setItem(
      poolStandingsCacheKey("pool_season_51", 10, SCORING_REVISION),
      JSON.stringify({
        version: 1,
        summary: summaryDoc([row("wanda", 42, 1)]),
      }),
    );
    expect(
      readPoolStandingsCache("pool_season_51", 10, { storage }),
    ).toBeUndefined();
  });

  it("reads a malformed payload as a miss and clears it", () => {
    const key = poolStandingsCacheKey("pool_season_51", 7, SCORING_REVISION);
    storage.setItem(key, "{not json");
    expect(
      readPoolStandingsCache("pool_season_51", 7, { storage }),
    ).toBeUndefined();
    expect(storage.getItem(key)).toBeNull();
  });

  it("degrades without throwing when storage is unavailable", () => {
    const hostile: PoolStandingsCacheStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() =>
      writePoolStandingsCache(
        "pool_season_51",
        7,
        summaryDoc([row("wanda", 42, 1)]),
        { storage: hostile },
      ),
    ).not.toThrow();
    expect(
      readPoolStandingsCache("pool_season_51", 7, { storage: hostile }),
    ).toBeUndefined();
    expect(() =>
      clearPoolStandingsCache("pool_season_51", 7, { storage: hostile }),
    ).not.toThrow();
  });

  it("clears an entry on request", () => {
    writePoolStandingsCache(
      "pool_season_51",
      7,
      summaryDoc([row("wanda", 42, 1)]),
      { storage },
    );
    clearPoolStandingsCache("pool_season_51", 7, { storage });
    expect(
      readPoolStandingsCache("pool_season_51", 7, { storage }),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The season-document boundary, asserted on the source itself
// ---------------------------------------------------------------------------

const HOOK_SOURCES = import.meta.glob(
  [
    "../usePoolStandings.ts",
    "../../utils/poolStandingsRead.ts",
    "../../utils/poolStandingsCache.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/**
 * Blank out comments so an assertion about the code is not tripped by a doc
 * block that names the very thing it explains avoiding.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the read path can never issue a season document read", () => {
  it("reads three source files, so the assertions below are not vacuous", () => {
    expect(Object.keys(HOOK_SOURCES)).toHaveLength(3);
  });

  it("names no season collection and imports no season hook", () => {
    // R22 is enforced structurally rather than by discipline: there is no
    // season read anywhere in this path, so a homepage caller cannot trigger
    // one however it calls the hook. A surface that legitimately has a data
    // revision passes it in as a value.
    for (const [file, source] of Object.entries(HOOK_SOURCES)) {
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      expect(code, `${file} must not import useSeason`).not.toMatch(
        /from\s+["'][^"']*useSeason["']/,
      );
      expect(code, `${file} must not name a season collection`).not.toMatch(
        /["']seasons["']/,
      );
      for (const collection of ["events", "challenges", "eliminations"]) {
        expect(
          code,
          `${file} must not name the ${collection} collection`,
        ).not.toMatch(new RegExp(`["']${collection}["']`));
      }
    }
  });

  it("uses one-time document fetches and opens no snapshot listener", () => {
    const hook = stripComments(HOOK_SOURCES["../usePoolStandings.ts"] ?? "");
    expect(hook).toBeTruthy();
    // A listener over a world-readable collection is billed again on every
    // reconnect, on the highest-traffic public page in the product.
    expect(hook).not.toContain("onSnapshot");
    expect(hook).toContain("getDoc");
  });
});
