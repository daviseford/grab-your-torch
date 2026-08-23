/**
 * Redesign capture and smoke test for the draft surface (lobby, order
 * reveal, live board, prop bets, summary). Two real users drive a real
 * draft end to end against the local Firebase emulators under the inert
 * `demo-auth-flows` project, exactly like e2e/auth-flows.spec.ts:
 *
 *   yarn firebase emulators:exec --only auth,firestore,database \
 *     --project demo-auth-flows \
 *     "playwright test --config playwright.auth-flows.config.ts redesign-draft"
 *
 * Every state is captured in light and dark at the project's viewport
 * (1280x800 desktop, 375x812 mobile) and checked for document overflow, a
 * single h1, broken images, and console errors. Set REDESIGN_DRAFT_SHOTS to
 * choose the output folder (default: e2e/screenshots/redesign-draft).
 */

import { expect, test, type Page } from "@playwright/test";
import admin from "firebase-admin";
import { mkdirSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Emulator endpoints (ports pinned in firebase.json)
// ---------------------------------------------------------------------------

const PROJECT = "demo-auth-flows";
const AUTH_EMU = "http://127.0.0.1:9099";
const FIRESTORE_EMU = "http://127.0.0.1:8080";
const RTDB_EMU = "http://127.0.0.1:9000";
const RTDB_NS = "demo-auth-flows-default-rtdb";

const firestoreEmuHost = process.env.FIRESTORE_EMULATOR_HOST;
if (
  !firestoreEmuHost ||
  !/^(127\.0\.0\.1|localhost):\d+$/.test(firestoreEmuHost)
) {
  throw new Error(
    "e2e/redesign-draft.spec.ts must run via `firebase emulators:exec` so all Firebase traffic stays on local emulators.",
  );
}

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
const CAST_SIZE = 8;
const SEASON_PLAYERS = Array.from({ length: CAST_SIZE }, (_, i) => {
  const n = i + 1;
  return {
    season_id: SEASON_ID,
    season_num: SEASON_ORDER,
    castaway_id: `US99${String(n).padStart(2, "0")}`,
    full_name: `Test Player ${n}`,
    img: "",
    age: 20 + n,
    hometown: `Town ${n}`,
  };
});

const PASSWORD = "correct-horse-7";
const uniqueEmail = (label: string) => `e2e-${label}-${Date.now()}@example.com`;

const SHOTS_DIR =
  process.env.REDESIGN_DRAFT_SHOTS ??
  path.join(process.cwd(), "e2e", "screenshots", "redesign-draft");

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
const rtdbUrl = (p: string) => `${RTDB_EMU}/${p}.json?ns=${RTDB_NS}`;

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

const seedSeason = async () => {
  await adminDb.doc(`seasons/${SEASON_ID}`).set({
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

const isProductionHost = (hostname: string): boolean => {
  if (hostname === "127.0.0.1" || hostname === "localhost") return false;
  return PROD_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
};

let productionViolations: string[] = [];

const guardContext = async (
  context: Page["context"] extends () => infer C ? C : never,
) => {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (isProductionHost(url.hostname)) {
      productionViolations.push(route.request().url());
      return route.abort();
    }
    return route.continue();
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
  user: { name: string; email: string; password: string },
) => {
  await dialog(page).getByLabel("Display Name").fill(user.name);
  await dialog(page).getByLabel("Email").fill(user.email);
  await dialog(page)
    .getByRole("textbox", { name: "Password" })
    .fill(user.password);
  await dialog(page).getByRole("button", { name: "Create account" }).click();
};

type Health = {
  h1Count: number;
  scrollWidth: number;
  innerWidth: number;
  brokenImages: number;
  /** Elements whose right edge crosses the viewport (diagnostic). */
  overflowers: string[];
};

const readHealth = (page: Page) =>
  page.evaluate<Health>(() => ({
    h1Count: document.querySelectorAll("h1").length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    brokenImages: Array.from(document.images).filter(
      (img) => img.complete && img.naturalWidth === 0 && img.src !== "",
    ).length,
    overflowers: Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(r.right)} w=${Math.round(r.width)}`;
      }),
  }));

const consoleErrors = new Map<Page, string[]>();
const trackConsole = (page: Page) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
};

let shotDir = SHOTS_DIR;

const capture = async (
  page: Page,
  name: string,
  opts: { fullPage?: boolean; checkOverflow?: boolean } = {},
) => {
  const { fullPage = false, checkOverflow = true } = opts;
  // Playwright scrolls to click Draft slates; every capture starts at the top.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.getElementById("main-content")?.scrollTo(0, 0);
  });
  const label = test.info().project.name.includes("mobile")
    ? "mobile"
    : "desktop";
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(shotDir, `${name}-${label}-${scheme}.png`),
      fullPage,
    });
    if (fullPage) {
      await page.screenshot({
        path: path.join(shotDir, `${name}-${label}-${scheme}-viewport.png`),
        fullPage: false,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });

  const health = await readHealth(page);
  expect.soft(health.h1Count, `${name}: exactly one h1`).toBe(1);
  if (checkOverflow) {
    expect
      .soft(
        health.scrollWidth,
        `${name}: no document overflow (${health.overflowers.join(" | ")})`,
      )
      .toBeLessThanOrEqual(health.innerWidth);
  }
  expect.soft(health.brokenImages, `${name}: no broken images`).toBe(0);
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.beforeEach(async ({ context }) => {
  productionViolations = [];
  await guardContext(context);
  await wipeEmulators();
  shotDir = SHOTS_DIR;
  mkdirSync(shotDir, { recursive: true });
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

test("two users draft a season end to end on the board spine", async ({
  page,
  browser,
  isMobile,
}) => {
  test.setTimeout(480_000);
  await page.setViewportSize(
    isMobile ? { width: 375, height: 812 } : { width: 1280, height: 800 },
  );
  trackConsole(page);
  await seedSeason();

  // ---- Host registers from the season page and lands in the lobby ----
  const hostEmail = uniqueEmail("host");
  await page.goto(`/seasons/${SEASON_ID}`);
  await main(page)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await registerThrough(page, {
    name: "Ada Host",
    email: hostEmail,
    password: PASSWORD,
  });
  await expect(page).toHaveURL(
    new RegExp(`/seasons/${SEASON_ID}/draft/draft_`),
    SLOW,
  );
  await expect(page.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );
  await expect(page.getByText("1 joined")).toBeVisible(SLOW);
  await expect(
    page.getByRole("button", { name: "Waiting for players..." }),
  ).toBeDisabled();
  const draftUrl = page.url();
  await capture(page, "lobby-host-alone", { fullPage: true });

  // ---- A friend opens the invite signed out, then registers and joins ----
  const guestContext = await browser.newContext({
    ...test.info().project.use,
    viewport: isMobile
      ? { width: 375, height: 812 }
      : { width: 1280, height: 800 },
  });
  await guardContext(guestContext);
  const guest = await guestContext.newPage();
  trackConsole(guest);
  await guest.goto(draftUrl);
  await expect(
    guest.getByRole("heading", { name: "You're invited to this draft!" }),
  ).toBeVisible(SLOW);
  await capture(guest, "invite-signed-out");

  await main(guest)
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    dialog(guest).getByText(`Join the ${SEASON_NAME} draft`),
  ).toBeVisible();
  await registerThrough(guest, {
    name: "Bo Guest",
    email: uniqueEmail("guest"),
    password: PASSWORD,
  });
  await expect(guest.getByRole("heading", { name: "Draft Lobby" })).toBeVisible(
    SLOW,
  );
  await expect(guest.getByText("2 joined")).toBeVisible(SLOW);
  await expect(
    guest.getByRole("button", { name: "Waiting for host to start..." }),
  ).toBeDisabled();
  await capture(guest, "lobby-guest", { fullPage: true });

  await expect(page.getByText("2 joined")).toBeVisible(SLOW);
  await expect(page.getByRole("button", { name: "Start Draft" })).toBeEnabled(
    SLOW,
  );
  await capture(page, "lobby-host", { fullPage: true });

  // ---- The host starts the draft: order reveal, then the live board ----
  // The host clicks Start Draft. This is the write that database.rules.json
  // used to reject (startDraft re-wrote `state/finished: false`), so starting
  // through the UI is deliberately part of this walk.
  await page.getByRole("button", { name: "Start Draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Shuffling draft order..." }),
  ).toBeVisible(SLOW);
  await capture(page, "reveal", { checkOverflow: true });
  await expect(
    guest.getByRole("heading", { name: "Shuffling draft order..." }),
  ).toBeVisible(SLOW);

  const turnHeading = (p: Page) =>
    p.getByRole("heading", { name: /Your turn to pick!|is picking\.\.\./ });
  await expect(turnHeading(page)).toBeVisible({ timeout: 40_000 });
  await expect(turnHeading(guest)).toBeVisible({ timeout: 40_000 });

  const pickerOf = async (): Promise<{ picker: Page; watcher: Page }> => {
    const hostTurn = await page
      .getByRole("heading", { name: "Your turn to pick!" })
      .isVisible();
    return hostTurn
      ? { picker: page, watcher: guest }
      : { picker: guest, watcher: page };
  };

  for (let pick = 1; pick <= CAST_SIZE; pick++) {
    const { picker, watcher } = await pickerOf();
    await expect(picker.getByText(`Pick ${pick} of ${CAST_SIZE}`)).toBeVisible(
      SLOW,
    );
    await expect(
      watcher.getByRole("heading", { name: /is picking\.\.\./ }),
    ).toBeVisible(SLOW);
    await expect(picker.getByRole("cell", { name: "Your pick" })).toBeVisible();
    // Out of turn, every Draft slate is disabled.
    await expect(
      watcher.getByRole("button", { name: /^Draft Test Player/ }).first(),
    ).toBeDisabled();

    if (pick === 4) {
      await capture(picker, "active-your-turn", { fullPage: true });
      await capture(watcher, "active-waiting", { fullPage: true });
    }

    await picker
      .getByRole("button", { name: /^Draft Test Player/, disabled: false })
      .first()
      .click();

    if (pick < CAST_SIZE) {
      await expect(
        page.getByText(`Pick ${pick + 1} of ${CAST_SIZE}`),
      ).toBeVisible(SLOW);
      await expect(
        guest.getByText(`Pick ${pick + 1} of ${CAST_SIZE}`),
      ).toBeVisible(SLOW);
    }
  }

  // ---- Prop bets ----
  for (const p of [page, guest]) {
    await expect(
      p.getByRole("heading", { name: "Place Your Bets" }),
    ).toBeVisible(SLOW);
  }
  await capture(page, "prop-bets", { fullPage: true });

  // Submitting with nothing answered surfaces validation and stays put.
  await page.getByRole("button", { name: "Submit Prop Bets" }).click();
  await expect(page.getByText("Enter an answer").first()).toBeVisible();
  await capture(page, "prop-bets-invalid");

  const QUESTIONS: Array<{ label: string; boolean?: boolean }> = [
    { label: "Season winner" },
    { label: "One FTC finalist" },
    { label: "First eliminated" },
    { label: "Most post-merge individual immunity wins" },
    { label: "Most idol finds" },
    { label: "Will there be a medical evacuation?", boolean: true },
    { label: "First idol found" },
    { label: "First successful idol play" },
    {
      label: "Will anyone successfully play Shot in the Dark?",
      boolean: true,
    },
    { label: "Who will win the most reward challenges after the merge?" },
    { label: "Will there be a quit?", boolean: true },
  ];

  const fillPropBets = async (p: Page, playerIndex: number) => {
    for (const q of QUESTIONS) {
      await p.getByLabel(q.label, { exact: false }).first().click();
      const option = q.boolean ? "Yes" : `Test Player ${playerIndex}`;
      await p.getByRole("option", { name: option, exact: true }).click();
    }
    await p.getByRole("button", { name: "Submit Prop Bets" }).click();
  };

  await fillPropBets(page, 1);
  await expect(
    page.getByRole("heading", { level: 1, name: "Draft Results" }),
  ).toBeVisible(SLOW);
  await expect(
    page.getByText(`Waiting for prop bets: 1 of 2 submitted`),
  ).toBeVisible(SLOW);
  await capture(page, "summary-waiting", { fullPage: true });

  await fillPropBets(guest, 2);
  await expect(
    guest.getByRole("heading", { level: 1, name: "Draft Results" }),
  ).toBeVisible(SLOW);

  // ---- The host names the competition; both users can go to it ----
  await expect(
    page.getByRole("heading", {
      name: "What should we call your Competition?",
    }),
  ).toBeVisible(SLOW);
  await capture(page, "summary-name-competition", { checkOverflow: false });
  await page.getByLabel("Competition name").fill("Board Spine League");
  await page.getByRole("button", { name: "Create Competition" }).click();

  for (const p of [page, guest]) {
    await expect(p.getByRole("button", { name: "Go to your competition" }))
      .toBeVisible({ timeout: 60_000 })
      .catch(async (error: unknown) => {
        await p.screenshot({
          path: path.join(shotDir, "debug-missing-go-to-competition.png"),
          fullPage: true,
        });
        throw error;
      });
  }
  await capture(page, "summary-host", { fullPage: true });
  await capture(guest, "summary-guest", { fullPage: true });

  // Console errors introduced by the page itself would show up here.
  const noise = /favicon|ERR_ABORTED|ERR_FAILED|net::/;
  for (const [p, errors] of consoleErrors) {
    const real = errors.filter((e) => !noise.test(e));
    expect.soft(real, `${p === page ? "host" : "guest"} console`).toEqual([]);
  }

  await guestContext.close();
});
