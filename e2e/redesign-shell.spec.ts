import { expect, test } from "@playwright/test";

/**
 * Shell checks for the On Air redesign: navigation landmark and drawer,
 * skip link, color scheme toggle, utility slates, and overflow at both
 * viewports. Runs under the default config (signed-in storage state from the
 * setup project) and is READ-ONLY: navigate, click shell controls, screenshot.
 *
 *   yarn playwright test redesign-shell --project=chromium-desktop --project=chromium-mobile
 */

const mainNav = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Main navigation" });

const noOverflow = async (page: import("@playwright/test").Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "document must not scroll horizontally").toBeLessThanOrEqual(
    0,
  );
};

test("the shell has one main navigation landmark, a bug link, and a skip link", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toHaveCount(1);
  // The drawer is display:none when closed on phones, so count the landmark
  // by element rather than by accessible role.
  await expect(page.locator('nav[aria-label="Main navigation"]')).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("link", { name: "Grab Your Torch, home" }),
  ).toBeVisible();

  // Skip link is the first tab stop and targets the main landmark.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute("href", "#main-content");

  if (isMobile) {
    await expect(mainNav(page)).toBeHidden();
    const burger = page.getByRole("button", { name: "Toggle navigation" });
    await expect(burger).toHaveAttribute("aria-expanded", "false");
    await burger.click();
    await expect(burger).toHaveAttribute("aria-expanded", "true");
    await expect(mainNav(page)).toBeVisible();
    await expect(
      mainNav(page).getByRole("link", { name: "Seasons" }),
    ).toBeVisible();
    await burger.click();
    await expect(mainNav(page)).toBeHidden();
  } else {
    await expect(mainNav(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Toggle navigation" }),
    ).toBeHidden();
  }
  await noOverflow(page);
});

test("the color scheme toggle flips the Mantine scheme in both directions", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  if (isMobile)
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  const toggle = mainNav(page).getByRole("button", {
    name: "Toggle color scheme",
  });
  const html = page.locator("html");
  const before = await html.getAttribute("data-mantine-color-scheme");
  await toggle.click();
  await expect(html).not.toHaveAttribute(
    "data-mantine-color-scheme",
    before ?? "",
  );
  await toggle.click();
  await expect(html).toHaveAttribute("data-mantine-color-scheme", before ?? "");
});

test("navigation marks the current section", async ({ page, isMobile }) => {
  await page.goto("/seasons");
  if (isMobile)
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    mainNav(page).getByRole("link", { name: "Seasons" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    mainNav(page).getByRole("link", { name: "Home" }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("unknown routes render the not-found slate and stay out of search indexes", async ({
  page,
}) => {
  await page.goto("/this-page-does-not-exist");
  await expect(
    page.getByRole("heading", { name: "Page not found", level: 1 }),
  ).toBeVisible();
  await expect(
    page.locator('meta[name="robots"][content="noindex"]'),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Go home" })).toBeVisible();
  await noOverflow(page);
});

test("the reset route without a code renders the returned state on a standby slate", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(
    page.getByRole("heading", {
      name: "Sign in with your new password",
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request a new reset email" }),
  ).toBeVisible();
  await noOverflow(page);
});

test("the legacy season manage URL redirects to the admin workspace", async ({
  page,
}) => {
  await page.goto("/seasons/season_50/manage");
  await expect(page).toHaveURL(/\/admin\/season_50$/);
});
