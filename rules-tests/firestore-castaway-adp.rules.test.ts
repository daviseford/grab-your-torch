/**
 * Security-rules tests for castaway average draft position (ADP).
 *
 * 1. `castaway_adp/{season_id}_{cohort}` aggregates every group's drafts and
 *    is written only by `scripts/recompute-castaway-adp.ts` through the Admin
 *    SDK, which bypasses rules. Signed-in users may read it; nobody may write
 *    it from a client, a session carrying the admin claim included.
 * 2. The draft a competition records is what ADP counts, so once a
 *    competition is saved no client but an admin may change its picks, its
 *    people, its season, or the draft it came from. Everything the app does
 *    to a competition afterwards (revealing episodes, finishing it, renaming
 *    teams, trading) must keep working.
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
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-survivor-fantasy-rules";
const SUMMARY_ID = "season_51_pre_premiere";

const ALICE = "uid_alice"; // creator
const BOB = "uid_bob"; // participant
const MALLORY = "uid_mallory"; // not in the competition
const COMPETITION_ID = "competition_adp_source";

let testEnv: RulesTestEnvironment;

type Ctx = "anonymous" | "user" | "admin";

const firestoreAs = (ctx: Ctx | string): Firestore =>
  (ctx === "anonymous"
    ? testEnv.unauthenticatedContext()
    : ctx === "admin"
      ? testEnv.authenticatedContext("uid_admin", { admin: true })
      : testEnv.authenticatedContext(ctx === "user" ? "uid_drafter" : ctx)
  ).firestore() as unknown as Firestore;

const summaryRef = (ctx: Ctx, id = SUMMARY_ID) =>
  doc(firestoreAs(ctx), "castaway_adp", id);

const competitionRef = (uid: string) =>
  doc(firestoreAs(uid), "competitions", COMPETITION_ID);

const SUMMARY = {
  season_id: "season_51",
  season_num: 51,
  cohort: "pre_premiere",
  draft_count: 12,
  sealed_count: 12,
  min_drafts: 10,
  min_creators: 5,
  premiere_cutoff: "2026-09-24T00:00:00.000Z",
  computed_at: "2026-09-23T12:00:00.000Z",
  castaways: { US9001: { adp: 1.5, picks: 12 } },
};

const PICKS = [
  { order: 1, castaway_id: "US9001", user_uid: ALICE, season_id: "season_51" },
  { order: 2, castaway_id: "US9002", user_uid: BOB, season_id: "season_51" },
];

const COMPETITION = {
  id: COMPETITION_ID,
  competition_name: "League",
  season_id: "season_51",
  season_num: 51,
  draft_id: "draft_adp_source",
  creator_uid: ALICE,
  participant_uids: [ALICE, BOB],
  participants: [
    { uid: ALICE, displayName: "Alice" },
    { uid: BOB, displayName: "Bob" },
  ],
  draft_picks: PICKS,
  current_episode: 0,
  finished: false,
};

beforeAll(async () => {
  // Honour the emulator `emulators:exec` started, so this file can run on
  // whatever port a local config assigns; CI uses the default 8080.
  const [host, port] = (
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"
  ).split(":");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const seed = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(seed, "castaway_adp", SUMMARY_ID), SUMMARY);
    await setDoc(doc(seed, "competitions", COMPETITION_ID), COMPETITION);
  });
});

describe("castaway_adp: reads", () => {
  it("a signed-in user can read a cohort summary", async () => {
    await assertSucceeds(getDoc(summaryRef("user")));
    await assertSucceeds(getDoc(summaryRef("user", "season_51_all_drafts")));
  });

  it("a signed-out visitor cannot", async () => {
    await assertFails(getDoc(summaryRef("anonymous")));
  });
});

describe("castaway_adp: writes", () => {
  for (const ctx of ["user", "admin", "anonymous"] as const) {
    it(`${ctx} cannot create, change, or delete a summary`, async () => {
      await assertFails(
        setDoc(summaryRef(ctx), { ...SUMMARY, draft_count: 99 }),
      );
      await assertFails(
        setDoc(summaryRef(ctx, "season_51_all_drafts"), {
          ...SUMMARY,
          cohort: "all_drafts",
        }),
      );
      await assertFails(updateDoc(summaryRef(ctx), { draft_count: 99 }));
      await assertFails(deleteDoc(summaryRef(ctx)));
    });
  }
});

describe("competitions: the recorded draft is frozen once saved", () => {
  const rewrites: [string, Record<string, unknown>][] = [
    ["picks", { draft_picks: [...PICKS].reverse() }],
    ["participants", { participant_uids: [ALICE, BOB, MALLORY] }],
    ["season", { season_id: "season_50" }],
    ["source draft", { draft_id: "draft_elsewhere" }],
  ];

  for (const [what, change] of rewrites) {
    it(`the creator cannot change the ${what}`, async () => {
      await assertFails(updateDoc(competitionRef(ALICE), change));
    });

    it(`the creator cannot change the ${what} alongside a legitimate update`, async () => {
      await assertFails(
        updateDoc(competitionRef(ALICE), { current_episode: 1, ...change }),
      );
    });

    it(`a participant cannot change the ${what}`, async () => {
      await assertFails(updateDoc(competitionRef(BOB), change));
    });

    it(`an admin can still correct the ${what}`, async () => {
      await assertSucceeds(updateDoc(competitionRef("admin"), change));
    });
  }

  it("the creator cannot overwrite the whole doc with new picks", async () => {
    await assertFails(
      setDoc(competitionRef(ALICE), {
        ...COMPETITION,
        draft_picks: [...PICKS].reverse(),
      }),
    );
  });

  it("the creator cannot remove the picks", async () => {
    const withoutPicks: Record<string, unknown> = { ...COMPETITION };
    delete withoutPicks.draft_picks;
    await assertFails(setDoc(competitionRef(ALICE), withoutPicks));
  });

  it("an outsider still cannot write at all", async () => {
    await assertFails(
      updateDoc(competitionRef(MALLORY), { draft_picks: [...PICKS].reverse() }),
    );
  });
});

describe("competitions: the lifecycle still works", () => {
  it("the creator can reveal the next episode and finish the competition", async () => {
    await assertSucceeds(
      updateDoc(competitionRef(ALICE), { current_episode: 1 }),
    );
    await assertSucceeds(updateDoc(competitionRef(ALICE), { finished: true }));
  });

  it("the creator can rewrite the doc unchanged apart from the episode", async () => {
    await assertSucceeds(
      setDoc(competitionRef(ALICE), { ...COMPETITION, current_episode: 2 }),
    );
  });

  it("participants can still name their own team", async () => {
    await assertSucceeds(
      updateDoc(competitionRef(BOB), { "team_names.uid_bob": "Bob's Team" }),
    );
    await assertSucceeds(
      updateDoc(competitionRef(ALICE), { "team_names.uid_alice": "Alice's" }),
    );
  });

  it("a participant can still propose a trade", async () => {
    await assertSucceeds(
      setDoc(
        doc(
          firestoreAs(BOB),
          "competitions",
          COMPETITION_ID,
          "trades",
          "trade_1",
        ),
        {
          competition_id: COMPETITION_ID,
          season_id: "season_51",
          offered_by_uid: BOB,
          offered_to_uid: ALICE,
          status: "pending",
          created_at: "2026-09-30T00:00:00.000Z",
          offered_castaway_ids: ["US9002"],
          requested_castaway_ids: ["US9001"],
        },
      ),
    );
  });

  it("a new competition can still be saved by its creator", async () => {
    await assertSucceeds(
      setDoc(doc(firestoreAs(ALICE), "competitions", "competition_new"), {
        ...COMPETITION,
        id: "competition_new",
      }),
    );
  });
});
