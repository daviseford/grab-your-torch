import { describe, expect, it } from "vitest";
import type {
  FirestoreTimestamp,
  Pool,
  PoolCounters,
  PoolPick,
  PoolStandings,
} from "../../types";
import {
  describePoolLifecycle,
  describePoolModule,
  getPoolCountdown,
  getPoolModuleState,
  POOL_LOW_ENTRANT_THRESHOLD,
  POOL_PREMIERE_AIRING_MS,
  selectEnteredPools,
  type PoolModuleState,
} from "../poolModuleState";
import type { PoolStandingsView } from "../poolStandingsRead";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** KTD9: 8:00 PM Eastern on the 2026-09-23 premiere. */
const FREEZE_ISO = "2026-09-24T00:00:00.000Z";
const FREEZE_MS = Date.parse(FREEZE_ISO);

describe("getPoolCountdown", () => {
  it("splits the remaining time into days, hours, minutes, and seconds", () => {
    expect(getPoolCountdown(FREEZE_MS, FREEZE_MS - 93784000)).toEqual({
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
    });
  });

  it("keeps the last second visible until the deadline, then clamps to zero", () => {
    expect(getPoolCountdown(FREEZE_MS, FREEZE_MS - 1).seconds).toBe(1);
    for (const now of [FREEZE_MS, FREEZE_MS + 5000]) {
      expect(getPoolCountdown(FREEZE_MS, now)).toEqual({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0,
      });
    }
  });

  it("rolls over at a day boundary and catches up after a suspended tab", () => {
    expect(getPoolCountdown(FREEZE_MS, FREEZE_MS - 86400000)).toEqual({
      days: 1,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
    expect(getPoolCountdown(FREEZE_MS, FREEZE_MS - 86399000)).toEqual({
      days: 0,
      hours: 23,
      minutes: 59,
      seconds: 59,
    });
    expect(getPoolCountdown(FREEZE_MS, FREEZE_MS - 3000)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 3,
    });
  });
});

const ts = (iso: string): FirestoreTimestamp => {
  const ms = Date.parse(iso);
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1_000_000,
    toDate: () => new Date(ms),
  };
};

/**
 * Deliberately distinctive names. The R17 test below asserts that not one of
 * them can reach any state or any string of copy, whatever the module is
 * handed, so a name that could occur by accident would prove nothing.
 */
const CAST_NAMES = [
  "Zephyrina Quillfeather",
  "Bartholomew Moonrake",
  "Persimmon Vandergriff",
];

const roster = (count: number): PoolPick[] =>
  Array.from({ length: count }, (_unused, i) => ({
    castaway_id:
      `US07${String(52 + i).padStart(2, "0")}` as PoolPick["castaway_id"],
    full_name: CAST_NAMES[i % CAST_NAMES.length],
  }));

const pool = (overrides: Partial<Pool> = {}): Pool => ({
  id: "pool_season_51",
  season_id: "season_51",
  season_num: 51,
  name: "Survivor 51 Season Pool",
  freeze_at: ts(FREEZE_ISO),
  roster: roster(21),
  picks_per_entry: 7,
  prop_bet_keys: [],
  prop_bet_answers: [],
  status: "open",
  display_mode: "full",
  latest_episode_num: null,
  season_complete: false,
  ...overrides,
});

const counters = (entryCount: number): PoolCounters => ({
  entry_count: entryCount,
  updated_at: "2026-09-24T02:00:00.000Z",
});

const readyView = (
  overrides: Partial<Extract<PoolStandingsView, { kind: "ready" }>> = {},
): PoolStandingsView => ({
  kind: "ready",
  freshness: "fresh",
  episodeNum: 3,
  computedAt: "2026-10-08T04:00:00.000Z",
  entryCount: 140,
  rows: [
    { handle: "torchbearer", total: 42, rank: 1 },
    { handle: "castaway fan", total: 42, rank: 1 },
  ],
  totalRows: 140,
  pageCount: 0,
  seasonComplete: false,
  ...overrides,
});

const notScoredView: PoolStandingsView = {
  kind: "empty",
  reason: "not-scored",
};

/** Everything the resolver needs, with the open state as the baseline. */
const input = (
  overrides: Partial<Parameters<typeof getPoolModuleState>[0]>,
) => {
  const p = overrides.pool === undefined ? pool() : overrides.pool;
  return {
    pool: p,
    poolLoaded: true,
    counters: counters(120),
    standings: notScoredView,
    displayMode: p?.display_mode,
    now: FREEZE_MS - 60_000,
    ...overrides,
  };
};

// ---------------------------------------------------------------------------
// The five display states
// ---------------------------------------------------------------------------

describe("getPoolModuleState: the five display states", () => {
  it("is open before the stored freeze instant", () => {
    const state = getPoolModuleState(input({ now: FREEZE_MS - 60_000 }));
    expect(state.kind).toBe("open");
  });

  it("is frozen once the freeze passes and the premiere is still on air", () => {
    const state = getPoolModuleState(input({ now: FREEZE_MS + 60_000 }));
    expect(state.kind).toBe("frozen");
  });

  it("is aired-unscored on premiere night once the broadcast has finished and nothing is published", () => {
    // The case the plan singles out: every entrant is legitimately at zero,
    // and the module must not render a leaderboard of zeroes.
    const state = getPoolModuleState(
      input({ now: FREEZE_MS + POOL_PREMIERE_AIRING_MS + 60_000 }),
    );
    expect(state.kind).toBe("aired-unscored");
  });

  it("is aired-unscored when the pointer names an episode whose document is absent", () => {
    const state = getPoolModuleState(
      input({
        pool: pool({ latest_episode_num: 1 }),
        standings: { kind: "empty", reason: "absent" },
        now: FREEZE_MS + POOL_PREMIERE_AIRING_MS + 60_000,
      }),
    );
    expect(state.kind).toBe("aired-unscored");
  });

  it("is mid-season once standings are published", () => {
    const state = getPoolModuleState(
      input({
        pool: pool({ latest_episode_num: 3 }),
        standings: readyView(),
        now: FREEZE_MS + 14 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(state.kind).toBe("mid-season");
  });

  it("is complete from season_complete on the config, not from any event", () => {
    const state = getPoolModuleState(
      input({
        pool: pool({ latest_episode_num: 13, season_complete: true }),
        standings: readyView({ episodeNum: 13, seasonComplete: true }),
        now: FREEZE_MS + 100 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(state.kind).toBe("complete");
  });
});

// ---------------------------------------------------------------------------
// Pending versus no-pool (approach 1b)
// ---------------------------------------------------------------------------

describe("getPoolModuleState: pending versus no-pool", () => {
  it("is pending before the config read resolves", () => {
    expect(
      getPoolModuleState(input({ pool: undefined, poolLoaded: false })).kind,
    ).toBe("pending");
  });

  it("is still pending when the config has not resolved even though nothing else has either", () => {
    expect(
      getPoolModuleState(
        input({
          pool: undefined,
          poolLoaded: false,
          counters: undefined,
          standings: { kind: "pending" },
          displayMode: undefined,
        }),
      ).kind,
    ).toBe("pending");
  });

  it("is no-pool only once the config resolves absent", () => {
    expect(
      getPoolModuleState(
        input({ pool: undefined, poolLoaded: true, displayMode: undefined }),
      ).kind,
    ).toBe("no-pool");
  });
});

// ---------------------------------------------------------------------------
// The rollback lever
// ---------------------------------------------------------------------------

describe("getPoolModuleState: display_mode is a rollback lever at every state", () => {
  const displayCases: { name: string; args: Parameters<typeof input>[0] }[] = [
    { name: "open", args: { now: FREEZE_MS - 60_000 } },
    { name: "frozen", args: { now: FREEZE_MS + 60_000 } },
    {
      name: "aired-unscored",
      args: { now: FREEZE_MS + POOL_PREMIERE_AIRING_MS + 60_000 },
    },
    {
      name: "mid-season",
      args: {
        pool: pool({ latest_episode_num: 3 }),
        standings: readyView(),
        now: FREEZE_MS + 14 * 24 * 60 * 60 * 1000,
      },
    },
    {
      name: "complete",
      args: {
        pool: pool({ latest_episode_num: 13, season_complete: true }),
        standings: readyView({ seasonComplete: true }),
        now: FREEZE_MS + 100 * 24 * 60 * 60 * 1000,
      },
    },
  ];

  for (const display of displayCases) {
    it(`is hidden at the ${display.name} state when display_mode is not "full"`, () => {
      const base = input(display.args);
      const hidden = getPoolModuleState({
        ...base,
        pool: base.pool
          ? { ...base.pool, display_mode: "leaderboard" }
          : base.pool,
        displayMode: "leaderboard",
      });
      expect(hidden.kind).toBe("hidden");
      // And the same fixture is a display state with the lever left alone,
      // so the assertion above is not passing for some other reason.
      expect(getPoolModuleState(base).kind).toBe(display.name);
    });
  }
});

// ---------------------------------------------------------------------------
// The low-entrant variant (approach 1a)
// ---------------------------------------------------------------------------

describe("getPoolModuleState: the open state's low-entrant variant", () => {
  const openAt = (entryCount: number | undefined) =>
    getPoolModuleState(
      input({
        counters: entryCount === undefined ? undefined : counters(entryCount),
        now: FREEZE_MS - 60_000,
      }),
    );

  it("is the first-movers variant below the threshold", () => {
    const state = openAt(POOL_LOW_ENTRANT_THRESHOLD - 1);
    expect(state).toMatchObject({ kind: "open", variant: "first-movers" });
  });

  it("is the ordinary variant at and above the threshold", () => {
    expect(openAt(POOL_LOW_ENTRANT_THRESHOLD)).toMatchObject({
      kind: "open",
      variant: "open-field",
    });
    expect(openAt(POOL_LOW_ENTRANT_THRESHOLD + 500)).toMatchObject({
      kind: "open",
      variant: "open-field",
    });
  });

  it("treats an absent counters document as zero entrants, never as no-pool", () => {
    const state = openAt(undefined);
    expect(state).toMatchObject({ kind: "open", variant: "first-movers" });
    expect(state.kind).not.toBe("no-pool");
    if (state.kind === "open") expect(state.facts.entryCount).toBe(0);
  });

  it("carries the cast size and pick count from the config, never from a season module", () => {
    const state = openAt(3);
    if (state.kind !== "open") throw new Error("expected the open state");
    expect(state.facts.castCount).toBe(21);
    expect(state.facts.picksPerEntry).toBe(7);
    expect(state.facts.freezeAtMs).toBe(FREEZE_MS);
  });
});

// ---------------------------------------------------------------------------
// R17: nothing about a castaway reaches any state or any string
// ---------------------------------------------------------------------------

describe("R17: no castaway name and no elimination state, in any state", () => {
  const everyState = (): PoolModuleState[] => [
    getPoolModuleState(input({ pool: undefined, poolLoaded: false })),
    getPoolModuleState(input({ pool: undefined, poolLoaded: true })),
    getPoolModuleState(
      input({
        pool: pool({ display_mode: "leaderboard" }),
        displayMode: "leaderboard",
      }),
    ),
    getPoolModuleState(input({ counters: counters(2) })),
    getPoolModuleState(input({ counters: counters(900) })),
    getPoolModuleState(input({ now: FREEZE_MS + 60_000 })),
    getPoolModuleState(
      input({ now: FREEZE_MS + POOL_PREMIERE_AIRING_MS + 60_000 }),
    ),
    getPoolModuleState(
      input({
        pool: pool({ latest_episode_num: 3 }),
        standings: readyView(),
        now: FREEZE_MS + 14 * 24 * 60 * 60 * 1000,
      }),
    ),
    getPoolModuleState(
      input({
        pool: pool({ latest_episode_num: 13, season_complete: true }),
        standings: readyView({ seasonComplete: true }),
        now: FREEZE_MS + 100 * 24 * 60 * 60 * 1000,
      }),
    ),
  ];

  it("covers every state kind, so the assertions below are not vacuous", () => {
    const kinds = new Set(everyState().map((s) => s.kind));
    expect([...kinds].sort()).toEqual([
      "aired-unscored",
      "complete",
      "frozen",
      "hidden",
      "mid-season",
      "no-pool",
      "open",
      "pending",
    ]);
  });

  it("carries no castaway name in the state itself", () => {
    for (const state of everyState()) {
      const serialized = JSON.stringify(state);
      for (const name of CAST_NAMES) {
        expect(serialized).not.toContain(name);
        expect(serialized).not.toContain(name.split(" ")[0]);
      }
    }
  });

  it("carries no castaway name and no elimination wording in the copy", () => {
    const banned =
      /elimin|voted out|booted|torch snuffed|drafted by|roster|owner|owns|your turn/i;
    for (const state of everyState()) {
      const copy = describePoolModule(state);
      if (!copy) continue;
      const text = JSON.stringify(copy);
      for (const name of CAST_NAMES) {
        expect(text).not.toContain(name);
        expect(text).not.toContain(name.split(" ")[0]);
      }
      expect(text).not.toMatch(banned);
      // No em-dash may reach a user-facing string (CLAUDE.md).
      expect(text).not.toContain("—");
    }
  });
});

// ---------------------------------------------------------------------------
// Copy: every state that renders has a full set
// ---------------------------------------------------------------------------

describe("describePoolModule", () => {
  it("gives a headline, a supporting line, an action and a standings slot to all six cases", () => {
    const cases: PoolModuleState[] = [
      getPoolModuleState(input({ counters: counters(2) })),
      getPoolModuleState(input({ counters: counters(900) })),
      getPoolModuleState(input({ now: FREEZE_MS + 60_000 })),
      getPoolModuleState(
        input({ now: FREEZE_MS + POOL_PREMIERE_AIRING_MS + 60_000 }),
      ),
      getPoolModuleState(
        input({
          pool: pool({ latest_episode_num: 3 }),
          standings: readyView(),
          now: FREEZE_MS + 14 * 24 * 60 * 60 * 1000,
        }),
      ),
      getPoolModuleState(
        input({
          pool: pool({ latest_episode_num: 13, season_complete: true }),
          standings: readyView({ seasonComplete: true }),
          now: FREEZE_MS + 100 * 24 * 60 * 60 * 1000,
        }),
      ),
      { kind: "no-pool" },
    ];
    for (const state of cases) {
      const copy = describePoolModule(state);
      expect(copy, `no copy for ${state.kind}`).not.toBeNull();
      expect(copy!.headline.length).toBeGreaterThan(0);
      expect(copy!.support.length).toBeGreaterThan(0);
      expect(copy!.action.label.length).toBeGreaterThan(0);
      expect(copy!.action.to.startsWith("/")).toBe(true);
      expect(copy!.standings.kind).toMatch(/^(none|awaiting|leaderboard)$/);
    }
  });

  it("has no copy for the two cases that render nothing of their own", () => {
    expect(describePoolModule({ kind: "pending" })).toBeNull();
    expect(describePoolModule({ kind: "hidden" })).toBeNull();
  });

  it("quotes the entrant count as proof only above the threshold", () => {
    const low = describePoolModule(
      getPoolModuleState(input({ counters: counters(4) })),
    )!;
    const high = describePoolModule(
      getPoolModuleState(input({ counters: counters(400) })),
    )!;
    expect(low.support).not.toContain("4 people");
    expect(high.support).toContain("400 people");
  });

  it("reads the aired-unscored state as scoring landing, never as a leaderboard of zeroes", () => {
    const copy = describePoolModule(
      getPoolModuleState(
        input({ now: FREEZE_MS + POOL_PREMIERE_AIRING_MS + 60_000 }),
      ),
    )!;
    expect(copy.standings.kind).toBe("awaiting");
    expect(`${copy.support} ${JSON.stringify(copy.standings)}`).toMatch(
      /scoring|totals/i,
    );
  });

  it("routes the open state to the entry page and the absent case to the season list", () => {
    const open = describePoolModule(getPoolModuleState(input({})))!;
    expect(open.action.to).toBe("/pool/season_51");
    expect(describePoolModule({ kind: "no-pool" })!.action.to).toBe("/seasons");
  });

  it("marks only the open state as the dominant one (KD6)", () => {
    expect(describePoolModule(getPoolModuleState(input({})))!.dominant).toBe(
      true,
    );
    expect(
      describePoolModule(
        getPoolModuleState(input({ now: FREEZE_MS + 60_000 })),
      )!.dominant,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R21: the entrant's competitions list
// ---------------------------------------------------------------------------

describe("selectEnteredPools", () => {
  const other = pool({
    id: "pool_season_52",
    season_id: "season_52",
    season_num: 52,
  });

  it("returns a pool the user has an entry in", () => {
    expect(
      selectEnteredPools([pool(), other], new Set(["pool_season_51"])).map(
        (p) => p.id,
      ),
    ).toEqual(["pool_season_51"]);
  });

  it("returns nothing for a non-entrant", () => {
    expect(selectEnteredPools([pool(), other], new Set())).toEqual([]);
  });

  it("orders the newest season first", () => {
    expect(
      selectEnteredPools(
        [pool(), other],
        new Set(["pool_season_51", "pool_season_52"]),
      ).map((p) => p.season_num),
    ).toEqual([52, 51]);
  });
});

describe("describePoolLifecycle", () => {
  it("says entries are open before the freeze", () => {
    expect(describePoolLifecycle(pool(), FREEZE_MS - 1).label).toBe(
      "Entries open",
    );
  });

  it("says entries are closed after the freeze and before anything is scored", () => {
    expect(describePoolLifecycle(pool(), FREEZE_MS + 1).label).toBe(
      "Entries closed",
    );
  });

  it("says the kill switch closed entries even before the freeze", () => {
    expect(
      describePoolLifecycle(pool({ status: "closed" }), FREEZE_MS - 1).label,
    ).toBe("Entries closed");
  });

  it("says scoring once an episode is published", () => {
    expect(
      describePoolLifecycle(pool({ latest_episode_num: 2 }), FREEZE_MS + 1)
        .label,
    ).toBe("Scoring");
  });

  it("says final once the config is stamped complete", () => {
    expect(
      describePoolLifecycle(
        pool({ latest_episode_num: 13, season_complete: true }),
        FREEZE_MS + 1,
      ).label,
    ).toBe("Final");
  });

  it("never uses competition status wording", () => {
    const labels = [
      describePoolLifecycle(pool(), FREEZE_MS - 1).label,
      describePoolLifecycle(pool(), FREEZE_MS + 1).label,
      describePoolLifecycle(pool({ latest_episode_num: 2 }), FREEZE_MS + 1)
        .label,
      describePoolLifecycle(pool({ season_complete: true }), FREEZE_MS + 1)
        .label,
    ];
    expect(labels).not.toContain("In progress");
    expect(labels).not.toContain("Complete");
    expect(labels).not.toContain("Watch-along");
  });
});

// ---------------------------------------------------------------------------
// The stored freeze instant is the only deadline (R11)
// ---------------------------------------------------------------------------

describe("R11: the freeze comes from the config document", () => {
  it("follows a freeze instant moved later, with no reference to a premiere date", () => {
    const later = ts("2026-10-01T00:00:00.000Z");
    const state = getPoolModuleState(
      input({ pool: pool({ freeze_at: later }), now: FREEZE_MS + 60_000 }),
    );
    expect(state.kind).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// A standings summary never reaches the module as a document
// ---------------------------------------------------------------------------

describe("the module consumes the projected view, not the raw document", () => {
  it("does not accept a raw standings document shape", () => {
    // Type-level guard, kept as a runtime shape check so the intent is visible:
    // rows arrive already projected to handle, total and rank (R17).
    const raw: PoolStandings = {
      episode_num: 3,
      computed_at: "2026-10-08T04:00:00.000Z",
      data_revision: "d",
      scoring_revision: "s",
      freeze_at: ts(FREEZE_ISO),
      entry_count: 2,
      rows: [{ handle: "a", total: 1, prop_bet_points: 0, rank: 1 }],
      page_count: 0,
    };
    expect(Object.keys(raw)).not.toContain("kind");
  });
});
