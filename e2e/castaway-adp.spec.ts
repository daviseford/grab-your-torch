/**
 * Castaway average draft position (ADP) on the live draft, end to end.
 *
 * Two real users register, join, and draft a whole season against the local
 * Firebase emulators under the inert `demo-auth-flows` project. Published
 * summaries for both cohorts are seeded with the Admin SDK (the only writer
 * the rules allow), and the test checks, on desktop and mobile in light and
 * dark:
 *
 * - the spoiler-safe pre-premiere cohort is the default and is labeled;
 * - castaways below the 10-draft / 5-creator threshold show no number;
 * - nothing from the all-drafts cohort is on the page until the viewer
 *   confirms the spoiler warning, and a reload starts back at the default;
 * - the ADP tags add no tab stops between Draft slates;
 * - malformed summaries degrade to truthful empty states, never a crash;
 * - the admin job, run against the draft the two users just made, finds it
 *   through the real Firestore, Realtime Database, and Auth records.
 *
 *   yarn e2e:auth-flows castaway-adp
 *
 * Emulator hosts come from `firebase emulators:exec`, so a local config may
 * move the ports (see playwright.auth-flows.config.ts). Set CASTAWAY_ADP_SHOTS
 * to choose the screenshot folder (default: e2e/screenshots/castaway-adp).
 */

import { expect, test, type Page } from "@playwright/test";
import admin from "firebase-admin";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  loadAccounts,
  loadCompetitions,
  type AccountReader,
  type CompetitionReader,
  type DraftReader,
} from "../scripts/recompute-castaway-adp";
import type { CastawayId } from "../src/types";
import { castawayAdpDocId, planCastawayAdp } from "../src/utils/castawayAdp";

// ---------------------------------------------------------------------------
// Emulator endpoints, from the emulators:exec environment
// ---------------------------------------------------------------------------

const PROJECT = "demo-auth-flows";
const RTDB_NS = "demo-auth-flows-default-rtdb";
const local = /^(127\.0\.0\.1|localhost):\d+$/;
const hosts = {
  firestore: process.env.FIRESTORE_EMULATOR_HOST ?? "",
  auth: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "",
  database: process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? "",
};
if (!Object.values(hosts).every((host) => local.test(host))) {
  throw new Error(
    "e2e/castaway-adp.spec.ts must run via `firebase emulators:exec --only auth,firestore,database` so all Firebase traffic stays on local emulators.",
  );
}
const AUTH_EMU = `http://${hosts.auth}`;
const FIRESTORE_EMU = `http://${hosts.firestore}`;
const RTDB_EMU = `http://${hosts.database}`;

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: PROJECT,
    databaseURL: `https://${RTDB_NS}.firebaseio.com`,
  });
}
const adminDb = admin.firestore();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEASON_ID = "season_1";
const SEASON_ORDER = 1;
const SEASON_NAME = "Test Season One";
const CAST_SIZE = 8;
const SEASON_PLAYERS = Array.from({ length: CAST_SIZE }, (_, i) => {
  const n = i + 1;
  return {
    season_id: SEASON_ID,
    season_num: SEASON_ORDER,
    castaway_id: `US99${String(n).padStart(2, "0")}` as CastawayId,
    full_name: `Test Player ${n}`,
    img: "",
    age: 20 + n,
    hometown: `Town ${n}`,
  };
});
const id = (n: number) => SEASON_PLAYERS[n - 1].castaway_id;

/** Pre-premiere: players 1-4 cleared the thresholds; 5-8 did not. */
const PRE_SUMMARY = {
  season_id: SEASON_ID,
  season_num: SEASON_ORDER,
  cohort: "pre_premiere",
  draft_count: 14,
  sealed_count: 12,
  min_drafts: 10,
  min_creators: 5,
  // In the past, so the premiere has aired and the opt-in is offered.
  premiere_cutoff: "2026-02-26T00:00:00.000Z",
  computed_at: "2026-02-26T01:00:00.000Z",
  castaways: {
    [id(1)]: { adp: 2.5, picks: 12 },
    [id(2)]: { adp: 1.25, picks: 14 },
    [id(3)]: { adp: 5.75, picks: 11 },
    [id(4)]: { adp: 3.4, picks: 13 },
  },
};

/** All drafts: numbers the viewer must never see before opting in. */
const ALL_SUMMARY = {
  season_id: SEASON_ID,
  season_num: SEASON_ORDER,
  cohort: "all_drafts",
  draft_count: 31,
  sealed_count: null,
  min_drafts: 10,
  min_creators: 5,
  premiere_cutoff: null,
  computed_at: "2026-03-10T12:00:00.000Z",
  castaways: {
    [id(8)]: { adp: 1.1, picks: 30 },
    [id(2)]: { adp: 6.9, picks: 25 },
  },
};

const PASSWORD = "correct-horse-7";
let userCounter = 0;
const uniqueEmail = (label: string) =>
  `e2e-adp-${label}-${Date.now()}-${userCounter++}@example.com`;

const SHOTS_DIR =
  process.env.CASTAWAY_ADP_SHOTS ??
  path.join(process.cwd(), "e2e", "screenshots", "castaway-adp");

// ---------------------------------------------------------------------------
// Emulator helpers
// ---------------------------------------------------------------------------

const wipeEmulators = async () => {
  const results = await Promise.all([
    fetch(`${AUTH_EMU}/emulator/v1/projects/${PROJECT}/accounts`, {
      method: "DELETE",
    }),
    fetch(
      `${FIRESTORE_EMU}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
      { method: "DELETE" },
    ),
    fetch(`${RTDB_EMU}/.json?ns=${RTDB_NS}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer owner",
      },
      body: "null",
    }),
  ]);
  for (const res of results) {
    if (!res.ok) throw new Error(`emulator wipe failed: ${res.status}`);
  }
};

const seedSeason = () =>
  adminDb.doc(`seasons/${SEASON_ID}`).set({
    id: SEASON_ID,
    order: SEASON_ORDER,
    name: SEASON_NAME,
    img: "",
    players: SEASON_PLAYERS,
    episodes: [],
    castawayLookup: Object.fromEntries(
      SEASON_PLAYERS.map((p) => [
        p.castaway_id,
        { full_name: p.full_name, castaway: p.full_name },
      ]),
    ),
  });

const summaryDoc = (cohort: "pre_premiere" | "all_drafts") =>
  adminDb.doc(`castaway_adp/${castawayAdpDocId(SEASON_ID, cohort)}`);

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
let productionViolations: string[] = [];

/**
 * Records, rather than routes, every request: a Playwright route on the
 * context holds WebKit's streaming Firestore listen channel until it closes,
 * which stalls any listener added after the first load (here, the all-drafts
 * summary after the opt-in). The app itself refuses to start in this mode
 * against a non-demo project (src/firebase.ts), and afterEach still fails the
 * test on any production-bound request.
 */
const guardContext = (
  context: Page["context"] extends () => infer C ? C : never,
) => {
  context.on("request", (request) => {
    const { hostname } = new URL(request.url());
    const prod =
      hostname !== "127.0.0.1" &&
      hostname !== "localhost" &&
      PROD_HOST_SUFFIXES.some(
        (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
      );
    if (prod) productionViolations.push(request.url());
  });
};

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

const SLOW = { timeout: 30_000 };
const dialog = (page: Page) => page.getByRole("dialog");
const main = (page: Page) => page.getByRole("main");

const registerThrough = async (
  page: Page,
  user: { name: string; email: string },
) => {
  await dialog(page).getByLabel("Display Name").fill(user.name);
  await dialog(page).getByLabel("Email").fill(user.email);
  await dialog(page).getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await dialog(page).getByRole("button", { name: "Create account" }).click();
};

const pageErrors = new Map<Page, string[]>();
// A reload aborts Firestore's in-flight channel requests, which WebKit
// reports as a pageerror ending "due to access control checks" (see
// e2e/redesign-draft.spec.ts). Only that message is dropped.
const firestoreChannelAbort =
  /\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/;
const trackErrors = (page: Page) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (err) => {
    if (!firestoreChannelAbort.test(err.message)) errors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon|ERR_ABORTED|net::/.test(msg.text()))
      errors.push(msg.text());
  });
};

/** The ADP line on one castaway's slate, by its visible text. */
const slate = (page: Page, n: number) =>
  page.getByRole("listitem").filter({
    has: page.getByRole("button", { name: `Draft Test Player ${n}` }),
  });

const capture = async (page: Page, name: string) => {
  const label = test.info().project.name.includes("mobile")
    ? "mobile"
    : "desktop";
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOTS_DIR, `${name}-${label}-${scheme}.png`),
      fullPage: true,
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect
    .soft(overflow, `${name}: no horizontal overflow`)
    .toBeLessThanOrEqual(0);
};

/** Text of everything on the page a sighted or screen-reader user gets. */
const pageText = (page: Page) =>
  page.evaluate(() => document.body.textContent ?? "");

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.beforeEach(async ({ context }) => {
  productionViolations = [];
  guardContext(context);
  await wipeEmulators();
  mkdirSync(SHOTS_DIR, { recursive: true });
});

test.afterEach(async () => {
  expect(productionViolations).toEqual([]);
});

test.afterAll(async () => {
  await wipeEmulators();
});

test("two users draft with ADP: default cohort, thresholds, opt-in, and the real job", async ({
  page,
  browser,
  isMobile,
}) => {
  test.setTimeout(900_000);
  const viewport = isMobile
    ? { width: 375, height: 812 }
    : { width: 1280, height: 800 };
  await page.setViewportSize(viewport);
  // WebKit against the local emulators delivers a listener added after the
  // first load, and server-pushed changes, only when its long poll cycles:
  // tens of seconds rather than one. Chromium is immediate.
  const live = { timeout: isMobile ? 150_000 : 30_000 };
  trackErrors(page);
  await seedSeason();
  await summaryDoc("pre_premiere").set(PRE_SUMMARY);
  await summaryDoc("all_drafts").set(ALL_SUMMARY);

  // ---- Host registers and opens a lobby; a guest joins through the link ----
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await registerThrough(page, { name: "Ada Host", email: uniqueEmail("host") });
  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );
  const draftUrl = page.url();

  const guestContext = await browser.newContext({
    ...test.info().project.use,
    viewport,
  });
  guardContext(guestContext);
  const guest = await guestContext.newPage();
  trackErrors(guest);
  await guest.goto(draftUrl);
  await main(guest)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await registerThrough(guest, {
    name: "Bo Guest",
    email: uniqueEmail("guest"),
  });
  await expect(page.getByText("2 joined")).toBeVisible(live);

  await page.getByRole("button", { name: "Start Draft" }).click();
  const turnHeading = (p: Page) =>
    p.getByRole("heading", { name: /Your turn to pick!|is picking\.\.\./ });
  await expect(turnHeading(page)).toBeVisible({ timeout: 40_000 });
  await expect(turnHeading(guest)).toBeVisible({ timeout: 40_000 });

  // ---- Default: pre-premiere, labeled, with thresholds honoured ----
  await expect(
    page.getByText(
      "ADP: average overall pick across 14 drafts saved before the premiere.",
    ),
  ).toBeVisible(SLOW);
  await expect(slate(page, 2)).toContainText("ADP1.3in 14 of 14");
  await expect(slate(page, 1)).toContainText("ADP2.5in 12 of 14");
  await expect(slate(page, 5)).toContainText("ADP—too few picks");
  // Screen readers get the full sentence in place, with the denominator.
  await expect(slate(page, 1)).toContainText(
    "Test Player 1: average draft position 2.5 across drafts saved before the premiere. Picked in 12 of 14 drafts.",
  );
  await expect(slate(page, 5)).toContainText(
    "It needs picks in at least 10 drafts made by 5 different people.",
  );
  // Nothing from the all-drafts cohort has reached the page.
  const before = await pageText(page);
  expect(before).not.toContain("All ADP");
  expect(before).not.toContain("1.1");
  expect(before).not.toContain("6.9");
  expect(before).not.toContain("31 drafts");

  await page
    .getByRole("button", { name: "How average draft position works" })
    .click();
  await expect(
    page.getByText(
      "that were saved as a competition before the premiere aired",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("2 of those records were edited after the premiere"),
  ).toBeVisible();
  await capture(page, "pre-premiere-explainer");
  await page.keyboard.press("Escape");

  // ---- Sort follows the active cohort ----
  await page.getByText("By ADP").click();
  await expect(
    page.getByRole("button", { name: /^Draft Test Player/ }).first(),
  ).toHaveAccessibleName("Draft Test Player 2");
  await capture(page, "pre-premiere-sorted");

  // ---- Keyboard: no tab stop between one slate's controls and the next ----
  if (!isMobile) {
    await slate(page, 2)
      .getByRole("button", { name: /Test Player 2/ })
      .first()
      .focus();
    // Tab walks slate controls (the Draft slates are disabled off-turn, so
    // it moves on past the grid); no stop may be an ADP tag or inside one.
    const stops: { tag: string; inAdp: boolean }[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return {
            tag: el?.tagName ?? "",
            inAdp: !!el?.closest("[data-cohort]"),
          };
        }),
      );
    }
    for (const stop of stops) {
      expect(stop.inAdp).toBe(false);
      expect(["BUTTON", "A", "INPUT", "SUMMARY"]).toContain(stop.tag);
    }
    expect(
      await page
        .locator("[data-cohort]")
        .evaluateAll(
          (els) => els.filter((el) => (el as HTMLElement).tabIndex >= 0).length,
        ),
    ).toBe(0);
  }

  // ---- The opt-in: warning first, cancel keeps the default ----
  await page
    .getByRole("button", { name: "Include drafts made after the premiere…" })
    .click();
  const warning = page.getByRole("group", { name: /Spoiler warning/ });
  await expect(warning).toBeVisible();
  const confirm = warning.getByRole("button", { name: "Show all-drafts ADP" });
  await expect(confirm).toBeFocused();
  expect(await pageText(page)).not.toContain("All ADP");
  await capture(page, "opt-in-warning");
  await warning.getByRole("button", { name: "Cancel" }).click();
  await expect(warning).toHaveCount(0);
  await expect(slate(page, 2)).toContainText("ADP1.3");

  // ---- Confirm: all-drafts numbers, labeled everywhere they appear ----
  await page
    .getByRole("button", { name: "Include drafts made after the premiere…" })
    .click();
  await page.getByRole("button", { name: "Show all-drafts ADP" }).click();
  await expect(
    page.getByText(
      "Showing all drafts, including ones made after episodes aired.",
    ),
  ).toBeVisible(SLOW);
  await expect(
    page.getByText(
      "All-drafts ADP: average overall pick across 31 drafts of every kind, including after episodes aired.",
    ),
  ).toBeVisible(live);
  await expect(slate(page, 8)).toContainText("All ADP1.1in 30 of 31", live);
  await expect(slate(page, 1)).toContainText("All ADP—too few picks");
  await expect(
    page.getByRole("button", { name: /^Draft Test Player/ }).first(),
  ).toHaveAccessibleName("Draft Test Player 8");
  await capture(page, "all-drafts");

  // The guest never opted in and still sees only the default.
  expect(await pageText(guest)).not.toContain("All ADP");
  await expect(slate(guest, 2)).toContainText("ADP1.3");

  // Back to the default without a reload.
  await page.getByRole("button", { name: "Back to pre-premiere only" }).click();
  await expect(slate(page, 2)).toContainText("ADP1.3");
  expect(await pageText(page)).not.toContain("All ADP");

  // Opt in again, then reload: the choice is not remembered.
  await page
    .getByRole("button", { name: "Include drafts made after the premiere…" })
    .click();
  await page.getByRole("button", { name: "Show all-drafts ADP" }).click();
  await expect(slate(page, 8)).toContainText("All ADP1.1", live);
  await page.reload();
  await expect(turnHeading(page)).toBeVisible(SLOW);
  await expect(slate(page, 2)).toContainText("ADP1.3", SLOW);
  expect(await pageText(page)).not.toContain("All ADP");

  // ---- Malformed summaries degrade to truthful states, never a crash ----
  await summaryDoc("pre_premiere").set({
    ...PRE_SUMMARY,
    castaways: {
      [id(1)]: { adp: "3", picks: 12 },
      [id(2)]: { adp: Number.NaN, picks: 14 },
      [id(3)]: { adp: 5.75 },
      [id(4)]: { adp: 3.4, picks: 13 },
    },
  });
  await expect(slate(page, 1)).toContainText("ADP—too few picks", live);
  await expect(slate(page, 4)).toContainText("ADP3.4in 13 of 14");
  await summaryDoc("pre_premiere").set({ ...PRE_SUMMARY, draft_count: "14" });
  await expect(
    page.getByText("Average draft position isn't available for this season."),
  ).toBeVisible(live);
  await expect(page.locator("[data-cohort]")).toHaveCount(0);
  await summaryDoc("pre_premiere").set({ ...PRE_SUMMARY, castaways: {} });
  await expect(
    page.getByText(
      "No average draft position for this season: 14 drafts were saved before the premiere, and no castaway had picks in at least 10 drafts made by 5 different people.",
    ),
  ).toBeVisible(live);
  await capture(page, "pre-premiere-closed-empty");
  await summaryDoc("pre_premiere").set(PRE_SUMMARY);

  // ---- Finish the draft through the UI ----
  const pickerOf = async () =>
    (await page
      .getByRole("heading", { name: "Your turn to pick!" })
      .isVisible())
      ? page
      : guest;
  for (let pick = 1; pick <= CAST_SIZE; pick++) {
    const picker = await pickerOf();
    await expect(picker.getByText(`Pick ${pick} of ${CAST_SIZE}`)).toBeVisible(
      SLOW,
    );
    await picker
      .getByRole("button", { name: /^Draft Test Player/, disabled: false })
      .first()
      .click();
    if (pick < CAST_SIZE) {
      await expect(
        page.getByText(`Pick ${pick + 1} of ${CAST_SIZE}`),
      ).toBeVisible(SLOW);
    }
  }

  // Prop bets, then the host saves the competition.
  for (const [p, n] of [
    [page, 1],
    [guest, 2],
  ] as const) {
    await expect(
      p.getByRole("heading", { name: "Place Your Bets" }),
    ).toBeVisible(SLOW);
    for (const label of [
      "Season winner",
      "One FTC finalist",
      "First eliminated",
      "Most post-merge individual immunity wins",
      "Most idol finds",
      "First idol found",
      "First successful idol play",
      "Who will win the most reward challenges after the merge?",
    ]) {
      await p.getByLabel(label, { exact: false }).first().click();
      await p
        .getByRole("option", { name: `Test Player ${n}`, exact: true })
        .click();
    }
    for (const label of [
      "Will there be a medical evacuation?",
      "Will anyone successfully play Shot in the Dark?",
      "Will there be a quit?",
    ]) {
      await p.getByLabel(label, { exact: false }).first().click();
      await p.getByRole("option", { name: "Yes", exact: true }).click();
    }
    await p.getByRole("button", { name: "Submit Prop Bets" }).click();
  }
  await page.getByLabel("Competition name").fill("ADP League");
  await page.getByRole("button", { name: "Create Competition" }).click();
  await expect(
    page.getByRole("button", { name: "Go to your competition" }),
  ).toBeVisible({ timeout: 60_000 });

  // ---- The admin job finds the real draft through every source ----
  // The page can report the competition before the write reaches the server.
  await expect
    .poll(
      async () => (await adminDb.collection("competitions").get()).size,
      SLOW,
    )
    .toBe(1);
  const competitions = await loadCompetitions(
    adminDb as unknown as CompetitionReader,
    admin.database() as unknown as DraftReader,
    [SEASON_ID],
  );
  const accounts = await loadAccounts(
    admin.auth() as unknown as AccountReader,
    competitions,
  );
  expect(competitions).toHaveLength(1);
  expect(accounts.size).toBe(2);
  const base = {
    seasonId: SEASON_ID,
    seasonNum: SEASON_ORDER,
    castawayIds: SEASON_PLAYERS.map((p) => p.castaway_id),
    competitions,
    accounts,
    computedAt: new Date().toISOString(),
  } as const;

  // Premiere not yet aired: the draft counts for both cohorts, unchanged
  // since it was saved.
  const pre = planCastawayAdp({
    ...base,
    cohort: "pre_premiere",
    premiereAirDate: "2099-01-01",
  });
  expect(pre.summary.draft_count).toBe(1);
  expect(pre.summary.sealed_count).toBe(1);
  expect(Object.values(pre.excluded).every((count) => count === 0)).toBe(true);
  // One draft is far below 10 drafts from 5 creators: nothing published.
  expect(pre.published).toBe(false);
  expect(pre.summary.castaways).toEqual({});

  // With the threshold lowered, the averages are the picks just made: every
  // castaway went at exactly its overall pick number.
  const all = planCastawayAdp({
    ...base,
    cohort: "all_drafts",
    premiereAirDate: null,
    minDrafts: 1,
    minCreators: 1,
  });
  const picks = competitions[0].data.draft_picks as {
    order: number;
    castaway_id: CastawayId;
  }[];
  expect(picks).toHaveLength(CAST_SIZE);
  for (const pick of picks) {
    expect(all.summary.castaways[pick.castaway_id]).toEqual({
      adp: pick.order,
      picks: 1,
    });
  }

  // Saved after the premiere: excluded from pre-premiere only.
  const late = planCastawayAdp({
    ...base,
    cohort: "pre_premiere",
    premiereAirDate: "2020-01-01",
  });
  expect(late.summary.draft_count).toBe(0);
  expect(late.excluded.after_premiere).toBe(1);

  for (const [p, errors] of pageErrors) {
    expect.soft(errors, `${p === page ? "host" : "guest"} errors`).toEqual([]);
  }
  await guestContext.close();
});
