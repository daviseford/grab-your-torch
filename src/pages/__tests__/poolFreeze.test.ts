/**
 * The freeze boundary: editing, withdrawal, and rejected writes (U5).
 *
 * This repo has no React Testing Library and no `.test.tsx`, so every decision
 * the freeze boundary makes is extracted into a pure module and tested here:
 *
 *  - the update payload builders, which must produce exactly the two shapes
 *    the rules accept (a pre-freeze full edit that never re-sends `created_at`,
 *    and a post-freeze handle-only diff of exactly two keys),
 *  - the write-outcome classifier, which decides `denied` (terminal, the pool
 *    has closed) versus `failed` (transient, offer a retry). Getting this
 *    backwards either retries forever against a closed pool or tells an
 *    entrant the pool closed when their connection dropped,
 *  - the control-visibility resolver, which offers edit and withdrawal only
 *    before the freeze and the handle control after it (R5, R7, R9),
 *  - the second-tab conflict detector,
 *  - the write-rejection reducer, which is how a denial arriving with no form
 *    mounted still reaches the entrant on their next load.
 *
 * KTD4 is the reason none of this trusts the clock: rules enforce the freeze
 * with `request.time`, the interface gate is cosmetic, and a rejection the
 * page did not predict must always be handled.
 */

import { describe, expect, it } from "vitest";
import {
  poolEntryChangedElsewhere,
  resolvePoolEntryControls,
} from "../../components/Pool/poolEntryControls";
import {
  applyPoolWriteEvent,
  describePoolWriteRejection,
  loadPoolWriteRejection,
  reducePoolWriteRejection,
  setPoolWriteRejectionStorage,
  type PoolWriteRejection,
  type PoolWriteRejectionStorage,
} from "../../components/Pool/poolWriteRejection";
import { PropBetQuestionKeys } from "../../data/propbets";
import { classifyPoolWriteFailure } from "../../hooks/usePoolEntry";
import type { Pool, PoolEntry, PoolPick, PropBetsFormData } from "../../types";
import {
  buildPoolEntryPayload,
  buildPoolEntryUpdatePayload,
  buildPoolHandleUpdatePayload,
  PoolEntryPayloadError,
} from "../../utils/poolEntryPayload";
import { resolvePoolPageState } from "../../utils/poolPageState";

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
const NOW = 2_000_000_000_000;

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
    prop_bet_answers: [...roster.map((pick) => pick.castaway_id), "Yes", "No"],
    status: "open",
    display_mode: "full",
    latest_episode_num: null,
    season_complete: false,
    ...overrides,
  }) as Pool;

const sentinelTimestamp = () => ({ __serverTimestamp: true });

/** The entry document as the server already holds it. */
const storedEntry = (): PoolEntry =>
  ({
    id: "pool_entry_uid-123",
    pool_id: "pool_season_51",
    season_id: "season_51",
    handle: "Torch",
    picks: [roster[0], roster[1], roster[2]],
    prop_bets: answeredPropBets(),
    created_at: timestamp(1_700_000_000),
    updated_at: timestamp(1_700_000_100),
  }) as PoolEntry;

/**
 * What Firestore does with an `updateDoc` / `setDoc(merge)` payload: top-level
 * keys present in the payload replace, keys absent are left alone. This is the
 * whole reason a full edit must omit `created_at` rather than re-send it.
 */
const applyMerge = (
  existing: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> => ({ ...existing, ...update });

const CREATE_KEYS = [
  "created_at",
  "handle",
  "id",
  "picks",
  "pool_id",
  "prop_bets",
  "season_id",
  "updated_at",
].sort();

// ---------------------------------------------------------------------------
// The pre-freeze full edit
// ---------------------------------------------------------------------------

describe("buildPoolEntryUpdatePayload", () => {
  const validInput = () => ({
    uid: "uid-123",
    pool: pool(),
    picks: [roster[3], roster[4], roster[5]],
    handle: "Torch",
    propBets: answeredPropBets(),
    timestamp: sentinelTimestamp,
  });

  it("never re-sends created_at, which the rules deny", () => {
    // The rules pin `created_at` to `request.time` on create and require it
    // unchanged on update, so re-stamping it (a full setDoc overwrite, or an
    // explicit serverTimestamp()) is denied outright. Omission is the only
    // shape that passes.
    const payload = buildPoolEntryUpdatePayload(validInput());
    expect("created_at" in payload).toBe(false);
  });

  it("stamps updated_at from the injected server timestamp", () => {
    expect(buildPoolEntryUpdatePayload(validInput()).updated_at).toEqual({
      __serverTimestamp: true,
    });
  });

  it("replaces the picks and preserves created_at once merged", () => {
    const existing = storedEntry();
    const payload = buildPoolEntryUpdatePayload(validInput());
    const merged = applyMerge(
      existing as unknown as Record<string, unknown>,
      payload as unknown as Record<string, unknown>,
    );
    expect(merged.picks).toEqual([roster[3], roster[4], roster[5]]);
    expect(merged.created_at).toBe(existing.created_at);
    expect(merged.updated_at).toEqual({ __serverTimestamp: true });
  });

  it("leaves the merged document satisfying the whole create allowlist", () => {
    const merged = applyMerge(
      storedEntry() as unknown as Record<string, unknown>,
      buildPoolEntryUpdatePayload(validInput()) as unknown as Record<
        string,
        unknown
      >,
    );
    expect(Object.keys(merged).sort()).toEqual(CREATE_KEYS);
  });

  it("carries the same keys as a create, minus created_at", () => {
    const create = buildPoolEntryPayload(validInput());
    const update = buildPoolEntryUpdatePayload(validInput());
    expect(Object.keys(update).sort()).toEqual(
      Object.keys(create)
        .filter((key) => key !== "created_at")
        .sort(),
    );
  });

  it("copies roster objects through verbatim rather than rebuilding names", () => {
    const input = validInput();
    const payload = buildPoolEntryUpdatePayload({
      ...input,
      picks: [
        { castaway_id: "US0755", full_name: "WRONG NAME" },
        roster[4],
        roster[5],
      ],
    });
    expect(payload.picks[0]).toBe(input.pool.roster[3]);
    expect(payload.picks[0].full_name).toBe("Carlos Cruz");
  });

  it("refuses an edit that is not a complete entry", () => {
    expect(() =>
      buildPoolEntryUpdatePayload({ ...validInput(), picks: [roster[0]] }),
    ).toThrow(PoolEntryPayloadError);
    expect(() =>
      buildPoolEntryUpdatePayload({ ...validInput(), handle: "" }),
    ).toThrow(PoolEntryPayloadError);
    expect(() =>
      buildPoolEntryUpdatePayload({
        ...validInput(),
        picks: [roster[0], roster[0], roster[1]],
      }),
    ).toThrow(PoolEntryPayloadError);
  });
});

// ---------------------------------------------------------------------------
// The post-freeze handle-only edit
// ---------------------------------------------------------------------------

describe("buildPoolHandleUpdatePayload", () => {
  it("sends exactly the two keys the post-freeze rule allows", () => {
    const payload = buildPoolHandleUpdatePayload({
      handle: "NewTorch",
      timestamp: sentinelTimestamp,
    });
    expect(Object.keys(payload).sort()).toEqual(["handle", "updated_at"]);
    expect(payload.handle).toBe("NewTorch");
    expect(payload.updated_at).toEqual({ __serverTimestamp: true });
  });

  it("cannot carry a pick or prop bet change alongside the handle (AE6)", () => {
    // The rules reject a post-freeze diff touching anything but the handle,
    // so the builder has no parameter through which picks could ride along.
    const payload = buildPoolHandleUpdatePayload({
      handle: "NewTorch",
      timestamp: sentinelTimestamp,
    });
    expect("picks" in payload).toBe(false);
    expect("prop_bets" in payload).toBe(false);
    expect("created_at" in payload).toBe(false);
  });

  it("refuses a handle the rules would deny", () => {
    for (const handle of ["", "a".repeat(101), " torch", "hidden\u200bname"]) {
      expect(
        () =>
          buildPoolHandleUpdatePayload({
            handle,
            timestamp: sentinelTimestamp,
          }),
        handle,
      ).toThrow(PoolEntryPayloadError);
    }
  });
});

// ---------------------------------------------------------------------------
// Denied versus failed
// ---------------------------------------------------------------------------

describe("classifyPoolWriteFailure", () => {
  it("treats a permission denial as terminal for every kind of write", () => {
    for (const kind of ["create", "update", "handle", "withdraw"] as const) {
      const outcome = classifyPoolWriteFailure("permission-denied", kind);
      expect(outcome.status, kind).toBe("denied");
      expect(outcome.message.length, kind).toBeGreaterThan(0);
    }
  });

  it("marks a denial as the boundary, never as an unfinished entry", () => {
    // The page records a rejection for a `boundary` denial and names a field
    // for a `payload` one. Mixing them would tell an entrant the pool had
    // closed when their entry was merely incomplete, and vice versa.
    const outcome = classifyPoolWriteFailure("permission-denied", "create");
    expect(outcome.status === "denied" && outcome.reason).toBe("boundary");
  });

  it("says the pool has closed, and that the picks are still on screen (AE2)", () => {
    for (const kind of ["create", "update"] as const) {
      const { message } = classifyPoolWriteFailure("permission-denied", kind);
      expect(message.toLowerCase(), kind).toContain("closed");
      expect(message.toLowerCase(), kind).toContain("screen");
    }
  });

  it("never offers a retry for a permission denial", () => {
    // A denial is the freeze or the kill switch talking. Retrying it loops
    // forever and reads as a broken page.
    for (const kind of ["create", "update", "handle", "withdraw"] as const) {
      const { message } = classifyPoolWriteFailure("permission-denied", kind);
      expect(message.toLowerCase(), kind).not.toContain("try again");
    }
  });

  it("treats every transient Firestore code as retryable", () => {
    for (const code of [
      "unavailable",
      "deadline-exceeded",
      "aborted",
      "internal",
      "resource-exhausted",
    ]) {
      const outcome = classifyPoolWriteFailure(code, "update");
      expect(outcome.status, code).toBe("failed");
      expect(outcome.message.toLowerCase(), code).toContain("try again");
    }
  });

  it("treats an unknown code as retryable rather than terminal", () => {
    expect(classifyPoolWriteFailure("some-future-code", "create").status).toBe(
      "failed",
    );
  });

  it("treats a missing code as retryable rather than terminal", () => {
    expect(classifyPoolWriteFailure(undefined, "create").status).toBe("failed");
  });

  it("never declares the pool closed for a transient failure", () => {
    // The mirror of the denial case: a dropped connection must not tell an
    // entrant their entry is refused when it is merely unsent.
    for (const code of ["unavailable", "deadline-exceeded", "aborted"]) {
      for (const kind of ["create", "update", "handle", "withdraw"] as const) {
        const { message } = classifyPoolWriteFailure(code, kind);
        expect(message.toLowerCase(), `${code}/${kind}`).not.toContain(
          "closed",
        );
      }
    }
  });

  it("names the thing that was not saved, per kind", () => {
    expect(
      classifyPoolWriteFailure("unavailable", "handle").message.toLowerCase(),
    ).toContain("handle");
    expect(
      classifyPoolWriteFailure("unavailable", "withdraw").message.toLowerCase(),
    ).toContain("withdraw");
  });
});

// ---------------------------------------------------------------------------
// Which controls are offered
// ---------------------------------------------------------------------------

describe("resolvePoolEntryControls", () => {
  const controlsFor = (overrides: Partial<Pool>, now: number) =>
    resolvePoolEntryControls({
      state: resolvePoolPageState({
        pool: pool(overrides),
        poolLoaded: true,
        airStatus: "upcoming",
        now,
      }),
      hasEntry: true,
    });

  it("offers editing and withdrawal before the freeze (R7)", () => {
    expect(controlsFor({}, NOW)).toBe("edit-and-withdraw");
  });

  it("drops both once the freeze has passed, and keeps the handle (R5, R9)", () => {
    expect(controlsFor({ freeze_at: pastTimestamp }, NOW)).toBe("handle-only");
  });

  it("offers nothing while the kill switch is thrown", () => {
    // The post-freeze handle rule still requires status == "open", so a closed
    // pool cannot even be renamed. Offering the control would be a dead end.
    expect(controlsFor({ status: "closed" }, NOW)).toBe("none");
    expect(
      controlsFor({ status: "closed", freeze_at: pastTimestamp }, NOW),
    ).toBe("none");
  });

  it("offers nothing when there is no entry to edit", () => {
    for (const state of [
      "loading",
      "no-pool",
      "not-upcoming",
      "closed",
      "frozen",
      "open",
    ] as const) {
      expect(resolvePoolEntryControls({ state, hasEntry: false }), state).toBe(
        "none",
      );
    }
  });

  it("offers nothing before the config document has resolved", () => {
    expect(resolvePoolEntryControls({ state: "loading", hasEntry: true })).toBe(
      "none",
    );
  });
});

// ---------------------------------------------------------------------------
// A second tab's save
// ---------------------------------------------------------------------------

describe("poolEntryChangedElsewhere", () => {
  it("is false while the open form matches what the server holds", () => {
    expect(
      poolEntryChangedElsewhere(
        timestamp(1_700_000_100),
        timestamp(1_700_000_100),
      ),
    ).toBe(false);
  });

  it("surfaces a newer save made in another tab", () => {
    expect(
      poolEntryChangedElsewhere(
        timestamp(1_700_000_100),
        timestamp(1_700_000_500),
      ),
    ).toBe(true);
  });

  it("is false when the form has no baseline yet", () => {
    expect(poolEntryChangedElsewhere(undefined, timestamp(1_700_000_500))).toBe(
      false,
    );
  });

  it("is false when the entry has gone away entirely", () => {
    // A withdrawal in another tab is not an edit conflict: the page falls back
    // to the empty entry form on its own.
    expect(poolEntryChangedElsewhere(timestamp(1_700_000_100), undefined)).toBe(
      false,
    );
  });

  it("ignores an older timestamp, which is a stale local echo", () => {
    expect(
      poolEntryChangedElsewhere(
        timestamp(1_700_000_500),
        timestamp(1_700_000_100),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A rejection that arrives with no form mounted
// ---------------------------------------------------------------------------

describe("reducePoolWriteRejection", () => {
  const rejection: PoolWriteRejection = {
    pool_id: "pool_season_51",
    kind: "update",
    at: 1_700_000_000_000,
  };

  it("records a denial", () => {
    expect(
      reducePoolWriteRejection(null, {
        type: "denied",
        pool_id: "pool_season_51",
        kind: "update",
        at: 1_700_000_000_000,
      }),
    ).toEqual(rejection);
  });

  it("clears on the next server-acknowledged write", () => {
    expect(
      reducePoolWriteRejection(rejection, {
        type: "acknowledged",
        pool_id: "pool_season_51",
      }),
    ).toBeNull();
  });

  it("survives a started write, because starting one proves nothing", () => {
    expect(
      reducePoolWriteRejection(rejection, {
        type: "started",
        pool_id: "pool_season_51",
      }),
    ).toEqual(rejection);
  });

  it("survives a transient failure, which is not an acknowledgement", () => {
    expect(
      reducePoolWriteRejection(rejection, {
        type: "failed",
        pool_id: "pool_season_51",
      }),
    ).toEqual(rejection);
  });

  it("clears when the entrant dismisses it", () => {
    // Post-freeze there may be no write left that can succeed, so the record
    // needs a way out that is not "wait for an acknowledgement".
    expect(
      reducePoolWriteRejection(rejection, {
        type: "dismissed",
        pool_id: "pool_season_51",
      }),
    ).toBeNull();
  });

  it("replaces an older rejection with the newer one", () => {
    expect(
      reducePoolWriteRejection(rejection, {
        type: "denied",
        pool_id: "pool_season_51",
        kind: "handle",
        at: 1_700_000_900_000,
      }),
    ).toEqual({
      pool_id: "pool_season_51",
      kind: "handle",
      at: 1_700_000_900_000,
    });
  });
});

describe("describePoolWriteRejection", () => {
  it("clears a rejection only when a newer server write supersedes it", () => {
    const rejection: PoolWriteRejection = {
      pool_id: "pool_season_51",
      kind: "update",
      at: 100,
    };
    for (const updated_at of [99, 100]) {
      expect(
        reducePoolWriteRejection(rejection, {
          type: "observed",
          pool_id: rejection.pool_id,
          updated_at,
        }),
      ).toEqual(rejection);
    }
    expect(
      reducePoolWriteRejection(rejection, {
        type: "observed",
        pool_id: rejection.pool_id,
        updated_at: 101,
      }),
    ).toBeNull();
    expect(
      reducePoolWriteRejection(rejection, {
        type: "observed",
        pool_id: "pool_season_52",
        updated_at: 101,
      }),
    ).toEqual(rejection);
  });
  it("explains every kind of rejected write on screen", () => {
    for (const kind of ["create", "update", "handle", "withdraw"] as const) {
      const notice = describePoolWriteRejection({
        pool_id: "pool_season_51",
        kind,
        at: 1_700_000_000_000,
      });
      expect(notice.label.length, kind).toBeGreaterThan(0);
      expect(notice.message.length, kind).toBeGreaterThan(0);
      // CLAUDE.md: no em-dashes in anything rendered to a user.
      expect(notice.message, kind).not.toContain("—");
    }
  });

  it("says the entry is unchanged rather than implying it was lost", () => {
    expect(
      describePoolWriteRejection({
        pool_id: "pool_season_51",
        kind: "update",
        at: 0,
      }).message.toLowerCase(),
    ).toContain("unchanged");
  });

  it("says a refused withdrawal left the entry in the pool", () => {
    expect(
      describePoolWriteRejection({
        pool_id: "pool_season_51",
        kind: "withdraw",
        at: 0,
      }).message.toLowerCase(),
    ).toContain("still");
  });
});

describe("the write-rejection store", () => {
  const createStorage = (): PoolWriteRejectionStorage & {
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

  it("survives a reload, which is the whole point (step 4)", () => {
    const storage = createStorage();
    setPoolWriteRejectionStorage(storage);
    applyPoolWriteEvent({
      type: "denied",
      pool_id: "pool_season_51",
      kind: "create",
      at: 1_700_000_000_000,
    });

    // A fresh page load reads it back out of the same browser storage.
    setPoolWriteRejectionStorage(storage);
    expect(loadPoolWriteRejection("pool_season_51")).toEqual({
      pool_id: "pool_season_51",
      kind: "create",
      at: 1_700_000_000_000,
    });
  });

  it("does not become a stale message after a later successful write", () => {
    const storage = createStorage();
    setPoolWriteRejectionStorage(storage);
    applyPoolWriteEvent({
      type: "denied",
      pool_id: "pool_season_51",
      kind: "create",
      at: 1,
    });
    applyPoolWriteEvent({ type: "acknowledged", pool_id: "pool_season_51" });
    expect(loadPoolWriteRejection("pool_season_51")).toBeNull();
  });

  it("keeps one pool's rejection out of another pool's page", () => {
    const storage = createStorage();
    setPoolWriteRejectionStorage(storage);
    applyPoolWriteEvent({
      type: "denied",
      pool_id: "pool_season_51",
      kind: "create",
      at: 1,
    });
    expect(loadPoolWriteRejection("pool_season_52")).toBeNull();
  });

  it("degrades to nothing rather than throwing on unreadable storage", () => {
    setPoolWriteRejectionStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() =>
      applyPoolWriteEvent({
        type: "denied",
        pool_id: "pool_season_51",
        kind: "create",
        at: 1,
      }),
    ).not.toThrow();
    expect(loadPoolWriteRejection("pool_season_51")).toBeNull();
  });

  it("ignores a malformed stored record instead of rendering junk", () => {
    const storage = createStorage();
    setPoolWriteRejectionStorage(storage);
    applyPoolWriteEvent({
      type: "denied",
      pool_id: "pool_season_51",
      kind: "create",
      at: 1,
    });
    const key = [...storage.map.keys()][0];
    storage.map.set(key, '{"kind":"not-a-kind","at":"soon"}');
    expect(loadPoolWriteRejection("pool_season_51")).toBeNull();
  });
});
