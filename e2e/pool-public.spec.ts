import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * AE4: what a signed-out visitor's homepage load actually touches.
 *
 * This is the plan's headline claim and the one behaviour that cannot be
 * proven by a unit test under this project's conventions. It is a statement
 * about network traffic, so it is asserted on network traffic.
 *
 * RUN IT SIGNED OUT OR NOT AT ALL. This spec belongs to the
 * `chromium-signed-out` project, which carries no `storageState` and no
 * dependency on the `setup` project. Every other project in
 * `playwright.config.ts` loads a real signed-in admin session, and they ignore
 * this file so it cannot be run authenticated by accident. A signed-in run
 * would pass for the wrong reason: an admin may read every result collection,
 * so nothing would be proven about the visitor the claim is about.
 *
 * HOW THE ASSERTION WORKS, and why it is not theatre.
 *
 * The Firestore web SDK does not put document paths in a URL. Listeners and
 * one-time gets alike travel over a long-lived WebChannel whose URL is
 * `.../google.firestore.v1.Firestore/Listen/channel?...` or `.../Write/channel`
 * with the target paths in the POST body, so a URL-only assertion would be
 * vacuously true: it would pass on a page that read every result collection in
 * the project. This spec therefore captures URL AND request body for every
 * request to a Firebase host and searches both.
 *
 * That leaves the other way an assertion like this fails silently: capturing
 * nothing. If the recording missed the traffic, or the SDK never connected, or
 * the page failed to render, a "no forbidden path appeared" assertion passes
 * with no evidence behind it. So every assertion here is paired with a
 * positive control on the same captured text: the pool configuration document
 * MUST appear in it. `usePool` subscribes to `pools/pool_season_51` whether or
 * not that document exists, so the control holds even before the pool is
 * provisioned, and it fails loudly the moment the capture stops working.
 */

/** One document per season, each of them a result collection (R22, AE4). */
const FORBIDDEN_COLLECTIONS = [
  "events",
  "challenges",
  "eliminations",
  "vote_history",
  "team_assignments",
  "seasons",
];

/** The pool the homepage module names. Also the positive control below. */
const POOL_PATH = "pools/pool_season_51";

const FIREBASE_HOST =
  /firestore\.googleapis\.com|firebaseio\.com|firebasedatabase\.app/;

type Capture = { urls: string[]; blobs: string[] };

/**
 * Record URL and body for every request that reaches a Firebase backend.
 *
 * Bodies are decoded from percent-encoding as well as kept raw: the WebChannel
 * transport form-encodes its request payload, so `documents/events/season_51`
 * arrives as `documents%2Fevents%2Fseason_51` in some frames and as plain text
 * in others. Searching both spellings is the difference between an assertion
 * that holds and one that merely looks like it does.
 */
const captureFirebaseTraffic = (page: Page): Capture => {
  const capture: Capture = { urls: [], blobs: [] };

  page.on("request", (request: Request) => {
    const url = request.url();
    if (!FIREBASE_HOST.test(url)) return;
    capture.urls.push(url);

    let body = "";
    try {
      body = request.postData() ?? "";
    } catch {
      body = "";
    }
    const text = `${url}\n${body}`;
    capture.blobs.push(text);
    try {
      capture.blobs.push(decodeURIComponent(text.replace(/\+/g, " ")));
    } catch {
      // A body that is not valid percent-encoding is already captured raw.
    }
  });

  return capture;
};

const allText = (capture: Capture) => capture.blobs.join("\n");

/**
 * Give the SDK time to open its channels and the module time to render.
 *
 * `networkidle` is unreliable against a WebChannel that stays open by design,
 * so this waits for the page to settle and then for the positive control to
 * show up rather than for the network to go quiet.
 */
const loadHomepageSignedOut = async (page: Page) => {
  const capture = captureFirebaseTraffic(page);
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect
    .poll(() => allText(capture).includes(POOL_PATH), {
      timeout: 20_000,
      message:
        "No request naming the pool configuration document was captured. Either the capture is not seeing Firestore traffic, in which case every assertion in this file is vacuous, or the homepage module is not reading the pool at all.",
    })
    .toBe(true);
  return capture;
};

test.describe("signed-out homepage (AE4)", () => {
  test("is genuinely signed out", async ({ page }) => {
    // The whole point of the chromium-signed-out project. If a storageState
    // ever leaks in here, this fails before anything else misleads anyone.
    await page.goto("/");
    const authKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) =>
        k.startsWith("firebase:authUser:"),
      ),
    );
    expect(authKeys).toEqual([]);
  });

  test("issues no read against a result collection or a season document", async ({
    page,
  }) => {
    const capture = await loadHomepageSignedOut(page);
    const text = allText(capture);

    for (const collectionName of FORBIDDEN_COLLECTIONS) {
      // `documents/<collection>/` is how a Firestore document name is spelled
      // in both the URL query and the channel body, so this matches a read of
      // the collection without matching the word appearing anywhere else.
      expect(
        text,
        `a request named documents/${collectionName}/ on a signed-out homepage load`,
      ).not.toContain(`documents/${collectionName}/`);
      expect(text).not.toContain(`documents%2F${collectionName}%2F`);
    }

    // And nothing reached the realtime database either, where paths DO live in
    // the URL: the drafts tree is the other place season and competition state
    // could be read from.
    for (const url of capture.urls) {
      expect(url).not.toContain("/drafts");
    }
  });

  test("shows no castaway name or elimination state in the pool module", async ({
    page,
  }) => {
    await loadHomepageSignedOut(page);
    const hero = page.getByLabel("Hero");
    await expect(hero).toBeVisible();
    const heroText = (await hero.innerText()).toLowerCase();
    for (const banned of [
      "eliminated",
      "voted out",
      "drafted by",
      "immunity",
      "tribal council",
    ]) {
      expect(
        heroText,
        `"${banned}" reached a public pool surface`,
      ).not.toContain(banned);
    }
  });

  test("renders the module at 375px without scrolling the page sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadHomepageSignedOut(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
