/**
 * Isolated auth-flow integration tests (plan U5, KTD6).
 *
 * Everything here runs against the local Firebase emulators under the inert
 * `demo-auth-flows` project; the dev server runs in `e2e-auth` mode
 * (see .env.e2e-auth and src/firebase.ts). Run via `yarn e2e:auth-flows`,
 * which wraps this suite in `firebase emulators:exec`.
 *
 * Isolation model:
 * - beforeEach flushes Auth accounts, Firestore documents, and RTDB data via
 *   the emulator REST endpoints, so retried runs cannot share state.
 * - Each test seeds only the fixtures it needs (helpers below).
 * - A network guard aborts and records any request to a production Firebase
 *   host; afterEach fails the test if any fired.
 * - afterAll flushes again so the emulator is empty when the suite exits.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import admin from "firebase-admin";
import { RESET_REQUEST_CONFIRMATION } from "../src/components/Auth/authErrors";
import { PropBetQuestionKeys, PropBetsQuestions } from "../src/data/propbets";
import { SEASON_51_PLAYERS } from "../src/data/season_51";

// ---------------------------------------------------------------------------
// Emulator endpoints (ports pinned in firebase.json)
// ---------------------------------------------------------------------------

const PROJECT = "demo-auth-flows";
const AUTH_EMU = "http://127.0.0.1:9099";
const FIRESTORE_EMU = "http://127.0.0.1:8080";
const RTDB_EMU = "http://127.0.0.1:9000";
const RTDB_NS = "demo-auth-flows-default-rtdb";

// This spec must never run outside `firebase emulators:exec`. emulators:exec
// exports the emulator host env vars to the child process; if they are missing
// or non-local, refuse to run at all.
const firestoreEmuHost = process.env.FIRESTORE_EMULATOR_HOST;
if (
  !firestoreEmuHost ||
  !/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreEmuHost)
) {
  throw new Error(
    "e2e/auth-flows.spec.ts must run via `yarn e2e:auth-flows` so all Firebase traffic stays on local emulators.",
  );
}

// The season document is admin-write-only in firestore.rules, so seeding it
// requires the Admin SDK. With FIRESTORE_EMULATOR_HOST set (emulators:exec)
// and a demo- project id, this needs no credentials and cannot reach
// production.
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: PROJECT });
}
const adminDb = admin.firestore();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEASON_ID = "season_1";
const SEASON_ORDER = 1;
const SEASON_NAME = "Test Season One";
const SEASON_PLAYERS = [1, 2, 3, 4].map((n) => ({
  season_id: SEASON_ID,
  season_num: SEASON_ORDER,
  castaway_id: `US99${String(n).padStart(2, "0")}`,
  full_name: `Test Player ${n}`,
  img: "",
}));

const PASSWORD = "correct-horse-7";
const NEW_PASSWORD = "brand-new-phrase-9";

let userCounter = 0;
const uniqueEmail = (label: string) =>
  `e2e-${label}-${Date.now()}-${userCounter++}@example.com`;

type SeededUser = { uid: string; email: string; displayName: string };

const VALID_INVITE_DRAFT = "draft_valid_invite";
const STARTED_DRAFT = "draft_started";
const MEMBER_DRAFT = "draft_existing_member";

// The public season pool (U5, U12, U13). Season 51 is deliberately absent from
// Firestore, so the configuration document's roster is the only cast the entry
// page has (KTD3): no pool test below seeds a season, and one that did would be
// describing a page this product never ships.
const POOL_SEASON_ID = "season_51";
const POOL_SEASON_NUM = 51;
const POOL_ID = "pool_season_51";
const POOL_NAME = "Survivor 51 Season Pool";

// The real cast, ordered the way scripts/create-pool.ts orders it, so
// `picks_per_entry` is the real 7 of 21 rather than a convenient number.
const POOL_ROSTER = SEASON_51_PLAYERS.map(({ castaway_id, full_name }) => ({
  castaway_id,
  full_name,
})).sort((a, b) => a.full_name.localeCompare(b.full_name));
const PICKS_PER_ENTRY = Math.floor(POOL_ROSTER.length / 3);

/** The answer every castaway-typed prop bet question is given. */
const PROP_BET_PICK = POOL_ROSTER[0];

// ---------------------------------------------------------------------------
// Emulator REST helpers
// ---------------------------------------------------------------------------

const wipeAuth = async () => {
  const res = await fetch(
    `${AUTH_EMU}/emulator/v1/projects/${PROJECT}/accounts`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`auth wipe failed: ${res.status}`);
};

const wipeFirestore = async () => {
  const res = await fetch(
    `${FIRESTORE_EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`firestore wipe failed: ${res.status}`);
};

const RTDB_HEADERS = {
  "Content-Type": "application/json",
  Authorization: "Bearer owner",
};
const rtdbUrl = (path: string) => `${RTDB_EMU}/${path}.json?ns=${RTDB_NS}`;

const wipeRtdb = async () => {
  const res = await fetch(rtdbUrl(""), {
    method: "PUT",
    headers: RTDB_HEADERS,
    body: "null",
  });
  if (!res.ok) throw new Error(`rtdb wipe failed: ${res.status}`);
};

const wipeEmulators = async () => {
  await Promise.all([wipeAuth(), wipeFirestore(), wipeRtdb()]);
};

const createUser = async (
  email: string,
  password: string,
  displayName: string,
): Promise<SeededUser> => {
  const res = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        displayName,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`seed signUp failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { localId: string };
  return { uid: data.localId, email, displayName };
};

// The emulator's account-list endpoint is not available in all firebase-tools
// versions, but password sign-in always is. It returns localId and doubles as
// proof that the given password currently works for the account.
const findAccountByEmail = async (email: string, password: string) => {
  const res = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) {
    throw new Error(`account lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { localId: string; email: string };
  return data;
};

const requestResetEmail = async (email: string) => {
  const res = await fetch(
    `${AUTH_EMU}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
    },
  );
  if (!res.ok) {
    throw new Error(`sendOobCode failed: ${res.status} ${await res.text()}`);
  }
};

type OobCode = {
  email: string;
  requestType: string;
  oobCode: string;
  oobLink: string;
};

const getPasswordResetCodes = async (email: string): Promise<OobCode[]> => {
  const res = await fetch(
    `${AUTH_EMU}/emulator/v1/projects/${PROJECT}/oobCodes`,
  );
  if (!res.ok) throw new Error(`oobCodes failed: ${res.status}`);
  const data = (await res.json()) as { oobCodes?: OobCode[] };
  return (data.oobCodes ?? []).filter(
    (c) => c.email === email && c.requestType === "PASSWORD_RESET",
  );
};

const seedSeason = async () => {
  await adminDb.doc(`seasons/${SEASON_ID}`).set({
    id: SEASON_ID,
    order: SEASON_ORDER,
    name: SEASON_NAME,
    img: "",
    players: SEASON_PLAYERS,
    episodes: [],
    castawayLookup: {},
  });
};

/**
 * The pool configuration document and its counters sibling.
 *
 * `pools/{poolId}` is never client-writable, admin claim included (KTD3), so
 * the Admin SDK is the only way it can exist -- the same reason `seedSeason`
 * above uses it. `freeze_at` is a real Firestore Timestamp: the rules compare
 * it against `request.time`, and a string in that field would deny every write
 * for a reason that has nothing to do with the freeze.
 */
const seedPool = async (freezeAt: Date) => {
  await adminDb.doc(`pools/${POOL_ID}`).set({
    id: POOL_ID,
    season_id: POOL_SEASON_ID,
    season_num: POOL_SEASON_NUM,
    name: POOL_NAME,
    freeze_at: admin.firestore.Timestamp.fromDate(freezeAt),
    roster: POOL_ROSTER,
    picks_per_entry: PICKS_PER_ENTRY,
    prop_bet_keys: PropBetQuestionKeys,
    prop_bet_answers: [
      ...POOL_ROSTER.map((pick) => pick.castaway_id),
      "Yes",
      "No",
    ],
    status: "open",
    display_mode: "full",
    latest_episode_num: null,
    season_complete: false,
  });
  await adminDb.doc(`pools/${POOL_ID}/meta/counters`).set({
    entry_count: 0,
    updated_at: new Date().toISOString(),
  });
};

/** Every question answered, which is what an entry the rules accept carries. */
const seededPropBets = () =>
  Object.fromEntries(
    PropBetQuestionKeys.map((key) => [
      key,
      PropBetsQuestions[key].answer_type === "boolean"
        ? "Yes"
        : PROP_BET_PICK.castaway_id,
    ]),
  );

/**
 * An entry that is already in, written with the Admin SDK so it can exist in a
 * pool that is already frozen. The shape is exactly what `poolEntryPayload.ts`
 * builds, because the rules validate the merged document on every later write.
 */
const seedPoolEntry = async (uid: string, handle: string) => {
  const now = admin.firestore.Timestamp.now();
  await adminDb.doc(`pools/${POOL_ID}/entries/${uid}`).set({
    id: `pool_entry_${uid}`,
    pool_id: POOL_ID,
    season_id: POOL_SEASON_ID,
    handle,
    picks: POOL_ROSTER.slice(0, PICKS_PER_ENTRY),
    prop_bets: seededPropBets(),
    created_at: now,
    updated_at: now,
  });
};

const readPoolEntry = async (uid: string) => {
  const snap = await adminDb.doc(`pools/${POOL_ID}/entries/${uid}`).get();
  return snap.exists ? snap.data() : undefined;
};

const participantMap = (users: SeededUser[]) =>
  Object.fromEntries(
    users.map((u) => [
      u.uid,
      {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        isAdmin: false,
      },
    ]),
  );

const seedDraft = async (
  draftId: string,
  participants: SeededUser[],
  opts: { started: boolean },
) => {
  const creator = participants[0];
  const record = {
    id: draftId,
    season_id: SEASON_ID,
    season_num: SEASON_ORDER,
    competiton_id: `competition_${draftId}`,
    creator_uid: creator.uid,
    participants: participantMap(participants),
    total_players: SEASON_PLAYERS.length,
    pick_order_uids: opts.started
      ? Object.fromEntries(participants.map((u, i) => [String(i), u.uid]))
      : {},
    turns: opts.started ? { "1": creator.uid } : {},
    draft_picks: {},
    prop_bets: {},
    state: {
      current_pick_number: opts.started ? 1 : 0,
      started: opts.started,
      finished: false,
    },
    created_at: Date.now(),
  };
  const res = await fetch(rtdbUrl(`drafts/${draftId}`), {
    method: "PUT",
    headers: RTDB_HEADERS,
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`draft seed failed: ${res.status}`);
};

type RtdbDraft = {
  creator_uid: string;
  participants?: Record<string, { uid: string }>;
  state?: { started?: boolean };
};

const readDrafts = async (): Promise<Record<string, RtdbDraft> | null> => {
  const res = await fetch(rtdbUrl("drafts"), { headers: RTDB_HEADERS });
  if (!res.ok) throw new Error(`draft read failed: ${res.status}`);
  return (await res.json()) as Record<string, RtdbDraft> | null;
};

// ---------------------------------------------------------------------------
// Network guard: fail on any production-bound Firebase request
// ---------------------------------------------------------------------------

const PROD_HOST_SUFFIXES = [
  ".googleapis.com",
  ".firebaseio.com",
  ".firebasedatabase.app",
  ".firebaseapp.com",
  ".google-analytics.com",
  ".googletagmanager.com",
];

// Static font assets the Auth emulator's own sign-in picker page pulls in.
// They carry no Firebase data and never touch the production project.
const EMULATOR_PICKER_ASSET_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

const isProductionHost = (hostname: string): boolean => {
  if (hostname === "127.0.0.1" || hostname === "localhost") return false;
  if (EMULATOR_PICKER_ASSET_HOSTS.includes(hostname)) return false;
  return PROD_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
};

let productionViolations: string[] = [];

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

const SLOW = { timeout: 20_000 };

const dialog = (page: Page) => page.getByRole("dialog");

const main = (page: Page) => page.getByRole("main");

const mainNav = (page: Page) =>
  page.getByRole("navigation", { name: "Main navigation" });

const registerThrough = async (
  page: Page,
  user: { name: string; email: string; password: string },
) => {
  await dialog(page).getByLabel("Display Name").fill(user.name);
  await dialog(page).getByLabel("Email").fill(user.email);
  await dialog(page)
    .getByRole("textbox", { name: "Password" })
    .fill(user.password);
  await dialog(page).getByRole("button", { name: "Create account" }).click();
};

const signInThrough = async (
  page: Page,
  user: { email: string; password: string },
) => {
  // Gates opened via "Create account" start in register mode; gates opened via
  // "Sign in" and the navbar start in sign-in mode. Selecting the tab is a
  // no-op in the latter case.
  await dialog(page).getByRole("tab", { name: "Sign in" }).click();
  await dialog(page).getByLabel("Email").fill(user.email);
  await dialog(page)
    .getByRole("textbox", { name: "Password" })
    .fill(user.password);
  await dialog(page).getByRole("button", { name: "Sign in" }).click();
};

const openMobileNav = async (page: Page) => {
  await page.getByRole("button", { name: "Toggle navigation" }).click();
};

const expectSignedIn = async (page: Page, isMobile: boolean) => {
  if (isMobile) await openMobileNav(page);
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible(SLOW);
  if (isMobile) await openMobileNav(page); // close the overlay again
};

const signOutViaNavbar = async (page: Page, isMobile: boolean) => {
  if (isMobile) await openMobileNav(page);
  await mainNav(page).getByRole("button", { name: "Logout" }).click();
  await expect(
    mainNav(page).getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible(SLOW);
  if (isMobile) await openMobileNav(page); // close the overlay again
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

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
  await wipeEmulators();
});

test.afterEach(async () => {
  expect(
    productionViolations,
    `production-bound Firebase requests: ${productionViolations.join(", ")}`,
  ).toEqual([]);
});

test.afterAll(async () => {
  await wipeEmulators();
});

test("suite guard: app talks only to local emulators", async ({ page }) => {
  await seedSeason();
  const user = await createUser(uniqueEmail("guard"), PASSWORD, "Guard User");

  const firestoreRequest = page.waitForRequest((r) =>
    r.url().startsWith(FIRESTORE_EMU),
  );
  await page.goto(`/seasons/${SEASON_ID}`);
  await firestoreRequest;

  const authRequest = page.waitForRequest((r) => r.url().startsWith(AUTH_EMU));
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await authRequest;

  // Signed-in UI confirms the full emulator round trip; any production-bound
  // request would already have failed this test via the network guard.
  await expect(
    page.getByRole("button", { name: "Start a draft" }).first(),
  ).toBeVisible(SLOW);
});

// AE1 + duplicate-effect guard: under the dev server React Strict Mode replays
// effects, and exactly one draft record must still result.
test("registration from Start creates exactly one draft and lands in its lobby (AE1)", async ({
  page,
}) => {
  await seedSeason();
  const email = uniqueEmail("register-start");

  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    dialog(page).getByText(`Start a draft for ${SEASON_NAME}`),
  ).toBeVisible();
  await registerThrough(page, {
    name: "New Player",
    email,
    password: PASSWORD,
  });

  // No second start action: the retained intent continues on its own.
  await expect(page).toHaveURL(
    new RegExp(`/seasons/${SEASON_ID}/draft/draft_`),
    SLOW,
  );
  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );

  const account = await findAccountByEmail(email, PASSWORD);
  const drafts = await readDrafts();
  const records = Object.values(drafts ?? {});
  expect(records).toHaveLength(1);
  expect(records[0].creator_uid).toBe(account.localId);
  expect(Object.keys(records[0].participants ?? {})).toEqual([account.localId]);
  expect(records[0].state?.started).toBe(false);
});

test("sign-in from Start creates one draft without another click", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const user = await createUser(
    uniqueEmail("login-start"),
    PASSWORD,
    "Returning Player",
  );

  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });

  await expect(page).toHaveURL(
    new RegExp(`/seasons/${SEASON_ID}/draft/draft_`),
    SLOW,
  );
  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );

  const drafts = await readDrafts();
  const records = Object.values(drafts ?? {});
  expect(records).toHaveLength(1);
  expect(records[0].creator_uid).toBe(user.uid);
});

// AE2: register from a valid invitation and land in the lobby as a participant.
test("registration from a valid invitation joins exactly once (AE2)", async ({
  page,
}) => {
  await seedSeason();
  const host = await createUser(uniqueEmail("host"), PASSWORD, "Host User");
  await seedDraft(VALID_INVITE_DRAFT, [host], { started: false });
  const email = uniqueEmail("invitee");

  await page.goto(`/seasons/${SEASON_ID}/draft/${VALID_INVITE_DRAFT}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    dialog(page).getByText(`Join the ${SEASON_NAME} draft`),
  ).toBeVisible();
  await registerThrough(page, {
    name: "Invited Friend",
    email,
    password: PASSWORD,
  });

  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("2 joined")).toBeVisible(SLOW);

  const account = await findAccountByEmail(email, PASSWORD);
  const drafts = await readDrafts();
  const participants = Object.values(
    drafts?.[VALID_INVITE_DRAFT]?.participants ?? {},
  );
  expect(participants).toHaveLength(2);
  expect(participants.filter((p) => p.uid === account.localId)).toHaveLength(1);
});

// AE7 family: an existing member signing in from the invitation must not
// produce a duplicate membership write.
test("sign-in as an existing participant adds no duplicate membership", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const host = await createUser(uniqueEmail("host"), PASSWORD, "Host User");
  const member = await createUser(
    uniqueEmail("member"),
    PASSWORD,
    "Member User",
  );
  await seedDraft(MEMBER_DRAFT, [host, member], { started: false });

  await page.goto(`/seasons/${SEASON_ID}/draft/${MEMBER_DRAFT}`);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: member.email, password: PASSWORD });

  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("2 joined")).toBeVisible(SLOW);

  const drafts = await readDrafts();
  const participants = Object.values(
    drafts?.[MEMBER_DRAFT]?.participants ?? {},
  );
  expect(participants).toHaveLength(2);
  expect(participants.filter((p) => p.uid === member.uid)).toHaveLength(1);
});

// AE3: the draft starts before authentication completes.
test("stale invitation: started draft stays signed in, adds no participant, shows the unavailable state (AE3)", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const host = await createUser(uniqueEmail("host"), PASSWORD, "Host User");
  await seedDraft(STARTED_DRAFT, [host], { started: true });
  const email = uniqueEmail("late-invitee");

  await page.goto(`/seasons/${SEASON_ID}/draft/${STARTED_DRAFT}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await registerThrough(page, {
    name: "Late Friend",
    email,
    password: PASSWORD,
  });

  await expect(
    page.getByText("This draft can no longer be joined"),
  ).toBeVisible(SLOW);
  await expect(
    page.getByText(
      "This draft has already started and can no longer be joined.",
    ),
  ).toBeVisible(SLOW);
  await expect(
    page.getByRole("link", { name: "Browse competitions" }),
  ).toBeVisible();

  // The user remains signed in and no membership write happened.
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
  const drafts = await readDrafts();
  const participants = Object.values(
    drafts?.[STARTED_DRAFT]?.participants ?? {},
  );
  expect(participants).toHaveLength(1);
  expect(participants[0].uid).toBe(host.uid);
});

// AE4/AE5: the confirmation is identical for known and unknown emails.
test("reset request shows the identical confirmation for known and unknown emails (AE4/AE5)", async ({
  page,
}) => {
  await seedSeason();
  const known = await createUser(uniqueEmail("known"), PASSWORD, "Known User");
  const unknownEmail = uniqueEmail("ghost");

  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await dialog(page).getByRole("tab", { name: "Sign in" }).click();
  await dialog(page).getByLabel("Email").fill(unknownEmail);
  await dialog(page).getByRole("button", { name: "Forgot password?" }).click();

  // The entered email carries forward into the reset-request form.
  await expect(dialog(page).getByLabel("Email")).toHaveValue(unknownEmail);

  await dialog(page).getByRole("button", { name: "Send reset email" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText(
    RESET_REQUEST_CONFIRMATION,
    SLOW,
  );

  await dialog(page).getByLabel("Email").fill(known.email);
  await dialog(page).getByRole("button", { name: "Send reset email" }).click();
  // The known-email request actually reaches the emulator; only then compare.
  await expect
    .poll(async () => (await getPasswordResetCodes(known.email)).length, {
      timeout: 15_000,
    })
    .toBe(1);
  await expect(dialog(page).getByRole("alert")).toHaveText(
    RESET_REQUEST_CONFIRMATION,
  );
  expect(await getPasswordResetCodes(unknownEmail)).toHaveLength(0);
});

// AE4: complete the reset through the app-owned handler.
test("reset completion: new password signs in, old password fails, reused code is invalid (AE4)", async ({
  page,
  isMobile,
}) => {
  const user = await createUser(uniqueEmail("reset"), PASSWORD, "Reset User");
  // The old-password check below uses the season page sign-in gate.
  await seedSeason();
  await requestResetEmail(user.email);
  await expect
    .poll(async () => (await getPasswordResetCodes(user.email)).length, {
      timeout: 15_000,
    })
    .toBe(1);
  const code = (await getPasswordResetCodes(user.email))[0].oobCode;

  await page.goto(`/reset-password?mode=resetPassword&oobCode=${code}`);
  // The one-time code is captured into page memory and stripped from the
  // address bar before any form renders.
  await expect(page).toHaveURL("/reset-password");

  await page.getByRole("textbox", { name: "New password" }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated" }),
  ).toBeVisible(SLOW);

  // Sign in with the new password; the email is prefilled from verification.
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(dialog(page).getByLabel("Email")).toHaveValue(user.email);
  await dialog(page)
    .getByRole("textbox", { name: "Password" })
    .fill(NEW_PASSWORD);
  await dialog(page).getByRole("button", { name: "Sign in" }).click();
  await expect(dialog(page)).toBeHidden(SLOW);
  await expectSignedIn(page, Boolean(isMobile));

  await signOutViaNavbar(page, Boolean(isMobile));

  // The old password no longer signs in.
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(dialog(page).getByRole("alert")).toContainText(
    "We could not sign you in with that email and password",
    SLOW,
  );

  // The consumed code cannot be reused.
  await page.goto(`/reset-password?mode=resetPassword&oobCode=${code}`);
  await expect(
    page.getByRole("heading", { name: "Reset link no longer valid" }),
  ).toBeVisible(SLOW);
  await expect(
    page.getByRole("button", { name: "Request a new reset email" }),
  ).toBeVisible();
});

// Real-flow fidelity (AE4): the reset request is submitted through the UI so
// ForgotPassword's generated actionCodeSettings continue URL, the state-key
// propagation, and the continuation handoff are all exercised. Only the OOB
// entry itself is read from the emulator; the app route is composed from the
// generated link's own parameters, never hand-assembled.
test("reset through the generated email link continues the retained start-draft intent", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const user = await createUser(
    uniqueEmail("reset-flow"),
    PASSWORD,
    "Reset Flow User",
  );

  // Save a start-draft intent through the gate, then request the reset
  // through the UI so the app builds the real action URL.
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    dialog(page).getByText(`Start a draft for ${SEASON_NAME}`),
  ).toBeVisible();
  await dialog(page).getByRole("tab", { name: "Sign in" }).click();
  await dialog(page).getByRole("button", { name: "Forgot password?" }).click();
  await dialog(page).getByLabel("Email").fill(user.email);
  await dialog(page).getByRole("button", { name: "Send reset email" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText(
    RESET_REQUEST_CONFIRMATION,
    SLOW,
  );

  // A confirmed reset request must survive dismissal: the emailed continue
  // URL still points at the pending intent's state key.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  await expect
    .poll(async () => (await getPasswordResetCodes(user.email)).length, {
      timeout: 15_000,
    })
    .toBe(1);
  const oobLink = (await getPasswordResetCodes(user.email))[0].oobLink;

  // The emulator's oobLink wraps its own handler with the generated action
  // parameters. Its continue URL must be the app's own reset route carrying
  // the saved intent's state key.
  const link = new URL(oobLink);
  expect(link.searchParams.get("mode")).toBe("resetPassword");
  expect(link.searchParams.get("oobCode")).toBeTruthy();
  const continueUrl = link.searchParams.get("continueUrl");
  if (!continueUrl) {
    throw new Error("generated reset link carries no continueUrl");
  }
  const continueTarget = new URL(continueUrl);
  expect(continueTarget.origin).toBe(new URL(page.url()).origin);
  expect(continueTarget.pathname).toBe("/reset-password");
  const stateKey = continueTarget.searchParams.get("state");
  expect(stateKey).toBeTruthy();

  // The state key identifies the intent saved above, not a forged value.
  const storedIntents = await page.evaluate(() =>
    window.localStorage.getItem("survivor_auth_intents"),
  );
  const intentRecords = (
    JSON.parse(storedIntents ?? "{}") as { records?: Record<string, unknown> }
  ).records;
  expect(
    intentRecords !== undefined &&
      stateKey !== null &&
      stateKey in intentRecords,
  ).toBe(true);

  // In production the console email template points the link at the app's
  // reset route with exactly these generated parameters; compose it the same
  // way here. The one-time code is captured into page memory and stripped
  // from the address bar before any form renders.
  await page.goto(`/reset-password${link.search}`);
  await expect(page).toHaveURL("/reset-password");

  await page.getByRole("textbox", { name: "New password" }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated" }),
  ).toBeVisible(SLOW);

  // Sign in from the page: the account email is prefilled and the retained
  // start-draft action is described.
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(dialog(page).getByLabel("Email")).toHaveValue(user.email);
  await expect(
    dialog(page).getByText("Sign in to continue starting your draft."),
  ).toBeVisible();
  await dialog(page)
    .getByRole("textbox", { name: "Password" })
    .fill(NEW_PASSWORD);
  await dialog(page).getByRole("button", { name: "Sign in" }).click();

  // The continuation returns to the season page and executes exactly once:
  // one draft in RTDB with this user as creator.
  await expect(page).toHaveURL(
    new RegExp(`/seasons/${SEASON_ID}/draft/draft_`),
    SLOW,
  );
  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );
  const drafts = await readDrafts();
  const draftRecords = Object.values(drafts ?? {});
  expect(draftRecords).toHaveLength(1);
  expect(draftRecords[0].creator_uid).toBe(user.uid);

  await signOutViaNavbar(page, Boolean(isMobile));

  // The old password no longer signs in.
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(dialog(page).getByRole("alert")).toContainText(
    "We could not sign you in with that email and password",
    SLOW,
  );
});

// When Firebase's own hosted handler owns the reset (the console action URL
// is not pointed at this app), it returns the user to the continue URL after
// they set the new password there: this route, carrying the state key but no
// action code. That must not read as a failure, and the retained action must
// still continue.
test("a return from the hosted reset handler continues the retained intent", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const user = await createUser(
    uniqueEmail("hosted-return"),
    PASSWORD,
    "Hosted Return User",
  );

  // Save a start-draft intent through the gate, then request the reset from
  // the same modal. Only a sent reset request keeps the intent pending after
  // dismissal (a plain cancel discards it), and this is the path every real
  // hosted-handler return has taken.
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    dialog(page).getByText(`Start a draft for ${SEASON_NAME}`),
  ).toBeVisible();
  await dialog(page).getByRole("tab", { name: "Sign in" }).click();
  await dialog(page).getByRole("button", { name: "Forgot password?" }).click();
  await dialog(page).getByLabel("Email").fill(user.email);
  await dialog(page).getByRole("button", { name: "Send reset email" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText(
    RESET_REQUEST_CONFIRMATION,
    SLOW,
  );
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  // The generated email link's continue URL is the address Firebase's hosted
  // handler sends the user back to; read the state key from there rather
  // than from storage.
  await expect
    .poll(async () => (await getPasswordResetCodes(user.email)).length, {
      timeout: 15_000,
    })
    .toBe(1);
  const oobLink = (await getPasswordResetCodes(user.email))[0].oobLink;
  const continueUrl = new URL(oobLink).searchParams.get("continueUrl");
  if (!continueUrl) {
    throw new Error("generated reset link carries no continueUrl");
  }
  const continueTarget = new URL(continueUrl);
  expect(continueTarget.pathname).toBe("/reset-password");
  const stateKey = continueTarget.searchParams.get("state");
  expect(stateKey).toBeTruthy();

  // Exactly what Firebase's hosted handler redirects to after a successful
  // reset: the continue URL, with no mode or oobCode.
  await page.goto(`/reset-password?state=${stateKey}`);
  await expect(page).toHaveURL("/reset-password");
  await expect(
    page.getByRole("heading", { name: "Sign in with your new password" }),
  ).toBeVisible(SLOW);
  await expect(
    page.getByRole("heading", { name: "Reset link no longer valid" }),
  ).toHaveCount(0);

  // Signing in from here resumes the retained start-draft action once.
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    dialog(page).getByText("Sign in to continue starting your draft."),
  ).toBeVisible();
  await signInThrough(page, { email: user.email, password: PASSWORD });

  await expect(page).toHaveURL(
    new RegExp(`/seasons/${SEASON_ID}/draft/draft_`),
    SLOW,
  );
  const drafts = await readDrafts();
  const draftRecords = Object.values(drafts ?? {});
  expect(draftRecords).toHaveLength(1);
  expect(draftRecords[0].creator_uid).toBe(user.uid);
});

// AE8: sign-out restores signed-out entry points, and the legacy /logout
// route signs the user out and offers account entry without a 404.
test("sign-out from the navbar and the /logout route restores signed-out state (AE8)", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const user = await createUser(uniqueEmail("logout"), PASSWORD, "Logout User");

  await page.goto("/");
  await mainNav(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(
    mainNav(page).getByRole("button", { name: "Logout" }),
  ).toBeVisible(SLOW);

  // Sign out from the navbar: the signed-out entries return.
  await mainNav(page).getByRole("button", { name: "Logout" }).click();
  await expect(
    mainNav(page).getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible(SLOW);
  await expect(
    mainNav(page).getByRole("button", { name: "Create account", exact: true }),
  ).toBeVisible();

  // Protected actions present both entry choices again.
  await page.goto(`/seasons/${SEASON_ID}`);
  await expect(
    main(page).getByRole("button", { name: "Create account", exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();

  // Sign back in, then sign out via the legacy /logout route.
  await mainNav(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(
    mainNav(page).getByRole("button", { name: "Logout" }),
  ).toBeVisible(SLOW);

  await page.goto("/logout");
  await expect(page).toHaveURL("/logout");
  await expect(
    page.getByRole("heading", { name: "You're signed out" }),
  ).toBeVisible(SLOW);
  await expect(
    mainNav(page).getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    mainNav(page).getByRole("button", { name: "Logout" }),
  ).toHaveCount(0);

  // The page offers account entry without the removed /login route.
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();
});

test("login completes with keyboard only", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  const user = await createUser(
    uniqueEmail("keyboard"),
    PASSWORD,
    "Keyboard User",
  );

  await page.goto("/");
  await mainNav(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(dialog(page)).toBeVisible();

  // The modal heading starts focused; tab forward to each field.
  const tabToInput = async (type: "email" | "password") => {
    for (let i = 0; i < 15; i++) {
      const matched = await page.evaluate(
        (t) =>
          document.activeElement instanceof HTMLInputElement &&
          document.activeElement.type === t,
        type,
      );
      if (matched) return;
      await page.keyboard.press("Tab");
    }
    throw new Error(`keyboard navigation did not reach the ${type} field`);
  };

  await tabToInput("email");
  await page.keyboard.type(user.email);
  await tabToInput("password");
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible(SLOW);
});

// ---------------------------------------------------------------------------
// U6: entry-point copy and signed-out states
// ---------------------------------------------------------------------------

// R2/R15: both account entries are discoverable in the navigation on desktop
// and mobile, and each opens the modal in its own mode.
test("signed-out navigation offers distinct Sign in and Create account choices", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  if (isMobile) await openMobileNav(page);

  const signIn = mainNav(page).getByRole("button", {
    name: "Sign in",
    exact: true,
  });
  const createAccount = mainNav(page).getByRole("button", {
    name: "Create account",
    exact: true,
  });
  await expect(signIn).toBeVisible();
  await expect(createAccount).toBeVisible();

  await signIn.click();
  await expect(
    dialog(page).getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  await createAccount.click();
  await expect(
    dialog(page).getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
});

// R2/R3: the season gate presents both choices and names the pending Start
// action in each mode.
test("season gate names the pending Start action in both entry modes", async ({
  page,
}) => {
  await seedSeason();
  await page.goto(`/seasons/${SEASON_ID}`);

  const createAccount = main(page).getByRole("button", {
    name: "Create account",
    exact: true,
  });
  const signIn = main(page).getByRole("button", {
    name: "Sign in",
    exact: true,
  });
  await expect(createAccount).toBeVisible();
  await expect(signIn).toBeVisible();

  await createAccount.click();
  await expect(
    dialog(page).getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
  await expect(
    dialog(page).getByText(`Start a draft for ${SEASON_NAME}`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  await signIn.click();
  await expect(
    dialog(page).getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();
  await expect(
    dialog(page).getByText(`Start a draft for ${SEASON_NAME}`),
  ).toBeVisible();
});

// R10 + KTD1: an abandoned Start action is cleared on dismissal, so a later,
// unrelated sign-in cannot inherit it and create a draft.
test("a dismissed Start intent cannot execute for a later sign-in", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedSeason();
  const user = await createUser(
    uniqueEmail("abandoned"),
    PASSWORD,
    "Abandoned Intent",
  );

  // Save a pending start-draft intent, then abandon it by dismissing the
  // modal without authenticating.
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    dialog(page).getByText(`Start a draft for ${SEASON_NAME}`),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  // Sign in from the navbar as an existing, unrelated account.
  await mainNav(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(dialog(page)).toBeHidden(SLOW);

  // No draft is created and the visitor stays on the season page.
  await expect(page).toHaveURL(new RegExp(`/seasons/${SEASON_ID}$`));
  await expect
    .poll(async () => Object.keys((await readDrafts()) ?? {}))
    .toEqual([]);
});

// R1/R14: public pages render signed out without any auth prompt, and the
// homepage no longer claims that joining works without an account.
test("public browsing stays account-free and makes no no-signup claims", async ({
  page,
}) => {
  await seedSeason();

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Grab your torch/ }),
  ).toBeVisible(SLOW);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText(/No accounts needed/)).toHaveCount(0);
  await expect(page.getByText(/No signup wall/)).toHaveCount(0);

  await page.goto(`/seasons/${SEASON_ID}`);
  await expect(page.getByRole("heading", { name: SEASON_NAME })).toBeVisible(
    SLOW,
  );
  await expect(dialog(page)).toHaveCount(0);
});

// Social sign-in through the Auth emulator's fake account picker. The
// emulator serves its own popup page for Google at AUTH_EMU, so this
// exercises the real signInWithPopup path with no production traffic.
// The Competitions page is the entry point because its sign-in gate carries
// no retained intent, so nothing else happens after authentication.

// The picker attaches its click handlers in an inline script that runs only
// after a blocking third-party script has loaded, so interacting before the
// load event can click a button that does nothing yet. It then hands its
// result to the emulator relay iframe inside the opener page; on a cold dev
// server that iframe can still be loading when the picker submits, and the
// result is dropped, so wait for the relay to finish loading too.
const openGooglePicker = async (page: Page) => {
  const popup = page.waitForEvent("popup");
  await dialog(page)
    .getByRole("button", { name: "Continue with Google" })
    .click();
  const picker = await popup;
  await picker.waitForLoadState("load");

  const isRelayFrame = (url: string) => url.includes("/emulator/auth/iframe");
  await expect
    .poll(() => page.frames().some((frame) => isRelayFrame(frame.url())), SLOW)
    .toBe(true);
  await page
    .frames()
    .find((frame) => isRelayFrame(frame.url()))
    ?.waitForLoadState("load");
  return picker;
};

// The picker hands its result back by posting a message from the popup to the
// emulator's relay iframe inside the opener page. In headless Chromium that
// relay never arrives while any Playwright route is registered on the
// context, even a pass-through one, so this test swaps the suite's aborting
// guard for an observe-only tripwire: production-bound requests are still
// recorded and still fail the test in afterEach, they are just not aborted.
const observeProductionRequestsOnly = async (context: BrowserContext) => {
  await context.unroute("**/*");
  context.on("request", (request) => {
    if (isProductionHost(new URL(request.url()).hostname)) {
      productionViolations.push(request.url());
    }
  });
};

const userDocsFor = async (email: string) =>
  (await adminDb.collection("users").where("email", "==", email).get()).docs;

test("Google sign-in: a first visit creates the account and user document, a return visit reuses both", async ({
  page,
  context,
  isMobile,
}) => {
  await observeProductionRequestsOnly(context);
  await page.goto("/competitions");
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();

  // First sign-in: pick a brand-new auto-generated Google account.
  const picker = await openGooglePicker(page);
  await picker.locator("#add-account-button").click();
  await expect(picker.locator("#autogen-button")).toBeVisible();
  await picker.locator("#autogen-button").click();
  const email = await picker.locator("#email-input").inputValue();
  const displayName = await picker.locator("#display-name-input").inputValue();
  expect(email).toBeTruthy();
  await picker.locator("#sign-in").click();

  await expect(dialog(page)).toBeHidden(SLOW);
  await expectSignedIn(page, isMobile);

  // The user document is provisioned exactly like a password registration.
  await expect
    .poll(async () => (await userDocsFor(email)).length, SLOW)
    .toBe(1);
  const created = (await userDocsFor(email))[0].data();
  expect(created.displayName).toBe(displayName);
  expect(created.uid).toBe((await admin.auth().getUserByEmail(email)).uid);

  // Return visit: the same account signs straight back in and adds nothing.
  await signOutViaNavbar(page, isMobile);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  const returningPicker = await openGooglePicker(page);
  await returningPicker
    .locator("#accounts-list")
    .getByText(email, { exact: true })
    .click();

  await expect(dialog(page)).toBeHidden(SLOW);
  await expectSignedIn(page, isMobile);
  expect((await userDocsFor(email)).length).toBe(1);
});

// ---------------------------------------------------------------------------
// U5, U12, U13: the public season pool
// ---------------------------------------------------------------------------

// Two of the pool's behaviours cannot be proven by a pure-function test under
// this project's conventions, and they are the two the plan leads with: an
// entry filled in signed out and submitted through the account gate, and a
// write the boundary actually refuses. Both are here, driven through the real
// UI against real security rules.

/** Comfortably open for the whole of a test. */
const openFreeze = () => new Date(Date.now() + 10 * 60_000);
/** Already past, so every entry write against this pool is refused. */
const passedFreeze = () => new Date(Date.now() - 10 * 60_000);

/**
 * Put the browser's clock back to before a freeze that has already passed.
 *
 * The page's freeze check is cosmetic and re-evaluated on a 30 second tick, so
 * an entrant whose form was open when the freeze passed still has a submit
 * button in front of them. That is the AE2 scenario, and KTD4 names its cause:
 * browser clocks are not trustworthy, so the gate on screen can disagree with
 * the boundary. Only `Date` is faked here; timers, the Firestore SDK, and
 * `serverTimestamp()` are untouched, so the denial the test asserts comes from
 * the real rules comparing the real `request.time` against the stored
 * `freeze_at`. Racing the 30 second interval instead would make the same
 * assertion depend on how fast this machine fills in a form.
 */
const holdTheFormOpenPastFreeze = async (page: Page, freezeAt: Date) => {
  await page.clock.setFixedTime(new Date(freezeAt.getTime() - 5 * 60_000));
};

// By role, not by label: the picks, handle, and prop bets sections are each
// labelled by their own heading, so "Your handle" names a region as well as
// the field inside it.
const poolHandleField = (page: Page) =>
  page.getByRole("textbox", { name: "Your handle" });

const poolPicks = () => POOL_ROSTER.slice(0, PICKS_PER_ENTRY);

const choosePoolPicks = async (page: Page, picks = poolPicks()) => {
  for (const castaway of picks) {
    await page
      .getByRole("button", { name: `Pick ${castaway.full_name}` })
      .click();
  }
  await expect(
    page.getByText(`${picks.length} of ${PICKS_PER_ENTRY} picks chosen`),
  ).toBeVisible();
};

// The form renders every question and blocks submit until each one is
// answered, so the whole set is filled from the question list itself rather
// than from a copy of it that could drift.
const answerPropBets = async (page: Page) => {
  for (const key of PropBetQuestionKeys) {
    const question = PropBetsQuestions[key];
    await page
      .getByLabel(question.description, { exact: false })
      .first()
      .click();
    await page
      .getByRole("option", {
        name:
          question.answer_type === "boolean" ? "Yes" : PROP_BET_PICK.full_name,
        exact: true,
      })
      .click();
  }
};

/** A complete entry, in the order the page presents it. */
const fillPoolEntry = async (page: Page) => {
  await choosePoolPicks(page);
  await expect(poolHandleField(page)).toHaveCount(0);
  await answerPropBets(page);
};

test("pool: photo gallery supports keyboard browsing and local picks", async ({
  page,
}) => {
  await seedPool(openFreeze());
  await page.goto(`/pool/${POOL_SEASON_ID}`);
  const portrait = page.getByRole("button", {
    name: "View full photo of Aaliyah Puglia",
    exact: true,
  });
  await portrait.click();
  const photo = page.getByRole("dialog");
  await expect(photo).toBeVisible();
  await expect
    .poll(() =>
      photo
        .getByRole("img", { name: "Aaliyah Puglia", exact: true })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1536);
  await expect(photo.getByText("24 · Chef")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(photo).toHaveAccessibleName("Alexis Levine");
  await expect(photo.getByText(/Criminal Defense Attorney/)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(photo).toHaveAccessibleName("Aaliyah Puglia");
  await photo.getByRole("button", { name: "Previous castaway" }).click();
  await expect(photo).toHaveAccessibleName("Thien An Nguyen");
  await photo.getByRole("button", { name: "Pick Thien An Nguyen" }).click();
  await expect(
    photo.getByRole("button", { name: "Remove Thien An Nguyen" }),
  ).toHaveAttribute("aria-pressed", "true");
  await photo.getByRole("button", { name: "Remove Thien An Nguyen" }).click();
  await expect(photo.getByRole("status")).toHaveText("0 of 7 picks chosen.");
  await photo.getByRole("button", { name: "Next castaway" }).click();
  for (let index = 0; index < PICKS_PER_ENTRY; index++) {
    await photo.getByRole("button", { name: /^Pick / }).click();
    await photo.getByRole("button", { name: "Next castaway" }).click();
  }
  await expect(photo.getByRole("status")).toContainText(
    "replaces Aaliyah Puglia",
  );
  await photo.getByRole("button", { name: /^Pick / }).click();
  await expect(photo.getByRole("status")).toHaveText("7 of 7 picks chosen.");
  await page.keyboard.press("Escape");
  await expect(photo).toHaveCount(0);
  await expect(portrait).toBeFocused();
  await expect(
    page.getByText(`${PICKS_PER_ENTRY} of ${PICKS_PER_ENTRY} picks chosen`),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pick Aaliyah Puglia", exact: true }),
  ).toBeVisible();
  await expect(poolHandleField(page)).toHaveCount(0);
  expect(
    (await adminDb.collection(`pools/${POOL_ID}/entries`).get()).size,
  ).toBe(0);
});

test("draft: photo gallery follows turn order and shows the picked owner", async ({
  page,
}) => {
  await seedSeason();
  await adminDb.doc(`seasons/${SEASON_ID}`).update({
    players: SEASON_PLAYERS.map((player, index) => ({
      ...player,
      img: SEASON_51_PLAYERS[index].img,
      age: 30,
      profession: "Teacher",
      hometown: "Denver, Colorado",
    })),
  });
  const host = await createUser(
    uniqueEmail("gallery-host"),
    PASSWORD,
    "Gallery Host",
  );
  const member = await createUser(
    uniqueEmail("gallery-member"),
    PASSWORD,
    "Gallery Member",
  );
  const draftId = "draft_photo_gallery";
  await seedDraft(draftId, [host, member], { started: true });
  const seededTurns = await fetch(rtdbUrl(`drafts/${draftId}/turns`), {
    method: "PUT",
    headers: RTDB_HEADERS,
    body: JSON.stringify({
      "1": host.uid,
      "2": member.uid,
      "3": member.uid,
      "4": host.uid,
    }),
  });
  expect(seededTurns.ok).toBe(true);
  await page.goto(`/seasons/${SEASON_ID}/draft/${draftId}`);
  await main(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: host.email, password: PASSWORD });
  await page
    .getByRole("button", {
      name: "View full photo of Test Player 1",
      exact: true,
    })
    .click();
  const photo = page.getByRole("dialog");
  await expect(photo.getByText("30 · Teacher")).toBeVisible();
  await photo
    .getByRole("button", { name: "Draft Test Player 1", exact: true })
    .click();
  await expect(photo.getByText("Drafted by", { exact: true })).toBeVisible();
  await expect(photo.getByText("Gallery Host", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(photo).toHaveAccessibleName("Test Player 2");
  await expect(
    photo.getByRole("button", { name: "Draft Test Player 2", exact: true }),
  ).toBeDisabled();
  await expect(photo.getByRole("status")).toHaveText(
    "You can draft when it is your turn.",
  );
  const saved = await fetch(rtdbUrl(`drafts/${draftId}/draft_picks`), {
    headers: RTDB_HEADERS,
  });
  const savedPicks = Object.values(await saved.json()).filter(
    Boolean,
  ) as Array<{
    castaway_id: string;
    user_uid: string;
  }>;
  expect(savedPicks).toHaveLength(1);
  expect(savedPicks[0]).toMatchObject({
    castaway_id: SEASON_PLAYERS[0].castaway_id,
    user_uid: host.uid,
  });
});

test("pool: independent players share picks and a newer device save clears an old rejection", async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  // The Windows WebKit emulator stalls inconsistently on authenticated
  // reloads across two contexts. Keep this regression on Chromium; the
  // single-player registration scenario below also runs on mobile WebKit.
  test.skip(
    Boolean(isMobile),
    "two-context emulator regression is desktop-only",
  );
  test.setTimeout(180_000);
  await seedPool(openFreeze());
  const alice = await createUser(uniqueEmail("pool-alice"), PASSWORD, "Alice");
  const bob = await createUser(uniqueEmail("pool-bob"), PASSWORD, "Bob");
  const other = await browser.newContext({
    ...test.info().project.use,
    baseURL,
  });
  await other.route("**/*", async (route) => {
    if (isProductionHost(new URL(route.request().url()).hostname)) {
      productionViolations.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const bobPage = await other.newPage();
  try {
    for (const [playerPage, user, handle] of [
      [page, alice, "Alice"],
      [bobPage, bob, "Bob"],
    ] as const) {
      await playerPage.goto(`/pool/${POOL_SEASON_ID}`);
      await fillPoolEntry(playerPage);
      await playerPage.getByRole("button", { name: "Submit my entry" }).click();
      await signInThrough(playerPage, {
        email: user.email,
        password: PASSWORD,
      });
      await expect(playerPage.getByText("Your entry is in.")).toBeVisible();
      await expect
        .poll(async () => (await readPoolEntry(user.uid))?.handle)
        .toBe(handle);
    }
    expect((await readPoolEntry(alice.uid))?.picks).toEqual(
      (await readPoolEntry(bob.uid))?.picks,
    );
    await expect(page.getByText("Bob", { exact: true })).toHaveCount(0);
    await expect(bobPage.getByText("Alice", { exact: true })).toHaveCount(0);

    // A persisted rejection is legitimate until a newer server save arrives.
    // Seed it after the existing write so loading the old entry cannot clear it.
    await page.bringToFront();
    await page.evaluate((poolId) => {
      localStorage.setItem(
        `survivor_pool_write_rejection_v1:${poolId}`,
        JSON.stringify({ pool_id: poolId, kind: "update", at: Date.now() }),
      );
    }, POOL_ID);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByText(
        "This pool closed before your changes reached us, so your entry is unchanged. Your picks are still on screen.",
      ),
    ).toBeVisible();
    await adminDb.doc(`pools/${POOL_ID}/entries/${alice.uid}`).update({
      handle: "AliceNewDevice",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Revisit after the other device saved: the browser-local rejection
    // survives reload and must be reconciled with the current server entry.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("AliceNewDevice", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This pool closed before your changes reached us, so your entry is unchanged. Your picks are still on screen.",
      ),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (poolId) =>
          localStorage.getItem(`survivor_pool_write_rejection_v1:${poolId}`),
        POOL_ID,
      ),
    ).toBeNull();

    await page.getByRole("button", { name: "Withdraw my entry" }).click();
    await dialog(page)
      .getByRole("button", { name: "Withdraw my entry" })
      .click();
    await expect
      .poll(async () => (await readPoolEntry(alice.uid)) === undefined)
      .toBe(true);
    await bobPage.reload({ waitUntil: "domcontentloaded" });
    await expect(bobPage.getByText("Your entry is in.")).toBeVisible();
    expect((await readPoolEntry(bob.uid))?.handle).toBe("Bob");
  } finally {
    await bobPage.goto("about:blank", { waitUntil: "domcontentloaded" });
    await other.close();
  }
});

// AE1 (R1, R6): a signed-out visitor fills the entry in, meets the account
// gate at submit, and the entry lands under their new uid with nothing
// entered twice. The gate is at submit and nowhere earlier (KD5), so the
// whole form is filled in before any account exists.
test("pool: a signed-out entry survives registration and lands under the new uid (AE1)", async ({
  page,
}) => {
  await seedPool(openFreeze());
  const email = uniqueEmail("pool-entrant");

  await page.goto(`/pool/${POOL_SEASON_ID}`);
  await expect(page.getByRole("heading", { name: POOL_NAME })).toBeVisible(
    SLOW,
  );
  // No page-level sign-in gate: the pool is enterable before an account is
  // (R18), and a modal here would mean the entry could never be filled first.
  await expect(dialog(page)).toHaveCount(0);

  const picks = poolPicks();
  await fillPoolEntry(page);

  // Submitting the prop bets is submitting the entry, and is the one moment
  // the account gate appears.
  await page.getByRole("button", { name: "Submit my entry" }).click();
  await expect(dialog(page).getByText(`Enter the ${POOL_NAME}`)).toBeVisible(
    SLOW,
  );

  await registerThrough(page, {
    name: "Pool Entrant",
    email,
    password: PASSWORD,
  });

  // No second submit: the retained intent finishes the entry on its own, and
  // the page comes back with the entry and its edit affordance.
  await expect(page.getByRole("heading", { name: "Your entry" })).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("Your entry is in.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change my entry" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Withdraw my entry" }),
  ).toBeVisible();

  // What landed is what was typed before the account existed. This is the
  // whole claim: not that an entry exists, but that it is that entry.
  const account = await findAccountByEmail(email, PASSWORD);
  // Poll rather than read once. The page renders the submitted entry as soon
  // as the SDK's local cache holds the pending write, which is before the
  // server has acknowledged it, so the on-screen state is not proof the
  // document exists server-side yet. The Admin SDK sees only what landed.
  await expect
    .poll(async () => (await readPoolEntry(account.localId)) !== undefined, {
      message: "no entry document at the new uid",
      timeout: 20_000,
    })
    .toBe(true);
  const entry = await readPoolEntry(account.localId);
  expect(entry?.id).toBe(`pool_entry_${account.localId}`);
  expect(entry?.pool_id).toBe(POOL_ID);
  expect(entry?.handle).toBe("Pool Entrant");
  expect(entry?.picks).toEqual(picks);
  expect(Object.keys(entry?.prop_bets ?? {}).sort()).toEqual(
    [...PropBetQuestionKeys].sort(),
  );
  expect(entry?.prop_bets.propbet_winner).toBe(PROP_BET_PICK.castaway_id);
  expect(entry?.prop_bets.propbet_quit).toBe("Yes");

  // Exactly one entry: the intent is single-use, and a Strict Mode effect
  // replay under the dev server must not produce a second write.
  const entries = await adminDb.collection(`pools/${POOL_ID}/entries`).get();
  expect(entries.size).toBe(1);

  // The entry uses the completed account profile, not an email or draft handle.
  await expect(
    page
      .getByRole("region", { name: "Your entry" })
      .getByText("Pool Entrant", { exact: true }),
  ).toBeVisible();
});

// U13: the same fill, but interrupted by a reload before the account exists.
//
// This is the case the autosave is actually for. The test above completes in
// one page context, so its entry is submitted from React state and passes
// even with browser storage emptied -- proven by wiping it there and watching
// the test still pass. Only a reload discards that state, which makes this
// the test that holds U13's claim that the restored entry is sourced from the
// autosave rather than from memory.
test("pool: an entry filled in signed out survives a reload and then sign-in (U13)", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  await seedPool(openFreeze());
  const email = uniqueEmail("pool-reload");
  const picks = poolPicks();

  await page.goto(`/pool/${POOL_SEASON_ID}`);
  await expect(page.getByRole("heading", { name: POOL_NAME })).toBeVisible(
    SLOW,
  );
  await fillPoolEntry(page);

  // Every field survives even before Submit: closing a tab while answering
  // prop bets must not silently discard those answers.
  await page.reload();
  await expect(
    page.getByText(
      `${PropBetQuestionKeys.length} of ${PropBetQuestionKeys.length} answered`,
    ),
  ).toBeVisible();
  await expect(poolHandleField(page)).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Season winner", exact: true }),
  ).toHaveValue(PROP_BET_PICK.full_name);

  // Submitting saves the autosave and the resume marker, then asks for an
  // account. Dismiss it and reload: every bit of in-memory state is gone.
  await page.getByRole("button", { name: "Submit my entry" }).click();
  await expect(dialog(page).getByText(`Enter the ${POOL_NAME}`)).toBeVisible(
    SLOW,
  );
  await page.keyboard.press("Escape");
  await page.reload();

  // The form comes back filled from browser storage alone.
  await expect(
    page.getByText(`${picks.length} of ${PICKS_PER_ENTRY} picks chosen`),
  ).toBeVisible(SLOW);
  await expect(poolHandleField(page)).toHaveCount(0);
  for (const castaway of picks) {
    await expect(
      page.getByRole("button", { name: `Remove ${castaway.full_name}` }),
    ).toBeVisible();
  }

  // And it submits without re-entering anything.
  await page.getByRole("button", { name: "Submit my entry" }).click();
  await expect(dialog(page).getByText(`Enter the ${POOL_NAME}`)).toBeVisible(
    SLOW,
  );
  await registerThrough(page, {
    name: "Reload Entrant",
    email,
    password: PASSWORD,
  });

  await expect(page.getByRole("heading", { name: "Your entry" })).toBeVisible(
    SLOW,
  );

  const account = await findAccountByEmail(email, PASSWORD);
  await expect
    .poll(async () => (await readPoolEntry(account.localId)) !== undefined, {
      message: "no entry document after the reload path",
      timeout: 20_000,
    })
    .toBe(true);
  const entry = await readPoolEntry(account.localId);
  expect(entry?.handle).toBe("Reload Entrant");
  expect(entry?.picks).toEqual(picks);
  expect(Object.keys(entry?.prop_bets ?? {}).sort()).toEqual(
    [...PropBetQuestionKeys].sort(),
  );
});

// AE2 (R9, R10): the form is open when the freeze passes. The write is
// refused by the rules, the picks stay on screen, and one notice says the
// pool has closed. The refusal is real: `request.time` cannot be mocked, so
// the pool's stored freeze instant is genuinely in the past.
test("pool: a write refused after the freeze keeps the picks on screen and says so (AE2)", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  const freezeAt = passedFreeze();
  await seedPool(freezeAt);
  const user = await createUser(
    uniqueEmail("pool-frozen"),
    PASSWORD,
    "Frozen Entrant",
  );

  await page.goto("/");
  await mainNav(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(
    mainNav(page).getByRole("button", { name: "Logout" }),
  ).toBeVisible(SLOW);

  await holdTheFormOpenPastFreeze(page, freezeAt);
  await page.goto(`/pool/${POOL_SEASON_ID}`);

  // The client's own gate still believes the pool is open, which is exactly
  // the state an entrant with the form open sits in.
  await expect(page.getByRole("heading", { name: "Your picks" })).toBeVisible(
    SLOW,
  );
  const picks = poolPicks();
  await fillPoolEntry(page);
  await page.getByRole("button", { name: "Submit my entry" }).click();

  // The boundary refuses it, and the page says what happened to the entry
  // rather than only that something failed.
  await expect(
    page.getByText(
      "This pool closed before your entry reached us, so it was not saved.",
    ),
  ).toBeVisible(SLOW);
  await expect(page.getByText("Your picks are still on screen.")).toBeVisible();

  // And they are: every pick, the handle, and the answers are untouched.
  await expect(
    page.getByText(`${picks.length} of ${PICKS_PER_ENTRY} picks chosen`),
  ).toBeVisible();
  for (const castaway of picks) {
    await expect(
      page.getByRole("button", { name: `Remove ${castaway.full_name}` }),
    ).toBeVisible();
  }
  await expect(poolHandleField(page)).toHaveCount(0);
  // By combobox role, not by label: Mantine renders the question text as a
  // label element as well as the control's accessible name, so a label query
  // matches two nodes.
  await expect(
    page.getByRole("combobox", {
      name: PropBetsQuestions.propbet_winner.description,
    }),
  ).toHaveValue(PROP_BET_PICK.full_name);

  // Nothing was written.
  expect(await readPoolEntry(user.uid)).toBeUndefined();

  // The refusal is recorded before it is rendered, so it survives a reload
  // even though the write that caused it is long gone, and the autosaved
  // entry comes back with it.
  await page.reload();
  await expect(
    page.getByText(
      "This pool closed before your entry reached us, so it was not saved.",
    ),
  ).toBeVisible(SLOW);
  await expect(
    page.getByText(`${picks.length} of ${PICKS_PER_ENTRY} picks chosen`),
  ).toBeVisible();

  // Dismissal clears it: after the freeze there may be no write left that can
  // succeed, so nothing else would ever take the notice down.
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(
    page.getByText(
      "This pool closed before your entry reached us, so it was not saved.",
    ),
  ).toHaveCount(0);
});

// The entry stays read-only after the freeze, including its account username.
test("pool: after the freeze there is no handle form and a pick change is refused", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "desktop-only scenario");
  const freezeAt = passedFreeze();
  await seedPool(freezeAt);
  const user = await createUser(
    uniqueEmail("pool-handle"),
    PASSWORD,
    "Handle Entrant",
  );
  await seedPoolEntry(user.uid, "Handle Entrant");
  const seededPicks = POOL_ROSTER.slice(0, PICKS_PER_ENTRY);

  await page.goto("/");
  await mainNav(page)
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signInThrough(page, { email: user.email, password: PASSWORD });
  await expect(
    mainNav(page).getByRole("button", { name: "Logout" }),
  ).toBeVisible(SLOW);

  // With the real clock the page knows the pool is frozen: the entry is shown
  // with no edit, withdrawal, or separate handle control.
  await page.goto(`/pool/${POOL_SEASON_ID}`);
  await expect(page.getByRole("heading", { name: "Your entry" })).toBeVisible(
    SLOW,
  );
  await expect(
    page.getByRole("button", { name: "Change my entry" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Withdraw my entry" }),
  ).toHaveCount(0);

  await expect(poolHandleField(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save my handle" }),
  ).toHaveCount(0);

  // A stale browser clock cannot allow edits after the server freeze.
  await holdTheFormOpenPastFreeze(page, freezeAt);
  await page.goto(`/pool/${POOL_SEASON_ID}`);
  await expect(
    page.getByRole("button", { name: "Change my entry" }),
  ).toBeVisible(SLOW);
  await page.getByRole("button", { name: "Change my entry" }).click();

  const dropped = seededPicks[0];
  const added = POOL_ROSTER[PICKS_PER_ENTRY];
  await page
    .getByRole("button", { name: `Remove ${dropped.full_name}` })
    .click();
  await page.getByRole("button", { name: `Pick ${added.full_name}` }).click();
  await page.getByRole("button", { name: "Save my changes" }).click();

  await expect(
    page.getByText(
      "This pool closed before your changes reached us, so your entry is unchanged.",
    ),
  ).toBeVisible(SLOW);

  const afterEdit = await readPoolEntry(user.uid);
  expect(afterEdit?.picks).toEqual(seededPicks);
  expect(afterEdit?.handle).toBe("Handle Entrant");
});
