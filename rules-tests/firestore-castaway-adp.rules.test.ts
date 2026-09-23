/**
 * Security-rules tests for published castaway ADP summaries.
 *
 * `castaway_adp/{seasonId}` aggregates every group's drafts and is written
 * only by `scripts/recompute-castaway-adp.ts` through the Admin SDK, which
 * bypasses rules. Signed-in users may read it; nobody may write it from a
 * client, a session carrying the admin claim included.
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
const SEASON_ID = "season_51";

let testEnv: RulesTestEnvironment;

const summaryRef = (ctx: "anonymous" | "user" | "admin") => {
  const context =
    ctx === "anonymous"
      ? testEnv.unauthenticatedContext()
      : ctx === "admin"
        ? testEnv.authenticatedContext("uid_admin", { admin: true })
        : testEnv.authenticatedContext("uid_drafter");
  return doc(
    context.firestore() as unknown as Firestore,
    "castaway_adp",
    SEASON_ID,
  );
};

const SUMMARY = {
  season_id: SEASON_ID,
  season_num: 51,
  cohort: "pre_premiere_completed_drafts",
  draft_count: 4,
  min_drafts: 3,
  premiere_cutoff: "2026-09-24T00:00:00.000Z",
  computed_at: "2026-09-23T12:00:00.000Z",
  castaways: { US9001: { adp: 1.5, picks: 4, best: 1, worst: 2 } },
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
    await setDoc(
      doc(ctx.firestore() as unknown as Firestore, "castaway_adp", SEASON_ID),
      SUMMARY,
    );
  });
});

describe("castaway_adp: reads", () => {
  it("a signed-in user can read a season's summary", async () => {
    await assertSucceeds(getDoc(summaryRef("user")));
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
      await assertFails(updateDoc(summaryRef(ctx), { draft_count: 99 }));
      await assertFails(deleteDoc(summaryRef(ctx)));
    });
  }
});
