/**
 * Competition page loading states (issue #322), against local emulators only.
 *
 * Runs in the isolated auth-flow suite (`yarn e2e:auth-flows`): Auth,
 * Firestore and RTDB are emulators under the inert `demo-auth-flows`
 * project, and a network guard aborts anything bound for production.
 *
 * Every fixture here is synthetic: a made-up user, season and competition
 * seeded into the emulator and wiped afterwards.
 *
 * Set COMPETITION_LOADING_SHOTS=<dir> to save one screenshot per state.
 */

import { expect, test, type Page } from "@playwright/test";
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
import path from "node:path";

const PROJECT = "demo-auth-flows";
const AUTH_EMU = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`;
const FIRESTORE_EMU = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;

const firestoreEmuHost = process.env.FIRESTORE_EMULATOR_HOST;
if (
  !firestoreEmuHost ||
  !/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreEmuHost)
) {
  throw new Error(
    "e2e/competition-loading.spec.ts must run via `yarn e2e:auth-flows` so all Firebase traffic stays on local emulators.",
  );
}

// Look up the default app by name: other specs in this worker may already
// have created a named admin app, so "any app exists" is not enough.
const adminApp =
  admin.apps.find((app) => app?.name === "[DEFAULT]") ??
  admin.initializeApp({ projectId: PROJECT });
const adminDb = adminApp.firestore();

const SEASON_ID = "season_1";
const COMPETITION_ID = "competition_synthetic_fixture";
const MISSING_SEASON_COMPETITION_ID = "competition_synthetic_no_season";
const COMPETITION_NAME = "Synthetic Fixture League";
const PASSWORD = "correct-horse-7";
// The page's "taking longer than usual" threshold is 10 s.
const SLOW_WAIT_MS = 12_000;
const SHOTS_DIR = process.env.COMPETITION_LOADING_SHOTS;

const isProductionHost = (hostname: string) =>
  hostname !== "127.0.0.1" &&
  hostname !== "localhost" &&
  [
    ".googleapis.com",
    ".firebaseio.com",
    ".firebasedatabase.app",
    ".firebaseapp.com",
    ".google-analytics.com",
    ".googletagmanager.com",
  ].some((s) => hostname === s.slice(1) || hostname.endsWith(s));

let productionViolations: string[] = [];

const wipe = async () => {
  const auth = await fetch(
    `${AUTH_EMU}/emulator/v1/projects/${PROJECT}/accounts`,
    { method: "DELETE" },
  );
  const fs = await fetch(
    `${FIRESTORE_EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!auth.ok || !fs.ok) throw new Error("emulator wipe failed");
};

// Playwright runs from the repo root.
const RULES_PATH = path.resolve("firestore.rules");
const setFirestoreRules = async (content: string) => {
  const res = await fetch(
    `${FIRESTORE_EMU}/emulator/v1/projects/${PROJECT}:securityRules`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rules: { files: [{ name: "firestore.rules", content }] },
      }),
    },
  );
  if (!res.ok) throw new Error(`rules update failed: ${res.status}`);
};
const restoreFirestoreRules = () =>
  setFirestoreRules(readFileSync(RULES_PATH, "utf8"));
const DENY_ALL_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}`;

const createUser = async (email: string) => {
  const res = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        displayName: "Fixture Player",
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) throw new Error(`seed signUp failed: ${res.status}`);
  return ((await res.json()) as { localId: string }).localId;
};

const seed = async () => {
  const email = `fixture-${Date.now()}@example.test`;
  const uid = await createUser(email);
  await adminDb.doc(`seasons/${SEASON_ID}`).set({
    id: SEASON_ID,
    order: 1,
    name: "Synthetic Test Season",
    img: "",
    players: [],
    episodes: [],
    castawayLookup: {},
  });
  const competition = (id: string, seasonId: string) => ({
    id,
    competition_name: COMPETITION_NAME,
    season_id: seasonId,
    season_num: 1,
    draft_id: "draft_synthetic_fixture",
    creator_uid: uid,
    participant_uids: [uid],
    participants: [
      { uid, email, displayName: "Fixture Player", isAdmin: false },
    ],
    draft_picks: [],
    prop_bets: [],
    current_episode: null,
    finished: false,
  });
  await adminDb
    .doc(`competitions/${COMPETITION_ID}`)
    .set(competition(COMPETITION_ID, SEASON_ID));
  await adminDb
    .doc(`competitions/${MISSING_SEASON_COMPETITION_ID}`)
    .set(competition(MISSING_SEASON_COMPETITION_ID, "season_99"));
  return email;
};

const dialog = (page: Page) => page.getByRole("dialog");
const main = (page: Page) => page.getByRole("main");

/** Opens the competition signed out and signs in through its own gate. */
const openSignedIn = async (
  page: Page,
  competitionId: string,
  email: string,
) => {
  await page.goto(`/competitions/${competitionId}`);
  await dialog(page).getByLabel("Email").fill(email);
  await dialog(page).getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await dialog(page).getByRole("button", { name: "Sign in" }).click();
  await expect(dialog(page)).toBeHidden({ timeout: 20_000 });
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS_DIR) return;
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
};

const blockFirestore = (page: Page) =>
  page.route(`${FIRESTORE_EMU}/**`, (route) => route.abort());

test.beforeEach(async ({ context }) => {
  productionViolations = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (isProductionHost(url.hostname)) {
      productionViolations.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await restoreFirestoreRules();
  await wipe();
});

test.afterEach(async () => {
  expect(productionViolations).toEqual([]);
});

test.afterAll(async () => {
  await restoreFirestoreRules();
  await wipe();
});

test("a competition that loads normally shows its standings", async ({
  page,
}) => {
  const email = await seed();
  await openSignedIn(page, COMPETITION_ID, email);
  await expect(
    main(page).getByRole("heading", { name: COMPETITION_NAME }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(main(page).getByText("Taking longer than usual")).toHaveCount(0);
  await shot(page, "normal");
});

test("a load that stalls explains itself and reload recovers", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = await seed();
  await openSignedIn(page, COMPETITION_ID, email);
  // Sign-in is done; now the competition's data can't arrive.
  await page.reload();
  await blockFirestore(page);
  await page.waitForTimeout(SLOW_WAIT_MS);
  await shot(page, "slow");
  await expect(main(page).getByText("Taking longer than usual")).toBeVisible();

  await page.unroute(`${FIRESTORE_EMU}/**`);
  await main(page).getByRole("button", { name: "Reload page" }).click();
  await expect(
    main(page).getByRole("heading", { name: COMPETITION_NAME }),
  ).toBeVisible({ timeout: 20_000 });
});

test("a competition whose data can't be read shows an error and Try again recovers", async ({
  page,
}) => {
  const email = await seed();
  await openSignedIn(page, COMPETITION_ID, email);
  await setFirestoreRules(DENY_ALL_RULES);
  await page.reload();
  await page.waitForTimeout(5_000);
  await shot(page, "error");
  await expect(
    main(page).getByRole("heading", {
      name: "We couldn't load this competition",
    }),
  ).toBeVisible();

  await restoreFirestoreRules();
  await main(page).getByRole("button", { name: "Try again" }).click();
  await expect(
    main(page).getByRole("heading", { name: COMPETITION_NAME }),
  ).toBeVisible({ timeout: 20_000 });
});

test("a competition whose season is missing says so instead of spinning", async ({
  page,
}) => {
  const email = await seed();
  await openSignedIn(page, MISSING_SEASON_COMPETITION_ID, email);
  await page.waitForTimeout(5_000);
  await shot(page, "missing-season");
  await expect(
    main(page).getByRole("heading", {
      name: "This competition's season isn't available",
    }),
  ).toBeVisible();
});
