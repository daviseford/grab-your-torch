/**
 * Security-rules tests for the trades subcollection.
 *
 * These rules are the ONLY server-side control on a feature that moves
 * scoring-relevant assets between users: the app's own `validateTrade` runs in
 * the browser and a participant calling the Firestore SDK directly skips it
 * entirely. The live e2e suite only drives the valid UI path, so it cannot
 * catch a rule that has become too permissive -- it would still pass green.
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
  deleteDoc,
  doc,
  Firestore,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-survivor-fantasy-rules";

const ALICE = "uid_alice"; // proposer
const BOB = "uid_bob"; // recipient
const CAROL = "uid_carol"; // participant, uninvolved
const MALLORY = "uid_mallory"; // not in the competition

const COMPETITION_ID = "competition_rules_test";
const LIVE_COMPETITION_ID = "competition_rules_test_live";
const TRADE_ID = "trade_rules_test";

/** The watch-along fixture sits on episode 4, so the only legal cutoff is 5. */
const CURRENT_EPISODE = 4;
const LEGAL_CUTOFF = CURRENT_EPISODE + 1;

let testEnv: RulesTestEnvironment;

const tradePath = (competitionId = COMPETITION_ID) =>
  `competitions/${competitionId}/trades/${TRADE_ID}`;

const validTrade = (overrides: Record<string, unknown> = {}) => ({
  id: TRADE_ID,
  competition_id: COMPETITION_ID,
  season_id: "season_50",
  offered_by_uid: ALICE,
  offered_to_uid: BOB,
  offered_castaway_ids: ["US0001"],
  requested_castaway_ids: ["US0002"],
  status: "pending",
  created_at: "2026-03-10T00:00:00.000Z",
  ...overrides,
});

const db = (uid?: string): Firestore =>
  (uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext()
  ).firestore() as unknown as Firestore;

/** Put a pending trade in place without going through the create rule. */
const seedPendingTrade = async (overrides: Record<string, unknown> = {}) =>
  testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore() as unknown as Firestore, tradePath()),
      validTrade(overrides),
    );
  });

beforeAll(async () => {
  // `yarn test:rules` starts the emulator; running vitest directly against this
  // config without it will fail here with ECONNREFUSED on 127.0.0.1:8080.
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      // The emulator `emulators:exec` started; CI uses the default 8080.
      host: (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(
        ":",
      )[0],
      port: Number(
        (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")[1],
      ),
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
    await setDoc(doc(seedDb, "competitions", COMPETITION_ID), {
      id: COMPETITION_ID,
      creator_uid: ALICE,
      season_id: "season_50",
      participant_uids: [ALICE, BOB, CAROL],
      current_episode: CURRENT_EPISODE,
      finished: false,
    });
    await setDoc(doc(seedDb, "competitions", LIVE_COMPETITION_ID), {
      id: LIVE_COMPETITION_ID,
      creator_uid: ALICE,
      season_id: "season_50",
      participant_uids: [ALICE, BOB],
      current_episode: null,
      finished: false,
    });
  });
});

describe("trades: create", () => {
  it("lets a participant offer a trade to another participant", async () => {
    await assertSucceeds(setDoc(doc(db(ALICE), tradePath()), validTrade()));
  });

  it("rejects an unauthenticated write", async () => {
    await assertFails(setDoc(doc(db(), tradePath()), validTrade()));
  });

  it("rejects a non-participant", async () => {
    await assertFails(
      setDoc(
        doc(db(MALLORY), tradePath()),
        validTrade({ offered_by_uid: MALLORY }),
      ),
    );
  });

  it("rejects offering on someone else's behalf", async () => {
    // Carol writes a trade that claims to come from Alice.
    await assertFails(setDoc(doc(db(CAROL), tradePath()), validTrade()));
  });

  it("rejects a trade aimed at a non-participant", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ offered_to_uid: MALLORY }),
      ),
    );
  });

  it("rejects a self-trade", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ offered_to_uid: ALICE }),
      ),
    );
  });

  it("rejects a trade created already accepted", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ status: "accepted", effective_episode: LEGAL_CUTOFF }),
      ),
    );
  });

  it("rejects a competition_id that does not match the path", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ competition_id: "competition_somewhere_else" }),
      ),
    );
  });

  it("rejects a season_id that does not match the competition", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ season_id: "season_1" }),
      ),
    );
  });

  // Shape checks: a doc the trades UI cannot sort or render is unremovable,
  // because `allow delete: if false` applies to participants too.
  it("rejects a trade with no created_at", async () => {
    const { created_at, ...withoutCreatedAt } = validTrade();
    expect(created_at).toBeTruthy();
    await assertFails(setDoc(doc(db(ALICE), tradePath()), withoutCreatedAt));
  });

  it("rejects castaway ids that are not lists", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ offered_castaway_ids: "US0001" }),
      ),
    );
  });

  it("rejects an empty side", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({ requested_castaway_ids: [] }),
      ),
    );
  });

  it("rejects the same castaway on both sides", async () => {
    await assertFails(
      setDoc(
        doc(db(ALICE), tradePath()),
        validTrade({
          offered_castaway_ids: ["US0001", "US0003"],
          requested_castaway_ids: ["US0003"],
        }),
      ),
    );
  });
});

describe("trades: accept", () => {
  // Wrapped: vitest passes a TestContext to beforeEach callbacks, which would
  // otherwise be spread into the trade document.
  beforeEach(() => seedPendingTrade());

  const accept = (uid: string, effectiveEpisode: unknown) =>
    updateDoc(doc(db(uid), tradePath()), {
      status: "accepted",
      effective_episode: effectiveEpisode,
      resolved_at: "2026-03-11T00:00:00.000Z",
    });

  it("lets the recipient accept at the next unrevealed episode", async () => {
    await assertSucceeds(accept(BOB, LEGAL_CUTOFF));
  });

  // The finding this suite exists for: the acceptor benefits from an early
  // cutoff, so they must not be able to choose one.
  it("rejects a cutoff that reaches back to episode 1", async () => {
    await assertFails(accept(BOB, 1));
  });

  it("rejects a cutoff at the current episode", async () => {
    await assertFails(accept(BOB, CURRENT_EPISODE));
  });

  it("rejects a zero or negative cutoff", async () => {
    await assertFails(accept(BOB, 0));
    await assertFails(accept(BOB, -5));
  });

  // A far-future cutoff is the mirror-image abuse: points never transfer at
  // all, while the roster still changes hands.
  it("rejects a cutoff pushed past the season", async () => {
    await assertFails(accept(BOB, 9999));
  });

  it("rejects a non-integer cutoff", async () => {
    await assertFails(accept(BOB, 5.5));
    await assertFails(accept(BOB, "5"));
  });

  it("rejects an accept with no cutoff at all", async () => {
    await assertFails(
      updateDoc(doc(db(BOB), tradePath()), {
        status: "accepted",
        resolved_at: "2026-03-11T00:00:00.000Z",
      }),
    );
  });

  it("rejects the proposer accepting their own offer", async () => {
    await assertFails(accept(ALICE, LEGAL_CUTOFF));
  });

  it("rejects an uninvolved participant accepting", async () => {
    await assertFails(accept(CAROL, LEGAL_CUTOFF));
  });

  it("rejects accepting a trade that is no longer pending", async () => {
    await seedPendingTrade({ status: "rejected" });
    await assertFails(accept(BOB, LEGAL_CUTOFF));
  });

  it("rejects smuggling a castaway change into the accept", async () => {
    await assertFails(
      updateDoc(doc(db(BOB), tradePath()), {
        status: "accepted",
        effective_episode: LEGAL_CUTOFF,
        resolved_at: "2026-03-11T00:00:00.000Z",
        offered_castaway_ids: ["US0009"],
      }),
    );
  });
});

describe("trades: reject and cancel", () => {
  // Wrapped: vitest passes a TestContext to beforeEach callbacks, which would
  // otherwise be spread into the trade document.
  beforeEach(() => seedPendingTrade());

  const setStatus = (uid: string, status: string) =>
    updateDoc(doc(db(uid), tradePath()), {
      status,
      resolved_at: "2026-03-11T00:00:00.000Z",
    });

  it("lets the recipient reject", async () => {
    await assertSucceeds(setStatus(BOB, "rejected"));
  });

  it("lets the proposer cancel", async () => {
    await assertSucceeds(setStatus(ALICE, "canceled"));
  });

  it("rejects the proposer rejecting their own offer", async () => {
    await assertFails(setStatus(ALICE, "rejected"));
  });

  it("rejects the recipient canceling", async () => {
    await assertFails(setStatus(BOB, "canceled"));
  });

  it("rejects an unknown status", async () => {
    await assertFails(setStatus(BOB, "expired"));
  });

  it("rejects reopening a resolved trade", async () => {
    await seedPendingTrade({ status: "canceled" });
    await assertFails(setStatus(ALICE, "pending"));
  });
});

describe("trades: delete", () => {
  // Wrapped: vitest passes a TestContext to beforeEach callbacks, which would
  // otherwise be spread into the trade document.
  beforeEach(() => seedPendingTrade());

  it("denies deletes to everyone, including the proposer", async () => {
    await assertFails(deleteDoc(doc(db(ALICE), tradePath())));
    await assertFails(deleteDoc(doc(db(BOB), tradePath())));
  });
});

describe("trades: live competitions", () => {
  // A live competition has no current_episode, so rules cannot derive the
  // cutoff and only the coarse floor applies. This is the documented trust
  // boundary -- these tests pin what the rules DO still guarantee, so a future
  // change cannot quietly weaken it further.
  const livePath = `competitions/${LIVE_COMPETITION_ID}/trades/${TRADE_ID}`;

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore() as unknown as Firestore, livePath),
        validTrade({ competition_id: LIVE_COMPETITION_ID }),
      );
    });
  });

  const acceptLive = (uid: string, effectiveEpisode: unknown) =>
    updateDoc(doc(db(uid), livePath), {
      status: "accepted",
      effective_episode: effectiveEpisode,
      resolved_at: "2026-03-11T00:00:00.000Z",
    });

  it("still requires a positive integer cutoff", async () => {
    await assertFails(acceptLive(BOB, 0));
    await assertFails(acceptLive(BOB, -1));
    await assertFails(acceptLive(BOB, 2.5));
  });

  it("still requires the recipient to be the one accepting", async () => {
    await assertFails(acceptLive(ALICE, 7));
  });

  it("accepts any positive cutoff (known gap: no server-side data clock)", async () => {
    await assertSucceeds(acceptLive(BOB, 7));
  });
});

describe("vote_history", () => {
  // Added in this PR because non-admin users were hitting permission-denied on
  // competition pages. Pin both halves so the fix cannot regress in either
  // direction.
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore() as unknown as Firestore, "vote_history/season_50"),
        { season_id: "season_50" },
      );
    });
  });

  it("is readable by a signed-in user", async () => {
    await assertSucceeds(getDoc(doc(db(ALICE), "vote_history/season_50")));
  });

  it("is not readable when signed out", async () => {
    await assertFails(getDoc(doc(db(), "vote_history/season_50")));
  });

  it("is not writable by a non-admin", async () => {
    await assertFails(
      setDoc(doc(db(ALICE), "vote_history/season_50"), { hacked: true }),
    );
  });
});
