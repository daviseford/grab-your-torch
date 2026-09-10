/**
 * Pure logic behind the pool entry page (U4).
 *
 * This repo has no React Testing Library and no `.test.tsx`, so every decision
 * the entry page makes is extracted into a pure module and tested here:
 *
 *  - the pick reducer (select, deselect, replace-earliest at the limit),
 *  - handle validation, which mirrors the Firestore rules regex exactly so the
 *    client rejects before the server does rather than after,
 *  - the entry payload builder, which must produce exactly the create shape
 *    the rules accept, with picks copied verbatim out of the pool roster,
 *  - the page-state resolver.
 *
 * Keyboard operability and the 375px compact layout are deliberately not
 * covered here; see the no-test exception recorded in `PoolCastPicker.tsx`.
 */

import { describe, expect, it } from "vitest";
import { PropBetQuestionKeys } from "../../data/propbets";
import type { Pool, PoolPick, PropBetsFormData } from "../../types";
import {
  buildPoolEntryPayload,
  getPoolEntryBlockers,
  PoolEntryPayloadError,
} from "../../utils/poolEntryPayload";
import {
  POOL_HANDLE_MAX,
  POOL_HANDLE_MIN,
  suggestPoolHandle,
  validatePoolHandle,
} from "../../utils/poolHandle";
import { poolIdForSeason, seasonNumFromSeasonId } from "../../utils/poolIds";
import {
  resolvePoolPageState,
  timestampToMillis,
} from "../../utils/poolPageState";
import {
  isPoolPickSelected,
  nextPoolSwapTarget,
  togglePoolPick,
} from "../../utils/poolPicks";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roster: PoolPick[] = [
  { castaway_id: "US0752", full_name: "Aaliyah Puglia" },
  { castaway_id: "US0753", full_name: "Alexis Levine" },
  { castaway_id: "US0754", full_name: "Bianca Roses" },
  { castaway_id: "US0755", full_name: "Carlos Cruz" },
  { castaway_id: "US0756", full_name: "Dana Rivers" },
  { castaway_id: "US0757", full_name: "Eli Vance" },
  { castaway_id: "US0758", full_name: "Fern Okoro" },
  { castaway_id: "US0759", full_name: "Gus Han" },
  { castaway_id: "US0760", full_name: "Hana Ito" },
];

const LIMIT = 3;

const answeredPropBets = (): PropBetsFormData =>
  PropBetQuestionKeys.reduce<PropBetsFormData>((accum, key) => {
    accum[key] = "US0752";
    return accum;
  }, {});

const timestamp = (seconds: number) => ({
  seconds,
  nanoseconds: 0,
  toDate: () => new Date(seconds * 1000),
});

const futureTimestamp = timestamp(4_000_000_000);
const pastTimestamp = timestamp(1_000_000_000);

const pool = (overrides: Partial<Pool> = {}): Pool =>
  ({
    id: "pool_season_51",
    season_id: "season_51",
    season_num: 51,
    name: "Survivor 51 Season Pool",
    freeze_at: futureTimestamp,
    roster,
    picks_per_entry: LIMIT,
    prop_bet_keys: [...PropBetQuestionKeys],
    status: "open",
    display_mode: "full",
    latest_episode_num: null,
    season_complete: false,
    ...overrides,
  }) as Pool;

const sentinelTimestamp = () => ({ __serverTimestamp: true });

// ---------------------------------------------------------------------------
// Pick reducer
// ---------------------------------------------------------------------------

describe("togglePoolPick", () => {
  it("adds an unselected castaway below the limit", () => {
    const result = togglePoolPick([], roster[0], LIMIT);
    expect(result.action).toBe("added");
    expect(result.picks).toEqual([roster[0]]);
    expect(result.removed).toBeUndefined();
  });

  it("removes a selected castaway when it is activated again", () => {
    const result = togglePoolPick([roster[0], roster[1]], roster[0], LIMIT);
    expect(result.action).toBe("removed");
    expect(result.picks).toEqual([roster[1]]);
    expect(result.removed).toEqual(roster[0]);
  });

  it("never selects the same castaway twice", () => {
    const once = togglePoolPick([], roster[0], LIMIT);
    const twice = togglePoolPick(once.picks, roster[0], LIMIT);
    expect(twice.picks).toHaveLength(0);
    // And a distinct object carrying the same id is still the same castaway.
    const again = togglePoolPick(
      [roster[0]],
      { castaway_id: "US0752", full_name: "Aaliyah Puglia" },
      LIMIT,
    );
    expect(again.action).toBe("removed");
    expect(again.picks).toHaveLength(0);
  });

  it("never grows past the limit: at the limit it replaces the earliest pick", () => {
    const full = [roster[0], roster[1], roster[2]];
    const result = togglePoolPick(full, roster[3], LIMIT);
    expect(result.action).toBe("swapped");
    expect(result.removed).toEqual(roster[0]);
    expect(result.picks).toEqual([roster[1], roster[2], roster[3]]);
    expect(result.picks).toHaveLength(LIMIT);
  });

  it("keeps replacing the earliest pick as further castaways are chosen", () => {
    let picks: PoolPick[] = [];
    for (const entry of roster) {
      picks = togglePoolPick(picks, entry, LIMIT).picks;
      expect(picks.length).toBeLessThanOrEqual(LIMIT);
    }
    expect(picks).toEqual([roster[6], roster[7], roster[8]]);
  });

  it("does not mutate the array it is given", () => {
    const before = [roster[0]];
    const snapshot = [...before];
    togglePoolPick(before, roster[1], LIMIT);
    expect(before).toEqual(snapshot);
  });

  it("blocks selection when the limit is zero", () => {
    const result = togglePoolPick([], roster[0], 0);
    expect(result.action).toBe("blocked");
    expect(result.picks).toEqual([]);
  });
});

describe("nextPoolSwapTarget", () => {
  it("names the pick that the next selection would replace", () => {
    expect(
      nextPoolSwapTarget([roster[0], roster[1], roster[2]], LIMIT),
    ).toEqual(roster[0]);
  });

  it("is null below the limit, because nothing would be replaced", () => {
    expect(nextPoolSwapTarget([roster[0]], LIMIT)).toBeNull();
    expect(nextPoolSwapTarget([], LIMIT)).toBeNull();
  });
});

describe("isPoolPickSelected", () => {
  it("matches on castaway id, not object identity", () => {
    expect(isPoolPickSelected([roster[0]], "US0752")).toBe(true);
    expect(isPoolPickSelected([roster[0]], "US0753")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Handle validation
// ---------------------------------------------------------------------------

describe("validatePoolHandle", () => {
  it("accepts the shapes the security rules accept", () => {
    for (const handle of [
      "ab",
      "Jo",
      "Torch_Bearer",
      "torch-bearer",
      "Sandra Diaz Twine",
      "a".repeat(POOL_HANDLE_MAX),
      "9_9",
    ]) {
      expect(validatePoolHandle(handle), handle).toBeNull();
    }
  });

  it("rejects an empty handle", () => {
    expect(validatePoolHandle("")).not.toBeNull();
  });

  it("rejects a handle under the minimum", () => {
    expect(validatePoolHandle("a".repeat(POOL_HANDLE_MIN - 1))).not.toBeNull();
  });

  it("rejects a handle over the maximum", () => {
    expect(validatePoolHandle("a".repeat(POOL_HANDLE_MAX + 1))).not.toBeNull();
  });

  it("rejects a leading or trailing space", () => {
    expect(validatePoolHandle(" torch")).not.toBeNull();
    expect(validatePoolHandle("torch ")).not.toBeNull();
  });

  it("rejects a control character", () => {
    expect(validatePoolHandle("tor\u0001ch")).not.toBeNull();
  });

  it("rejects a zero-width character", () => {
    expect(validatePoolHandle("tor\u200bch")).not.toBeNull();
  });

  it("rejects a bidi override character", () => {
    expect(validatePoolHandle("tor\u202ech")).not.toBeNull();
  });

  it("rejects a URL", () => {
    expect(validatePoolHandle("https://evil.example")).not.toBeNull();
    expect(validatePoolHandle("evil.example/x")).not.toBeNull();
  });

  it("rejects markup and other punctuation", () => {
    expect(validatePoolHandle("<b>hi</b>")).not.toBeNull();
    expect(validatePoolHandle("a@b")).not.toBeNull();
  });

  it("rejects a trailing newline, which a bare JS $ anchor would allow", () => {
    // RE2 full-match semantics in Firestore rules deny this; a naive
    // /...$/.test() in JavaScript accepts it, which would let the client
    // pass a payload the server then rejects.
    expect(validatePoolHandle("torch\n")).not.toBeNull();
    expect(validatePoolHandle("torch\r\n")).not.toBeNull();
  });
});

describe("suggestPoolHandle", () => {
  it("always suggests something the validator accepts", () => {
    for (let i = 0; i < 40; i += 1) {
      const suggestion = suggestPoolHandle(() => i / 40);
      expect(validatePoolHandle(suggestion), suggestion).toBeNull();
    }
  });

  it("is not derived from any account name it is never given", () => {
    // The suggester takes a random source and nothing else: there is no
    // parameter through which a display name could reach it (R5).
    expect(suggestPoolHandle.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Entry payload
// ---------------------------------------------------------------------------

describe("getPoolEntryBlockers", () => {
  it("is empty for a complete entry", () => {
    expect(
      getPoolEntryBlockers({
        pool: pool(),
        picks: [roster[0], roster[1], roster[2]],
        handle: "Torch",
        propBets: answeredPropBets(),
      }),
    ).toEqual([]);
  });

  it("blocks below the pick limit", () => {
    const blockers = getPoolEntryBlockers({
      pool: pool(),
      picks: [roster[0]],
      handle: "Torch",
      propBets: answeredPropBets(),
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].field).toBe("picks");
  });

  it("blocks an empty handle", () => {
    const blockers = getPoolEntryBlockers({
      pool: pool(),
      picks: [roster[0], roster[1], roster[2]],
      handle: "",
      propBets: answeredPropBets(),
    });
    expect(blockers.some((b) => b.field === "handle")).toBe(true);
  });

  it("blocks an invalid handle before submit", () => {
    const blockers = getPoolEntryBlockers({
      pool: pool(),
      picks: [roster[0], roster[1], roster[2]],
      handle: "a".repeat(POOL_HANDLE_MAX + 1),
      propBets: answeredPropBets(),
    });
    expect(blockers.some((b) => b.field === "handle")).toBe(true);
  });

  it("blocks an unanswered prop bet", () => {
    const partial = answeredPropBets();
    delete partial[PropBetQuestionKeys[0]];
    const blockers = getPoolEntryBlockers({
      pool: pool(),
      picks: [roster[0], roster[1], roster[2]],
      handle: "Torch",
      propBets: partial,
    });
    expect(blockers.some((b) => b.field === "prop_bets")).toBe(true);
  });
});

describe("buildPoolEntryPayload", () => {
  const validInput = () => ({
    uid: "uid-123",
    pool: pool(),
    picks: [roster[0], roster[1], roster[2]],
    handle: "Torch",
    propBets: answeredPropBets(),
    timestamp: sentinelTimestamp,
  });

  it("produces exactly the keys the rules allowlist accepts, and no others", () => {
    const payload = buildPoolEntryPayload(validInput());
    expect(Object.keys(payload).sort()).toEqual(
      [
        "created_at",
        "handle",
        "id",
        "picks",
        "pool_id",
        "prop_bets",
        "season_id",
        "updated_at",
      ].sort(),
    );
  });

  it("derives the id from the uid exactly as the rules require", () => {
    expect(buildPoolEntryPayload(validInput()).id).toBe("pool_entry_uid-123");
  });

  it("carries no inner uid field", () => {
    expect("uid" in buildPoolEntryPayload(validInput())).toBe(false);
  });

  it("copies roster objects through verbatim rather than rebuilding names", () => {
    const input = validInput();
    // Deliberately hand it picks whose full_name disagrees with the roster:
    // the roster is ground truth, and the rules match whole pairs (R23).
    const payload = buildPoolEntryPayload({
      ...input,
      picks: [
        { castaway_id: "US0752", full_name: "WRONG NAME" },
        roster[1],
        roster[2],
      ],
    });
    expect(payload.picks[0]).toBe(input.pool.roster[0]);
    expect(payload.picks[0].full_name).toBe("Aaliyah Puglia");
    expect(payload.picks).toEqual([roster[0], roster[1], roster[2]]);
  });

  it("records a name beside every pick", () => {
    for (const pick of buildPoolEntryPayload(validInput()).picks) {
      expect(typeof pick.full_name).toBe("string");
      expect(pick.full_name.length).toBeGreaterThan(0);
      expect(Object.keys(pick).sort()).toEqual(["castaway_id", "full_name"]);
    }
  });

  it("stamps both timestamps from the injected server timestamp", () => {
    const payload = buildPoolEntryPayload(validInput());
    expect(payload.created_at).toEqual({ __serverTimestamp: true });
    expect(payload.updated_at).toEqual({ __serverTimestamp: true });
  });

  it("keeps prop bets to the keys the pool config declares", () => {
    const input = validInput();
    const payload = buildPoolEntryPayload({
      ...input,
      pool: pool({ prop_bet_keys: [PropBetQuestionKeys[0]] }),
      propBets: answeredPropBets(),
    });
    expect(Object.keys(payload.prop_bets)).toEqual([PropBetQuestionKeys[0]]);
  });

  it("refuses the wrong pick count", () => {
    expect(() =>
      buildPoolEntryPayload({ ...validInput(), picks: [roster[0]] }),
    ).toThrow(PoolEntryPayloadError);
  });

  it("refuses duplicate picks", () => {
    expect(() =>
      buildPoolEntryPayload({
        ...validInput(),
        picks: [roster[0], roster[0], roster[1]],
      }),
    ).toThrow(PoolEntryPayloadError);
  });

  it("refuses a pick that is not on the roster", () => {
    expect(() =>
      buildPoolEntryPayload({
        ...validInput(),
        picks: [
          { castaway_id: "US9999", full_name: "Nobody" },
          roster[1],
          roster[2],
        ],
      }),
    ).toThrow(PoolEntryPayloadError);
  });

  it("refuses an invalid handle", () => {
    expect(() =>
      buildPoolEntryPayload({ ...validInput(), handle: "a" }),
    ).toThrow(PoolEntryPayloadError);
  });

  it("refuses an unanswered prop bet", () => {
    const partial = answeredPropBets();
    delete partial[PropBetQuestionKeys[1]];
    expect(() =>
      buildPoolEntryPayload({ ...validInput(), propBets: partial }),
    ).toThrow(PoolEntryPayloadError);
  });
});

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

describe("timestampToMillis", () => {
  it("reads a plain Firestore-shaped timestamp without calling toDate", () => {
    expect(timestampToMillis({ seconds: 5, nanoseconds: 500_000_000 })).toBe(
      5500,
    );
  });
});

describe("resolvePoolPageState", () => {
  const now = 2_000_000_000_000; // well past pastTimestamp, well before futureTimestamp

  it("is loading until the config document has resolved", () => {
    expect(
      resolvePoolPageState({
        pool: undefined,
        poolLoaded: false,
        airStatus: "upcoming",
        now,
      }),
    ).toBe("loading");
  });

  it("is no-pool for an upcoming season with no config document", () => {
    expect(
      resolvePoolPageState({
        pool: undefined,
        poolLoaded: true,
        airStatus: "upcoming",
        now,
      }),
    ).toBe("no-pool");
  });

  it("offers no entry for a live or complete season", () => {
    for (const airStatus of ["live", "complete"] as const) {
      expect(
        resolvePoolPageState({
          pool: undefined,
          poolLoaded: true,
          airStatus,
          now,
        }),
      ).toBe("not-upcoming");
    }
  });

  it("is closed when the config says closed, whatever the season is doing", () => {
    expect(
      resolvePoolPageState({
        pool: pool({ status: "closed" }),
        poolLoaded: true,
        airStatus: "upcoming",
        now,
      }),
    ).toBe("closed");
  });

  it("is frozen once the stored freeze instant has passed", () => {
    expect(
      resolvePoolPageState({
        pool: pool({ freeze_at: pastTimestamp }),
        poolLoaded: true,
        airStatus: "upcoming",
        now,
      }),
    ).toBe("frozen");
  });

  it("is open before the freeze while the config says open", () => {
    expect(
      resolvePoolPageState({
        pool: pool(),
        poolLoaded: true,
        airStatus: "upcoming",
        now,
      }),
    ).toBe("open");
  });

  it("never lets the season air status override an existing config document", () => {
    // KTD3: the config is the single authority. A pool that exists and is
    // open before its stored freeze instant stays open even if the local
    // season metadata disagrees about whether the season has premiered.
    expect(
      resolvePoolPageState({
        pool: pool(),
        poolLoaded: true,
        airStatus: "live",
        now,
      }),
    ).toBe("open");
  });

  it("closed takes precedence over frozen, so the kill switch always explains itself", () => {
    expect(
      resolvePoolPageState({
        pool: pool({ status: "closed", freeze_at: pastTimestamp }),
        poolLoaded: true,
        airStatus: "upcoming",
        now,
      }),
    ).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

describe("pool ids", () => {
  it("derives the pool id the provisioning script writes", () => {
    expect(poolIdForSeason(51)).toBe("pool_season_51");
  });

  it("reads a season number out of a season id", () => {
    expect(seasonNumFromSeasonId("season_51")).toBe(51);
    expect(seasonNumFromSeasonId("season_7")).toBe(7);
  });

  it("rejects a malformed season id rather than building a junk pool id", () => {
    expect(seasonNumFromSeasonId("season_")).toBeNull();
    expect(seasonNumFromSeasonId("../evil")).toBeNull();
    expect(seasonNumFromSeasonId("season_51x")).toBeNull();
  });
});
