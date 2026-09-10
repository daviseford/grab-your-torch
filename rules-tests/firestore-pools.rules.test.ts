/**
 * Security-rules tests for the public season pool.
 *
 * These rules ARE the freeze (R9, R10). The entry form's own deadline check
 * runs in the browser against a clock the entrant controls, and anyone can
 * call the Firestore SDK directly, so nothing outside this file proves that a
 * pool actually closes. They are also the only thing keeping other entrants'
 * picks private before the freeze (R19) while the pool, its counters, and its
 * leaderboard stay readable to a signed-out visitor (R18).
 *
 * `request.time` in the emulator is real wall time and cannot be mocked, so
 * the fixtures set `freeze_at` in the past or the future rather than moving a
 * clock.
 *
 * Run with `yarn test:rules` (starts the Firestore emulator).
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-survivor-fantasy-rules";

const ALICE = "uid_alice"; // entrant
const BOB = "uid_bob"; // another entrant
const ADMIN = "uid_admin"; // admin custom claim, still not allowed to write

/** Open, freeze in the future. */
const POOL_ID = "pool_season_51";
/** Open, freeze already passed. */
const FROZEN_POOL_ID = "pool_season_51_frozen";
/** Freeze in the future, but the kill switch is thrown. */
const CLOSED_POOL_ID = "pool_season_51_closed";
/** No config document at all: every entry write must fail closed. */
const GHOST_POOL_ID = "pool_season_51_missing";

const SEASON_ID = "season_51";
const EPISODE_ID = "episode_51_1";

const ROSTER = [
  { castaway_id: "US0752", full_name: "Ada Alpha" },
  { castaway_id: "US0753", full_name: "Ben Bravo" },
  { castaway_id: "US0754", full_name: "Cleo Charlie" },
  { castaway_id: "US0755", full_name: "Dev Delta" },
  { castaway_id: "US0756", full_name: "Eve Echo" },
  { castaway_id: "US0757", full_name: "Fay Foxtrot" },
];

const PICKS_PER_ENTRY = 2;
const PROP_BET_KEYS = ["winner", "first_boot"];

const HOUR = 60 * 60 * 1000;

let testEnv: RulesTestEnvironment;

const db = (uid?: string): Firestore =>
  (uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext()
  ).firestore() as unknown as Firestore;

const adminDb = (): Firestore =>
  testEnv
    .authenticatedContext(ADMIN, { admin: true })
    .firestore() as unknown as Firestore;

const entryPath = (poolId: string, uid: string) =>
  `pools/${poolId}/entries/${uid}`;

/**
 * A create payload the rules must accept. `created_at`/`updated_at` are
 * `serverTimestamp()` sentinels, which the emulator resolves to `request.time`
 * (KTD4), so a client cannot author them.
 */
const validEntry = (
  uid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: `pool_entry_${uid}`,
  pool_id: POOL_ID,
  season_id: SEASON_ID,
  handle: "Torch Snuffer",
  picks: [ROSTER[0], ROSTER[1]],
  prop_bets: { winner: "US0752", first_boot: "US0753" },
  created_at: serverTimestamp(),
  updated_at: serverTimestamp(),
  ...overrides,
});

/** The same shape as `validEntry` but with settled timestamps, for seeding. */
const seededEntry = (
  poolId: string,
  uid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...validEntry(uid),
  pool_id: poolId,
  created_at: Timestamp.fromMillis(Date.now() - 2 * HOUR),
  updated_at: Timestamp.fromMillis(Date.now() - 2 * HOUR),
  ...overrides,
});

const seedEntry = (
  poolId: string,
  uid: string,
  overrides: Record<string, unknown> = {},
) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore() as unknown as Firestore, entryPath(poolId, uid)),
      seededEntry(poolId, uid, overrides),
    );
  });

const poolConfig = (
  poolId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: poolId,
  season_id: SEASON_ID,
  season_num: 51,
  name: "Survivor 51 Season Pool",
  freeze_at: Timestamp.fromMillis(Date.now() + 24 * HOUR),
  roster: ROSTER,
  picks_per_entry: PICKS_PER_ENTRY,
  prop_bet_keys: PROP_BET_KEYS,
  status: "open",
  display_mode: "full",
  latest_episode_num: null,
  season_complete: false,
  ...overrides,
});

beforeAll(async () => {
  // `yarn test:rules` starts the emulator; running vitest directly against this
  // config without it will fail here with ECONNREFUSED on 127.0.0.1:8080.
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  // Guarded so that when the emulator is not running, the reported failure is
  // the connection error rather than a confusing "cannot read 'cleanup'".
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seedDb = ctx.firestore() as unknown as Firestore;

    await setDoc(doc(seedDb, "pools", POOL_ID), poolConfig(POOL_ID));
    await setDoc(
      doc(seedDb, "pools", FROZEN_POOL_ID),
      poolConfig(FROZEN_POOL_ID, {
        freeze_at: Timestamp.fromMillis(Date.now() - 24 * HOUR),
        display_mode: "leaderboard",
      }),
    );
    await setDoc(
      doc(seedDb, "pools", CLOSED_POOL_ID),
      poolConfig(CLOSED_POOL_ID, { status: "closed" }),
    );
    // GHOST_POOL_ID is deliberately never written.

    await setDoc(doc(seedDb, "pools", POOL_ID, "meta", "counters"), {
      entry_count: 3,
      updated_at: "2026-09-10T00:00:00.000Z",
    });

    const stamp = {
      episode_num: 1,
      computed_at: "2026-09-10T00:00:00.000Z",
      data_revision: "rev_data",
      scoring_revision: "rev_scoring",
      freeze_at: Timestamp.fromMillis(Date.now() - 24 * HOUR),
    };
    await setDoc(doc(seedDb, "pools", POOL_ID, "standings", EPISODE_ID), {
      ...stamp,
      entry_count: 3,
      rows: [],
      page_count: 1,
    });
    await setDoc(
      doc(seedDb, "pools", POOL_ID, "standings", EPISODE_ID, "pages", "0"),
      { ...stamp, page: 0, rows: [] },
    );
  });
});

/* ------------------------------------------------------------------ *
 * Public read surfaces (R18, KTD6)
 * ------------------------------------------------------------------ */

describe("pools: public read surfaces", () => {
  it("lets a signed-out visitor read the pool config", async () => {
    await assertSucceeds(getDoc(doc(db(), "pools", POOL_ID)));
  });

  it("lets a signed-out visitor read the entrant counters", async () => {
    await assertSucceeds(
      getDoc(doc(db(), "pools", POOL_ID, "meta", "counters")),
    );
  });

  it("lets a signed-out visitor read a standings summary", async () => {
    await assertSucceeds(
      getDoc(doc(db(), "pools", POOL_ID, "standings", EPISODE_ID)),
    );
  });

  // The fourth match exists only if this passes: a recursive grant on the
  // parent would also make it pass, which is why the entry-privacy tests below
  // are the other half of the proof.
  it("lets a signed-out visitor read an overflow standings page", async () => {
    await assertSucceeds(
      getDoc(
        doc(db(), "pools", POOL_ID, "standings", EPISODE_ID, "pages", "0"),
      ),
    );
  });
});

describe("pools: nothing on the public surfaces is client-writable", () => {
  it("denies a signed-in user writing the config", async () => {
    await assertFails(
      setDoc(doc(db(ALICE), "pools", POOL_ID), poolConfig(POOL_ID)),
    );
  });

  // KTD3: `.env` holds real admin credentials, so a browser session with the
  // admin claim must not be able to move the deadline.
  it("denies an admin-claimed client writing the config", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "pools", POOL_ID), poolConfig(POOL_ID)),
    );
  });

  it("denies an admin-claimed client moving freeze_at", async () => {
    await assertFails(
      updateDoc(doc(adminDb(), "pools", POOL_ID), {
        freeze_at: Timestamp.fromMillis(Date.now() + 999 * HOUR),
      }),
    );
  });

  it("denies an admin-claimed client writing the counters", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "pools", POOL_ID, "meta", "counters"), {
        entry_count: 9999,
        updated_at: "2026-09-10T00:00:00.000Z",
      }),
    );
  });

  it("denies an admin-claimed client writing a standings document", async () => {
    await assertFails(
      setDoc(doc(adminDb(), "pools", POOL_ID, "standings", EPISODE_ID), {
        entry_count: 1,
        rows: [],
        page_count: 0,
      }),
    );
  });

  it("denies an admin-claimed client writing a standings page", async () => {
    await assertFails(
      setDoc(
        doc(adminDb(), "pools", POOL_ID, "standings", EPISODE_ID, "pages", "0"),
        { page: 0, rows: [] },
      ),
    );
  });

  it("denies an admin-claimed client deleting the config", async () => {
    await assertFails(deleteDoc(doc(adminDb(), "pools", POOL_ID)));
  });
});

/* ------------------------------------------------------------------ *
 * Entry privacy (R19, AE5, KTD6)
 * ------------------------------------------------------------------ */

describe("entries: read", () => {
  beforeEach(async () => {
    await seedEntry(POOL_ID, ALICE);
    await seedEntry(POOL_ID, BOB);
    await seedEntry(FROZEN_POOL_ID, ALICE);
  });

  it("lets an entrant get their own entry", async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE))));
  });

  it("denies a signed-in non-owner a get", async () => {
    await assertFails(getDoc(doc(db(BOB), entryPath(POOL_ID, ALICE))));
  });

  it("denies a signed-out get", async () => {
    await assertFails(getDoc(doc(db(), entryPath(POOL_ID, ALICE))));
  });

  // Rules are evaluated per returned document, so a list can be denied where a
  // get succeeds and vice versa. Both have to be pinned.
  it("denies a signed-out list before the freeze", async () => {
    await assertFails(getDocs(collection(db(), "pools", POOL_ID, "entries")));
  });

  it("denies a signed-out list after the freeze", async () => {
    await assertFails(
      getDocs(collection(db(), "pools", FROZEN_POOL_ID, "entries")),
    );
  });

  it("denies a signed-in non-owner a list", async () => {
    await assertFails(
      getDocs(collection(db(BOB), "pools", POOL_ID, "entries")),
    );
  });

  it("denies an admin-claimed client a list", async () => {
    await assertFails(
      getDocs(collection(adminDb(), "pools", POOL_ID, "entries")),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Create (R6, KD5, KTD4)
 * ------------------------------------------------------------------ */

describe("entries: create", () => {
  const create = (
    uid: string,
    atUid: string = uid,
    overrides: Record<string, unknown> = {},
    poolId: string = POOL_ID,
  ) =>
    setDoc(
      doc(db(uid), entryPath(poolId, atUid)),
      validEntry(atUid, { pool_id: poolId, ...overrides }),
    );

  // Also proves the create statement never references `resource.data`, which
  // is null on create and would deny every entry.
  it("lets an authenticated user enter at their own uid before the freeze", async () => {
    await assertSucceeds(create(ALICE));
  });

  it("denies creating at another user's uid", async () => {
    await assertFails(create(BOB, ALICE));
  });

  it("denies a signed-out create", async () => {
    await assertFails(
      setDoc(doc(db(), entryPath(POOL_ID, ALICE)), validEntry(ALICE)),
    );
  });

  it("denies a create after the freeze", async () => {
    await assertFails(create(ALICE, ALICE, {}, FROZEN_POOL_ID));
  });

  it("denies a create when the pool is closed, even before the freeze", async () => {
    await assertFails(create(ALICE, ALICE, {}, CLOSED_POOL_ID));
  });

  // Fails closed: a missing config must deny rather than error into an allow.
  it("denies a create when the pool config does not exist", async () => {
    await assertFails(create(ALICE, ALICE, {}, GHOST_POOL_ID));
  });
});

describe("entries: create timestamps", () => {
  it("denies a client-authored created_at", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), entryPath(POOL_ID, ALICE)),
        validEntry(ALICE, {
          created_at: Timestamp.fromMillis(Date.now() - 5 * HOUR),
        }),
      ),
    );
  });

  it("denies a client-authored updated_at", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), entryPath(POOL_ID, ALICE)),
        validEntry(ALICE, {
          updated_at: Timestamp.fromMillis(Date.now() + 5 * HOUR),
        }),
      ),
    );
  });

  it("denies an ISO string in place of a timestamp", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), entryPath(POOL_ID, ALICE)),
        validEntry(ALICE, { created_at: "2026-09-10T00:00:00.000Z" }),
      ),
    );
  });
});

describe("entries: create shape allowlist", () => {
  const createWith = (overrides: Record<string, unknown>) =>
    setDoc(
      doc(db(ALICE), entryPath(POOL_ID, ALICE)),
      validEntry(ALICE, overrides),
    );

  it("denies an unexpected `rank` key", async () => {
    await assertFails(createWith({ rank: 1 }));
  });

  it("denies an unexpected `total` key", async () => {
    await assertFails(createWith({ total: 9999 }));
  });

  it("denies arbitrary junk", async () => {
    await assertFails(createWith({ hacked: true, notes: "x".repeat(5000) }));
  });

  // Identity is the document id (KTD6); an inner uid must not be storable.
  it("denies an inner uid field", async () => {
    await assertFails(createWith({ uid: ALICE }));
  });

  it("denies a missing required key", async () => {
    const { prop_bets, ...withoutPropBets } = validEntry(ALICE);
    expect(prop_bets).toBeTruthy();
    await assertFails(
      setDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), withoutPropBets),
    );
  });

  it("denies a pool_id that does not match the path", async () => {
    await assertFails(createWith({ pool_id: "pool_somewhere_else" }));
  });

  it("denies a season_id that does not match the pool", async () => {
    await assertFails(createWith({ season_id: "season_50" }));
  });

  it("denies an id that is not derived from the uid", async () => {
    await assertFails(createWith({ id: `pool_entry_${BOB}` }));
    await assertFails(createWith({ id: ALICE }));
  });
});

describe("entries: handle validation (R5)", () => {
  // Each assertion is its own create at its own uid: a second `setDoc` to the
  // same path is an overwrite, and an overwrite carrying a fresh
  // `serverTimestamp()` in `created_at` is correctly denied by the update rule.
  const withHandle = (handle: unknown, uid: string = ALICE) =>
    setDoc(doc(db(uid), entryPath(POOL_ID, uid)), validEntry(uid, { handle }));

  it("accepts letters, digits, spaces, hyphens and underscores", async () => {
    await assertSucceeds(withHandle("Ada_the-Snuffer 51"));
  });

  it("accepts a 2 character handle and a 24 character handle", async () => {
    await assertSucceeds(withHandle("Ad"));
    await assertSucceeds(withHandle("A".repeat(24), BOB));
  });

  it("denies a 1 character handle", async () => {
    await assertFails(withHandle("A"));
  });

  it("denies a 25 character handle", async () => {
    await assertFails(withHandle("A".repeat(25)));
  });

  it("denies an empty handle", async () => {
    await assertFails(withHandle(""));
  });

  it("denies a non-string handle", async () => {
    await assertFails(withHandle(42));
    await assertFails(withHandle(["Ada"]));
    await assertFails(withHandle(null));
  });

  it("denies a leading or trailing space", async () => {
    await assertFails(withHandle(" Ada"));
    await assertFails(withHandle("Ada "));
  });

  // A crawlable public leaderboard is the reason these matter.
  it("denies a control character", async () => {
    await assertFails(withHandle("Ada\u0007Alpha"));
    await assertFails(withHandle("Ada\nAlpha"));
    await assertFails(withHandle("Ada\tAlpha"));
  });

  it("denies a zero-width character", async () => {
    await assertFails(withHandle("Ada\u200bAlpha"));
    await assertFails(withHandle("Ada\ufeffAlpha"));
  });

  it("denies a bidi-override character", async () => {
    await assertFails(withHandle("Ada\u202eAlpha"));
    await assertFails(withHandle("Ada\u2066Alpha"));
  });

  it("denies a URL", async () => {
    await assertFails(withHandle("http://evil.example"));
    await assertFails(withHandle("evil.example/x"));
  });

  it("denies markup and emoji", async () => {
    await assertFails(withHandle("<b>Ada</b>"));
    await assertFails(withHandle("Ada \u{1f525}"));
  });
});

describe("entries: picks validation (R23)", () => {
  const withPicks = (picks: unknown) =>
    setDoc(
      doc(db(ALICE), entryPath(POOL_ID, ALICE)),
      validEntry(ALICE, { picks }),
    );

  it("denies too few picks", async () => {
    await assertFails(withPicks([ROSTER[0]]));
  });

  it("denies too many picks", async () => {
    await assertFails(withPicks([ROSTER[0], ROSTER[1], ROSTER[2]]));
  });

  it("denies duplicate picks", async () => {
    await assertFails(withPicks([ROSTER[0], ROSTER[0]]));
  });

  it("denies a pick outside the roster", async () => {
    await assertFails(
      withPicks([ROSTER[0], { castaway_id: "US9999", full_name: "Ghost" }]),
    );
  });

  // U15's remap audit treats the stored name as ground truth, so a
  // deliberately disagreeing pair must not be storable.
  it("denies a roster id paired with a mismatched full_name", async () => {
    await assertFails(
      withPicks([
        ROSTER[0],
        { castaway_id: ROSTER[1].castaway_id, full_name: "Not Ben" },
      ]),
    );
  });

  it("denies a bare castaway id instead of a pair", async () => {
    await assertFails(
      withPicks([ROSTER[0].castaway_id, ROSTER[1].castaway_id]),
    );
  });

  it("denies a pick carrying an extra field", async () => {
    await assertFails(withPicks([ROSTER[0], { ...ROSTER[1], points: 999 }]));
  });

  it("denies picks that are not a list", async () => {
    await assertFails(withPicks("US0752"));
  });
});

describe("entries: prop bet validation (KTD3)", () => {
  const withPropBets = (propBets: unknown, uid: string = ALICE) =>
    setDoc(
      doc(db(uid), entryPath(POOL_ID, uid)),
      validEntry(uid, { prop_bets: propBets }),
    );

  it("accepts a subset of the pool's declared keys", async () => {
    await assertSucceeds(withPropBets({ winner: "US0752" }));
  });

  it("accepts an empty prop bet map", async () => {
    await assertSucceeds(withPropBets({}, BOB));
  });

  it("denies a key outside pool.prop_bet_keys", async () => {
    await assertFails(
      withPropBets({ winner: "US0752", secret_bonus: "US0753" }),
    );
  });

  it("denies prop_bets that are not a map", async () => {
    await assertFails(withPropBets(["winner"]));
  });
});

/* ------------------------------------------------------------------ *
 * Update (R5, R9, AE2, AE6)
 * ------------------------------------------------------------------ */

describe("entries: update before the freeze", () => {
  beforeEach(() => seedEntry(POOL_ID, ALICE));

  it("lets an entrant change their picks", async () => {
    await assertSucceeds(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        picks: [ROSTER[2], ROSTER[3]],
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("lets an entrant change their handle", async () => {
    await assertSucceeds(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        handle: "Fire Represents Life",
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies a non-owner update", async () => {
    await assertFails(
      updateDoc(doc(db(BOB), entryPath(POOL_ID, ALICE)), {
        handle: "Stolen",
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies changing created_at", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies a client-authored updated_at", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        handle: "Fire Represents Life",
        updated_at: Timestamp.fromMillis(Date.now() - HOUR),
      }),
    );
  });

  it("denies an update that adds an unexpected key", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        total: 500,
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies an update to an invalid handle", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        handle: "A",
        updated_at: serverTimestamp(),
      }),
    );
  });

  // The client contract for editing: merge and leave `created_at` alone. A
  // full `setDoc` overwrite re-sends `created_at: serverTimestamp()`, which
  // resolves to a new instant and is correctly denied, so an entrant cannot
  // reset their own creation time.
  it("lets an entrant edit with a merging setDoc that omits created_at", async () => {
    await assertSucceeds(
      setDoc(
        doc(db(ALICE), entryPath(POOL_ID, ALICE)),
        {
          handle: "Merged Edit",
          picks: [ROSTER[2], ROSTER[3]],
          updated_at: serverTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  it("denies a full setDoc overwrite that re-stamps created_at", async () => {
    await assertFails(
      setDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), validEntry(ALICE)),
    );
  });

  it("denies an update to picks outside the roster", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE)), {
        picks: [ROSTER[0], { castaway_id: "US9999", full_name: "Ghost" }],
        updated_at: serverTimestamp(),
      }),
    );
  });
});

describe("entries: update after the freeze (AE2, AE6)", () => {
  beforeEach(() => seedEntry(FROZEN_POOL_ID, ALICE));

  const path = entryPath(FROZEN_POOL_ID, ALICE);

  it("lets an entrant edit only their handle", async () => {
    await assertSucceeds(
      updateDoc(doc(db(ALICE), path), {
        handle: "Renamed After Freeze",
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies the same write when it also touches picks", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        handle: "Renamed After Freeze",
        picks: [ROSTER[2], ROSTER[3]],
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies a picks-only change", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        picks: [ROSTER[2], ROSTER[3]],
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies a prop bet change", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        prop_bets: { winner: "US0757" },
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies a post-freeze handle edit that is invalid", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        handle: "http://evil.example",
        updated_at: serverTimestamp(),
      }),
    );
  });

  it("denies a post-freeze handle edit with a client-authored updated_at", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        handle: "Renamed After Freeze",
        updated_at: Timestamp.fromMillis(Date.now()),
      }),
    );
  });

  it("denies a non-owner handle edit", async () => {
    await assertFails(
      updateDoc(doc(db(BOB), path), {
        handle: "Renamed By Bob",
        updated_at: serverTimestamp(),
      }),
    );
  });
});

describe("entries: update when the pool is closed (R12)", () => {
  beforeEach(() => seedEntry(CLOSED_POOL_ID, ALICE));

  const path = entryPath(CLOSED_POOL_ID, ALICE);

  it("denies a full update even before the freeze", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        picks: [ROSTER[2], ROSTER[3]],
        updated_at: serverTimestamp(),
      }),
    );
  });

  // The kill switch has to close the handle-edit path too, or it is not a
  // kill switch.
  it("denies a handle-only edit", async () => {
    await assertFails(
      updateDoc(doc(db(ALICE), path), {
        handle: "Renamed While Closed",
        updated_at: serverTimestamp(),
      }),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Delete (R9)
 * ------------------------------------------------------------------ */

describe("entries: delete", () => {
  beforeEach(async () => {
    await seedEntry(POOL_ID, ALICE);
    await seedEntry(FROZEN_POOL_ID, ALICE);
    await seedEntry(CLOSED_POOL_ID, ALICE);
  });

  it("lets an entrant withdraw before the freeze", async () => {
    await assertSucceeds(deleteDoc(doc(db(ALICE), entryPath(POOL_ID, ALICE))));
  });

  it("denies a non-owner delete", async () => {
    await assertFails(deleteDoc(doc(db(BOB), entryPath(POOL_ID, ALICE))));
  });

  it("denies a signed-out delete", async () => {
    await assertFails(deleteDoc(doc(db(), entryPath(POOL_ID, ALICE))));
  });

  it("denies a delete after the freeze", async () => {
    await assertFails(
      deleteDoc(doc(db(ALICE), entryPath(FROZEN_POOL_ID, ALICE))),
    );
  });

  it("denies a delete when the pool is closed", async () => {
    await assertFails(
      deleteDoc(doc(db(ALICE), entryPath(CLOSED_POOL_ID, ALICE))),
    );
  });

  it("denies an admin-claimed client deleting someone's entry", async () => {
    await assertFails(deleteDoc(doc(adminDb(), entryPath(POOL_ID, ALICE))));
  });
});
