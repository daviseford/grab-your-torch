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
import { mkdirSync, writeFileSync } from "node:fs";
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
// A reload aborts Firestore's in-flight WebChannel requests. Chromium logs
// that as net::ERR_ABORTED (filtered at the end of the test); WebKit raises
// it as a pageerror ending "due to access control checks". Drop only that
// message, and only while the page is reloading, so real errors still fail.
const reloading = new Set<Page>();
const firestoreChannelAbort =
  /\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel\?.* due to access control checks\.$/;
const reloadPage = async (page: Page) => {
  reloading.add(page);
  try {
    await page.reload();
  } finally {
    reloading.delete(page);
  }
};
const trackConsole = (page: Page) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  const record = (text: string) => {
    if (reloading.has(page) && firestoreChannelAbort.test(text)) return;
    errors.push(text);
  };
  page.on("console", (msg) => {
    if (msg.type() === "error") record(msg.text());
  });
  page.on("pageerror", (err) => record(`pageerror: ${err.message}`));
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
// Browser probes (installed with addInitScript before the first goto)
// ---------------------------------------------------------------------------

type ProbeWindow = {
  /** Vibrate patterns the page tried to fire. */
  __vib: (number | number[])[];
  /** Computed pointer-events of every edge-glow element that ever mounted. */
  __edges: string[];
};

/** Records vibrations and edge-glow mounts; pins reloads to the top. */
const installProbes = (withVibrate: boolean) => {
  // Manual restoration: after a reload the page starts at the top, so any
  // scroll afterwards can only come from the app.
  history.scrollRestoration = "manual";
  const w = window as unknown as ProbeWindow;
  w.__vib = [];
  w.__edges = [];
  if (withVibrate) {
    navigator.vibrate = (pattern) => (w.__vib.push(pattern), true);
  } else {
    // Simulate iOS Safari: no vibration API at all.
    (navigator as unknown as { vibrate?: unknown }).vibrate = undefined;
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const edge = node.matches("[data-turn-edge]")
          ? node
          : node.querySelector("[data-turn-edge]");
        if (edge) w.__edges.push(getComputedStyle(edge).pointerEvents);
      }
    }
  }).observe(document, { childList: true, subtree: true });
};

// Window is a host object whose expando properties do not survive
// evaluate() serialization, so project the probes into a plain object.
const probes = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Partial<ProbeWindow>;
    return { __vib: w.__vib ?? [], __edges: w.__edges ?? [] };
  });

// ---------------------------------------------------------------------------
// Draft Results colors
// ---------------------------------------------------------------------------

const parseRgb = (value: string) => {
  const [r, g, b] = (value.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return [r, g, b];
};

const luminance = (value: string) => {
  const [r, g, b] = parseRgb(value)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Reads the rendered Draft Results spine in both schemes. Light mode puts it
 * on the studio panel with readable text; dark mode keeps the navy plate.
 * The readings are written next to the screenshots as evidence.
 */
const checkResultsSpineColors = async (page: Page) => {
  const label = test.info().project.name.includes("mobile")
    ? "mobile"
    : "desktop";
  const readings: Record<string, Record<string, string>> = {};
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    readings[scheme] = await page.evaluate(() => {
      const h1 = [...document.querySelectorAll("h1")].find(
        (el) => el.textContent?.trim() === "Draft Results",
      );
      const spine = h1?.closest("section");
      if (!h1 || !spine) throw new Error("Draft Results spine not found");
      const cell = spine.querySelector<HTMLElement>(
        '[role="cell"][aria-label]',
      );
      const mine = [
        ...spine.querySelectorAll<HTMLElement>('[role="cell"][aria-label]'),
      ].find((el) => getComputedStyle(el).boxShadow.includes("inset"));
      const rowHeader = spine.querySelector<HTMLElement>('[role="rowheader"]');
      const eyebrow = spine.querySelector<HTMLElement>("p");
      if (!cell || !mine || !rowHeader || !eyebrow) {
        throw new Error("Draft Results board cells not found");
      }
      const cs = (el: Element) => getComputedStyle(el);
      return {
        spineBackground: cs(spine).backgroundColor,
        titleColor: cs(h1).color,
        eyebrowColor: cs(eyebrow).color,
        roundLabelColor: cs(rowHeader).color,
        cellBackground: cs(cell).backgroundColor,
        cellColor: cs(cell).color,
        ownColumnBorder: cs(mine).borderLeftColor,
        ownColumnShadow: cs(mine).boxShadow,
      };
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
  writeFileSync(
    path.join(shotDir, `summary-spine-colors-${label}.json`),
    JSON.stringify(readings, null, 2),
  );

  const light = readings.light;
  expect(
    luminance(light.spineBackground),
    "light spine surface",
  ).toBeGreaterThan(0.8);
  expect(luminance(light.cellBackground), "light cell surface").toBeGreaterThan(
    0.8,
  );
  for (const [name, fg, bg] of [
    ["title", light.titleColor, light.spineBackground],
    ["eyebrow", light.eyebrowColor, light.spineBackground],
    ["round label", light.roundLabelColor, light.spineBackground],
    ["castaway name", light.cellColor, light.cellBackground],
  ]) {
    expect(contrast(fg, bg), `light ${name} contrast`).toBeGreaterThanOrEqual(
      4.5,
    );
  }
  // The viewer's column keeps its League Blue edge in both schemes.
  for (const scheme of ["light", "dark"] as const) {
    expect(readings[scheme].ownColumnBorder).toBe("rgb(17, 119, 255)");
    expect(readings[scheme].ownColumnShadow).toContain("rgb(17, 119, 255)");
  }
  // Dark mode is unchanged: the navy plate and Ice White text.
  expect(readings.dark.spineBackground).toBe("rgb(11, 35, 68)");
  expect(readings.dark.titleColor).toBe("rgb(234, 248, 255)");
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
  await page.addInitScript(installProbes, true);
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
    // The guest watches with reduced motion: no edge glow, instant nudge.
    reducedMotion: "reduce",
  });
  await guardContext(guestContext);
  const guest = await guestContext.newPage();
  trackConsole(guest);
  await guest.addInitScript(installProbes, false);
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

  const turnToast = (p: Page) =>
    p.getByRole("alert").filter({ hasText: "You're up!" });
  // Two players snake A B B A A B B A: these picks are consecutive turns.
  const SNAKE_PICKS = new Set([3, 5, 7]);

  for (let pick = 1; pick <= CAST_SIZE; pick++) {
    const { picker, watcher } = await pickerOf();
    const pickerName = picker === page ? "Ada Host" : "Bo Guest";
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

    // The duplicate teal "[NAME] PICKING" badge is gone; the h1 remains.
    await expect(
      watcher.getByText(`${pickerName} picking`, { exact: true }),
    ).toHaveCount(0);

    // Own-turn toast on the picker only, with snake copy on repeat turns.
    await expect(turnToast(picker)).toHaveCount(1);
    await expect(turnToast(watcher)).toHaveCount(0);
    await expect(
      turnToast(picker).filter({
        hasText: SNAKE_PICKS.has(pick)
          ? "Snake turn: you pick again."
          : "Pick a castaway from the cast below.",
      }),
    ).toHaveCount(1);

    if (pick === 4) {
      // The toast is fixed-position and survives the capture's scroll reset.
      await capture(picker, "active-your-turn-toast");
    }

    // Edge glow: the host (no reduced motion, activated page) gets one pulse
    // with pointer-events: none; the reduced-motion guest never renders it.
    if (picker === page) {
      await expect
        .poll(async () => (await probes(page)).__edges.length)
        .toBeGreaterThan(0);
      for (const pointerEvents of (await probes(page)).__edges) {
        expect(pointerEvents).toBe("none");
      }
      // The pulse is one-shot: the overlay detaches on its own.
      await expect(page.locator("[data-turn-edge]")).toHaveCount(0, {
        timeout: 3000,
      });
      // Vibration fires only after the page has been activated (the host
      // clicked through registration and the draft).
      await expect
        .poll(async () => (await probes(page)).__vib.length)
        .toBeGreaterThan(0);
    } else {
      await expect(guest.locator("[data-turn-edge]")).toHaveCount(0);
      expect((await probes(guest)).__edges).toEqual([]);
    }

    if (pick === 4) {
      await capture(picker, "active-your-turn", { fullPage: true });
      await capture(watcher, "active-waiting", { fullPage: true });

      // Reload dedupe: this tab already alerted for pick 4, so the reload
      // must not toast again.
      await reloadPage(picker);
      await expect(
        picker.getByRole("heading", { name: "Your turn to pick!" }),
      ).toBeVisible(SLOW);
      await picker.waitForTimeout(1500);
      await expect(turnToast(picker)).toHaveCount(0);
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
    await expect(
      p.getByText(
        "The draft is done. Next: answer the prop bet questions below the cast to earn bonus points.",
      ),
    ).toBeVisible(SLOW);
    // The turn toast must not linger past the final pick.
    await expect(turnToast(p)).toHaveCount(0);
  }

  if (isMobile) {
    // Both participants watched the draft finish live, so each is nudged
    // once to the questions board, which must clear the fixed header.
    for (const p of [page, guest]) {
      await expect(
        p.getByRole("heading", { name: "Prop bet questions" }),
      ).toBeInViewport(SLOW);
      await expect(p.getByText("Next step")).toBeVisible();
    }
    // Viewport shot at the nudged position: capture() resets scroll to the
    // top, which would erase exactly what this proves.
    await page.screenshot({
      path: path.join(shotDir, "prop-bets-nudged-mobile-light.png"),
    });

    // Late load: reloading straight into prop-bets must not auto-scroll.
    await reloadPage(page);
    await expect(
      page.getByRole("heading", { name: "Place Your Bets" }),
    ).toBeVisible(SLOW);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(100);
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
  await checkResultsSpineColors(page);

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
