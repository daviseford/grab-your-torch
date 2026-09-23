/**
 * Security-rules tests for per-competition team names.
 *
 * Participants can set only their own `team_names` entry on a competition doc
 * and nothing else. The creator keeps update rights over the rest of the doc
 * but, like any participant, may rename only their own team; only an admin
 * may rename another participant's team. These rules are the only server-side
 * control -- the edit UI only ever offers the participant's own name, but a
 * client calling the SDK directly skips that entirely.
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
  deleteField,
  doc,
  Firestore,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-survivor-fantasy-rules";

const ALICE = "uid_alice"; // creator
const BOB = "uid_bob"; // participant
const CAROL = "uid_carol"; // participant
const MALLORY = "uid_mallory"; // not in the competition
const ADMIN = "uid_admin"; // not in the competition, carries the admin claim

const COMPETITION_ID = "competition_team_names_test";
const FINISHED_COMPETITION_ID = "competition_team_names_test_finished";

let testEnv: RulesTestEnvironment;

const db = (uid?: string): Firestore =>
  (uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext()
  ).firestore() as unknown as Firestore;

const competitionRef = (uid: string | undefined, id = COMPETITION_ID) =>
  doc(db(uid), "competitions", id);

const adminCompetitionRef = (id = COMPETITION_ID) =>
  doc(
    testEnv
      .authenticatedContext(ADMIN, { admin: true })
      .firestore() as unknown as Firestore,
    "competitions",
    id,
  );

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
      current_episode: 4,
      finished: false,
    });
    await setDoc(doc(seedDb, "competitions", FINISHED_COMPETITION_ID), {
      id: FINISHED_COMPETITION_ID,
      creator_uid: ALICE,
      season_id: "season_50",
      participant_uids: [ALICE, BOB],
      current_episode: 13,
      finished: true,
    });
  });
});

describe("competitions: team_names updates", () => {
  it("participant can set their own team name", async () => {
    await assertSucceeds(
      updateDoc(competitionRef(BOB), { "team_names.uid_bob": "Jeff's Babes" }),
    );
  });

  it("participant can update their own existing team name", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(
        doc(
          ctx.firestore() as unknown as Firestore,
          "competitions",
          COMPETITION_ID,
        ),
        { "team_names.uid_bob": "Old Name" },
      );
    });
    await assertSucceeds(
      updateDoc(competitionRef(BOB), { "team_names.uid_bob": "New Name" }),
    );
  });

  it("participant can clear their own team name", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(
        doc(
          ctx.firestore() as unknown as Firestore,
          "competitions",
          COMPETITION_ID,
        ),
        { "team_names.uid_bob": "Old Name" },
      );
    });
    await assertSucceeds(
      updateDoc(competitionRef(BOB), { "team_names.uid_bob": deleteField() }),
    );
  });

  it("participant cannot set another participant's team name", async () => {
    await assertFails(
      updateDoc(competitionRef(BOB), { "team_names.uid_carol": "Impostor" }),
    );
  });

  it("participant cannot touch other fields alongside their team name", async () => {
    await assertFails(
      updateDoc(competitionRef(BOB), {
        "team_names.uid_bob": "Jeff's Babes",
        current_episode: 5,
      }),
    );
  });

  it("participant cannot update other fields only", async () => {
    await assertFails(updateDoc(competitionRef(BOB), { current_episode: 5 }));
  });

  it("creator can set their own team name", async () => {
    await assertSucceeds(
      updateDoc(competitionRef(ALICE), {
        "team_names.uid_alice": "Commissioner",
      }),
    );
  });

  it("creator cannot set another participant's team name", async () => {
    await assertFails(
      updateDoc(competitionRef(ALICE), {
        "team_names.uid_bob": "Commissioner's Pick",
      }),
    );
  });

  it("creator cannot rename another team alongside an otherwise valid update", async () => {
    await assertFails(
      updateDoc(competitionRef(ALICE), {
        current_episode: 5,
        "team_names.uid_bob": "Commissioner's Pick",
      }),
    );
  });

  it("creator can still update other fields", async () => {
    await assertSucceeds(
      updateDoc(competitionRef(ALICE), { current_episode: 5 }),
    );
  });

  it("creator can update other fields while leaving existing team names intact", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(
        doc(
          ctx.firestore() as unknown as Firestore,
          "competitions",
          COMPETITION_ID,
        ),
        { "team_names.uid_bob": "Bob's Team" },
      );
    });
    await assertSucceeds(
      updateDoc(competitionRef(ALICE), { current_episode: 5 }),
    );
  });

  it("admin can set any participant's team name", async () => {
    await assertSucceeds(
      updateDoc(adminCompetitionRef(), {
        "team_names.uid_bob": "Admin's Pick",
      }),
    );
  });

  it("admin can clear any participant's team name", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(
        doc(
          ctx.firestore() as unknown as Firestore,
          "competitions",
          COMPETITION_ID,
        ),
        { "team_names.uid_bob": "Bob's Team" },
      );
    });
    await assertSucceeds(
      updateDoc(adminCompetitionRef(), {
        "team_names.uid_bob": deleteField(),
      }),
    );
  });

  it("non-participant cannot set a team name", async () => {
    await assertFails(
      updateDoc(competitionRef(MALLORY), {
        "team_names.uid_mallory": "Gatecrasher",
      }),
    );
  });

  it("unauthenticated user cannot set a team name", async () => {
    await assertFails(
      updateDoc(competitionRef(undefined), {
        "team_names.uid_bob": "Anonymous",
      }),
    );
  });

  it("participant can still edit their team name on a finished competition", async () => {
    // The finished guard is a one-way transition on `finished` itself, not a
    // freeze: creator/admin can already update finished docs, and the
    // participant branch cannot touch `finished` at all.
    await assertSucceeds(
      updateDoc(competitionRef(BOB, FINISHED_COMPETITION_ID), {
        "team_names.uid_bob": "Runner-up",
      }),
    );
  });

  it("participant branch cannot revert finished back to false", async () => {
    await assertFails(
      updateDoc(competitionRef(BOB, FINISHED_COMPETITION_ID), {
        "team_names.uid_bob": "Too Late",
        finished: false,
      }),
    );
  });
});
