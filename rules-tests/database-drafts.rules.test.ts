/**
 * Security-rules tests for how a Realtime Database draft may come to exist.
 *
 * Castaway average draft position trusts a promoted draft only when it went
 * through the real lobby: every participant joined as themselves, and every
 * pick was written slot by slot while the draft was live. So a new draft must
 * be born as an empty lobby holding only its creator. A client may not write
 * a draft that already has other people, picks, prop bets, or a started or
 * finished state. The legitimate lifecycle (create, join, start, pick,
 * finish, prop bets) must keep working.
 *
 * Run with `yarn test:rules` (starts the Firestore and Database emulators).
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-survivor-fantasy-rules";
const ALICE = "uid_alice";
const BOB = "uid_bob";
const DRAFT_ID = "draft_rules_lobby";

let testEnv: RulesTestEnvironment;

const dbAs = (uid: string) => testEnv.authenticatedContext(uid).database();

/** Exactly what src/hooks/useCreateDraft.ts writes. */
const lobby = (overrides: Record<string, unknown> = {}) => ({
  id: DRAFT_ID,
  season_id: "season_51",
  season_num: 51,
  competiton_id: "competition_rules_lobby",
  creator_uid: ALICE,
  participants: { [ALICE]: { uid: ALICE, displayName: "Alice" } },
  total_players: 4,
  pick_order_uids: {},
  turns: {},
  draft_picks: {},
  prop_bets: {},
  state: { current_pick_number: 0, started: false, finished: false },
  created_at: 1,
  ...overrides,
});

const pick = (order: number, uid: string, castaway: string) => ({
  season_id: "season_51",
  season_num: 51,
  order,
  user_uid: uid,
  user_name: uid,
  castaway_id: castaway,
  player_name: castaway,
});

beforeAll(async () => {
  // Honour the emulator `emulators:exec` started; CI uses the default 9000.
  const [host, port] = (
    process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "127.0.0.1:9000"
  ).split(":");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      rules: readFileSync("database.rules.json", "utf8"),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearDatabase();
});

describe("drafts: creation must be an empty lobby", () => {
  it("the app's own lobby write succeeds", async () => {
    await assertSucceeds(dbAs(ALICE).ref(`drafts/${DRAFT_ID}`).set(lobby()));
  });

  const forged: [string, Record<string, unknown>][] = [
    [
      "other participants",
      {
        participants: {
          [ALICE]: { uid: ALICE },
          [BOB]: { uid: BOB },
        },
      },
    ],
    ["picks", { draft_picks: { "1": pick(1, ALICE, "US9001") } }],
    [
      "prop bets",
      {
        prop_bets: {
          [ALICE]: { id: "p", user_uid: ALICE, user_name: "A", values: {} },
        },
      },
    ],
    [
      "a started state",
      { state: { current_pick_number: 0, started: true, finished: false } },
    ],
    [
      "a finished state",
      { state: { current_pick_number: 0, started: false, finished: true } },
    ],
    [
      "a pick number past zero",
      { state: { current_pick_number: 3, started: false, finished: false } },
    ],
  ];

  for (const [what, overrides] of forged) {
    it(`a draft cannot be created with ${what}`, async () => {
      await assertFails(
        dbAs(ALICE).ref(`drafts/${DRAFT_ID}`).set(lobby(overrides)),
      );
    });
  }

  it("a draft cannot be created for someone else", async () => {
    await assertFails(dbAs(BOB).ref(`drafts/${DRAFT_ID}`).set(lobby()));
  });

  it("an existing draft cannot be overwritten whole", async () => {
    await assertSucceeds(dbAs(ALICE).ref(`drafts/${DRAFT_ID}`).set(lobby()));
    await assertFails(
      dbAs(ALICE)
        .ref(`drafts/${DRAFT_ID}`)
        .set(lobby({ state: { finished: true } })),
    );
  });
});

describe("drafts: the real lifecycle still works", () => {
  it("create, join, start, pick every slot, finish, and submit prop bets", async () => {
    const draft = (uid: string) => dbAs(uid).ref(`drafts/${DRAFT_ID}`);
    await assertSucceeds(draft(ALICE).set(lobby()));
    await assertSucceeds(
      draft(BOB)
        .child(`participants/${BOB}`)
        .set({ uid: BOB, displayName: "Bob" }),
    );
    await assertSucceeds(
      draft(ALICE).update({
        pick_order_uids: { "0": ALICE, "1": BOB },
        turns: { "1": ALICE, "2": BOB, "3": BOB, "4": ALICE },
        total_players: 4,
        "state/started": true,
        "state/current_pick_number": 1,
      }),
    );

    const turns = [ALICE, BOB, BOB, ALICE];
    for (const [index, uid] of turns.entries()) {
      const order = index + 1;
      await assertSucceeds(
        draft(uid).update({
          [`draft_picks/${order}`]: pick(order, uid, `US900${order}`),
          "state/current_pick_number": order + 1,
          ...(order === 4 ? { "state/finished": true } : {}),
        }),
      );
    }

    // Finished: the picks can no longer be written.
    await assertFails(
      draft(ALICE)
        .child("draft_picks/5")
        .set(pick(5, ALICE, "US9005")),
    );
    await assertFails(
      draft(ALICE)
        .child("draft_picks/1")
        .set(pick(1, ALICE, "US9004")),
    );

    await assertSucceeds(
      draft(BOB)
        .child(`prop_bets/${BOB}`)
        .set({
          id: "propbet_b",
          user_uid: BOB,
          user_name: "Bob",
          values: { winner: "US9001" },
        }),
    );
  });

  it("a participant cannot join after the draft starts", async () => {
    const draft = (uid: string) => dbAs(uid).ref(`drafts/${DRAFT_ID}`);
    await assertSucceeds(draft(ALICE).set(lobby()));
    await assertSucceeds(
      draft(ALICE).update({
        "state/started": true,
        "state/current_pick_number": 1,
      }),
    );
    await assertFails(
      draft(BOB).child(`participants/${BOB}`).set({ uid: BOB }),
    );
  });
});
