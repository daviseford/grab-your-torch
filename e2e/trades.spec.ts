import { expect, Page, test } from "@playwright/test";
import * as fs from "fs";
import type { CompetitionTab } from "./helpers";

/**
 * Live two-user trades e2e.
 *
 * Drives the real UI as two real logged-in users (seeded by globalSetup via
 * scripts/e2e-trade-setup.ts) against production Firebase:
 *   1. Trader Alice proposes a trade to Trader Bob.
 *   2. Bob sees it in real time and accepts.
 *   3. Rosters do NOT swap yet — the fixture is a watch-along on episode 2 and
 *      the cutoff is episode 3, so both cards show pending-trade indicators
 *      (outgoing marked "trading away", incoming previewed as a ghost).
 *   4. Standings totals do NOT change — past points stay with the original
 *      owner.
 *   5. The creator reveals episode 3 and the swap lands for both users.
 *   6. Bob trades back and Alice accepts; the return trip is pending again.
 */

interface TestUser {
  email: string;
  password: string;
  displayName: string;
  players: string[];
}

interface TradesTestState {
  competitionId: string;
  userA: TestUser;
  userB: TestUser;
}

const state: TradesTestState = JSON.parse(
  fs.readFileSync("e2e/.auth/trades-test.json", "utf-8"),
);

const COMPETITION_NAME = "E2E Trades Test League";

async function loginAs(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  await mainNav.getByRole("button", { name: "Sign in", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("textbox", { name: "Password" }).fill(password);
  await dialog.getByRole("button", { name: "Sign in" }).click();

  await expect(mainNav.getByRole("button", { name: "Logout" })).toBeVisible({
    timeout: 15_000,
  });
}

async function openCompetition(page: Page): Promise<void> {
  await page.goto(`/competitions/${state.competitionId}`);
  await expect(
    page.getByRole("heading", { name: COMPETITION_NAME }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
}

async function selectCompetitionTab(
  page: Page,
  name: CompetitionTab,
): Promise<void> {
  const accessibleName =
    name === "Trades" ? /^Trades(?:, \d+ pending offers?)?$/ : name;
  const tab = page.getByRole("tab", { name: accessibleName, exact: true });
  const tabParam = new URL(page.url()).searchParams.get("tab");

  if (
    name === "Overview" &&
    tabParam === null &&
    (await tab.getAttribute("aria-selected")) === "true"
  ) {
    return;
  }

  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("tab"))
    .toBe(name.toLowerCase());
}

/** The Rosters card for a participant. */
const teamCard = (page: Page, displayName: string) =>
  page
    .locator("div.mantine-Card-root")
    .filter({ has: page.getByRole("heading", { name: displayName }) });

/** The standings row for a participant (scoped to the Standings section). */
const standingsRow = (page: Page, displayName: string) =>
  page
    .locator("div.mantine-Paper-root", {
      has: page.getByRole("heading", { name: "Standings" }),
    })
    .locator("tr", { hasText: displayName });

/** Row text with whitespace normalized, so comparisons ignore cell spacing. */
const standingsText = async (
  page: Page,
  displayName: string,
): Promise<string> =>
  (await standingsRow(page, displayName).innerText())
    .replace(/\s+/g, " ")
    .trim();

async function proposeTrade(
  page: Page,
  partnerName: string,
  givePlayer: string,
  receivePlayer: string,
): Promise<void> {
  await page.getByRole("button", { name: "Propose trade" }).click();

  const modal = page.getByRole("dialog");
  await modal.getByLabel("Trade with").click();
  await page.getByRole("option", { name: partnerName }).click();

  await modal.getByRole("checkbox", { name: givePlayer }).click();
  await modal.getByRole("checkbox", { name: receivePlayer }).click();

  await modal.getByRole("button", { name: "Send offer" }).click();
  await expect(modal).not.toBeVisible({ timeout: 10_000 });
}

test("two users trade players back and forth", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const alice = state.userA;
  const bob = state.userB;
  const [alicePlayer] = alice.players;
  const [bobPlayer] = bob.players;

  await loginAs(pageA, alice.email, alice.password);
  await loginAs(pageB, bob.email, bob.password);
  await openCompetition(pageA);
  await openCompetition(pageB);

  // Baseline: rosters and standings before any trade.
  await expect(
    teamCard(pageA, alice.displayName).getByAltText(alicePlayer),
  ).toBeVisible();
  await expect(
    teamCard(pageA, bob.displayName).getByAltText(bobPlayer),
  ).toBeVisible();
  const aliceRowBefore = await standingsText(pageA, alice.displayName);
  const bobRowBefore = await standingsText(pageA, bob.displayName);

  // 1. Alice proposes: her first player for Bob's first player.
  await selectCompetitionTab(pageA, "Trades");
  await proposeTrade(pageA, bob.displayName, alicePlayer, bobPlayer);

  // 2. Bob sees the offer and accepts.
  await expect(
    pageB.getByRole("tab", { name: "Trades, 1 pending offer" }),
  ).toBeVisible({ timeout: 15_000 });

  // Reload so Bob's trades listener attaches with a settled auth token —
  // guards against a subscribe race on freshly minted users.
  await selectCompetitionTab(pageB, "Trades");
  await pageB.reload();
  await expect(
    pageB.getByRole("tab", { name: "Trades, 1 pending offer", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    pageB.getByRole("heading", { name: "Incoming offers" }),
  ).toBeVisible({ timeout: 15_000 });
  const aliceOffer = pageB.locator("[data-trade-id]").filter({
    has: pageB.getByText(`Offer from ${alice.displayName}`, { exact: true }),
  });
  await expect(
    aliceOffer.getByText(`Offer from ${alice.displayName}`, { exact: true }),
  ).toBeVisible();
  await expect(
    aliceOffer.getByText(alicePlayer, { exact: true }),
  ).toBeVisible();
  await expect(aliceOffer.getByText(bobPlayer, { exact: true })).toBeVisible();
  await aliceOffer.getByRole("button", { name: "Accept offer" }).click();
  await expect(
    pageB.getByRole("tab", { name: "Trades", exact: true }),
  ).toBeVisible();

  // 3. Rosters do NOT swap yet (live snapshots, no reload needed): the trade
  // lands next episode. The outgoing player stays on the sender's card marked
  // as trading away, and the receiving card previews the arrival.
  await selectCompetitionTab(pageA, "Overview");
  await selectCompetitionTab(pageB, "Overview");
  await expect(
    teamCard(pageA, alice.displayName).getByAltText(
      `${alicePlayer} (trading away)`,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    teamCard(pageA, bob.displayName).getByAltText(
      `${alicePlayer} (arriving next episode)`,
    ),
  ).toBeVisible();
  await expect(
    teamCard(pageB, alice.displayName).getByAltText(
      `${bobPlayer} (arriving next episode)`,
    ),
  ).toBeVisible({ timeout: 15_000 });

  // 4. Past points did not move with the traded players.
  expect(await standingsText(pageA, alice.displayName)).toBe(aliceRowBefore);
  expect(await standingsText(pageA, bob.displayName)).toBe(bobRowBefore);

  // History records the accepted trade with its points cutoff. The fixture is
  // a watch-along on episode 2, so the cutoff is the next episode to reveal.
  await selectCompetitionTab(pageA, "Trades");
  await expect(pageA.getByText("Accepted · from Ep 3").first()).toBeVisible();

  // 5. The creator reveals the cutoff episode and the swap lands everywhere.
  await selectCompetitionTab(pageA, "Overview");
  await pageA.getByRole("button", { name: "Reveal Ep 3" }).click();
  await expect(
    teamCard(pageA, bob.displayName).getByAltText(alicePlayer, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    teamCard(pageB, alice.displayName).getByAltText(bobPlayer, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    teamCard(pageA, bob.displayName).getByAltText(
      `${alicePlayer} (arriving next episode)`,
    ),
  ).not.toBeVisible();

  // 6. Bob trades the players back; Alice accepts.
  await selectCompetitionTab(pageB, "Trades");
  await proposeTrade(pageB, alice.displayName, alicePlayer, bobPlayer);
  await expect(
    pageA.getByRole("tab", { name: "Trades, 1 pending offer" }),
  ).toBeVisible({ timeout: 15_000 });
  // Page A was left on Overview by the reveal step; move to Trades so the
  // reload (which guards against a subscribe race on fresh users) lands there.
  await selectCompetitionTab(pageA, "Trades");
  await pageA.reload();
  await expect(
    pageA.getByRole("tab", { name: "Trades, 1 pending offer", exact: true }),
  ).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  const bobOffer = pageA.locator("[data-trade-id]").filter({
    has: pageA.getByText(`Offer from ${bob.displayName}`, { exact: true }),
  });
  await expect(
    bobOffer.getByText(`Offer from ${bob.displayName}`, { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(bobOffer.getByText(alicePlayer, { exact: true })).toBeVisible();
  await expect(bobOffer.getByText(bobPlayer, { exact: true })).toBeVisible();
  await bobOffer.getByRole("button", { name: "Accept offer" }).click();
  await expect(
    pageA.getByRole("tab", { name: "Trades", exact: true }),
  ).toBeVisible();

  // The return trip is pending in turn: rosters still show the
  // post-episode-3 state, with the players marked as moving back at the next
  // reveal.
  await selectCompetitionTab(pageA, "Overview");
  await selectCompetitionTab(pageB, "Overview");
  await expect(
    teamCard(pageA, bob.displayName).getByAltText(
      `${alicePlayer} (trading away)`,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    teamCard(pageB, alice.displayName).getByAltText(
      `${alicePlayer} (arriving next episode)`,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await selectCompetitionTab(pageA, "Trades");
  await expect(pageA.getByText("Accepted · from Ep 4").first()).toBeVisible();

  await contextA.close();
  await contextB.close();
});
