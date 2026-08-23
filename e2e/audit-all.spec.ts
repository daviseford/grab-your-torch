import { expect, test } from "@playwright/test";

import { ALL_ROUTES, SCROLL_SECTIONS } from "./helpers";

/**
 * Take screenshots of every route in both light and dark mode, and assert the
 * semantics that make a capture valid evidence: the page rendered the state
 * its name claims, the right tab is selected, the color scheme took, there is
 * exactly one main landmark and one h1, and nothing scrolls the document
 * sideways (wide tables must scroll inside their own board).
 *
 * SAFETY: These tests are READ-ONLY: they only navigate and take screenshots.
 * No data is ever created, updated, or deleted.
 *
 * Screenshots are saved to e2e/screenshots/ with the naming convention:
 *   audit-{route-name}-{viewport}-{colorScheme}.png
 *
 * For long pages with SCROLL_SECTIONS defined, additional per-section
 * screenshots are captured by scrolling to each section:
 *   audit-{route-name}-{section-label}-{viewport}-{colorScheme}.png
 *
 * The viewport (desktop/mobile) is determined by the Playwright project.
 * Color scheme is toggled via Mantine's data-mantine-color-scheme attribute.
 */

const COLOR_SCHEMES = ["light", "dark"] as const;

for (const route of ALL_ROUTES) {
  for (const colorScheme of COLOR_SCHEMES) {
    test(`audit ${route.name} - ${colorScheme}`, async ({ page }, testInfo) => {
      const viewport =
        (testInfo.project.use as { viewport?: { width: number } }).viewport
          ?.width ?? 1280;
      const viewportLabel = viewport <= 500 ? "mobile" : "desktop";

      // Navigate to the route: use domcontentloaded instead of networkidle
      // because Firebase onSnapshot listeners keep the network permanently active
      await page.goto(route.path, { waitUntil: "domcontentloaded" });

      // Set the color scheme via Mantine's root attribute
      await page.evaluate((scheme) => {
        document.documentElement.setAttribute(
          "data-mantine-color-scheme",
          scheme,
        );
      }, colorScheme);

      // Let Firebase data load and Mantine transitions settle
      await page.waitForTimeout(3_000);

      // Verify the page actually rendered, and rendered the claimed state.
      await expect(page.locator("body")).not.toBeEmpty();
      if (route.heading) {
        await expect(
          page.getByRole("heading", { name: route.heading }).first(),
        ).toBeVisible();
      }

      // Competition tab routes are deep links. Confirm the requested panel is
      // active before capturing it so a broken query-param contract cannot
      // silently produce four copies of the default Overview screen.
      if (route.competitionTab) {
        const tabName =
          route.competitionTab === "Trades"
            ? /^Trades(?:, \d+ pending offers?)?$/
            : route.competitionTab;
        const tab = page.getByRole("tab", {
          name: tabName,
          exact: true,
        });
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute("aria-selected", "true");
      }
      if (route.adminTab) {
        const tab = page.getByRole("tab", { name: route.adminTab });
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute("aria-selected", "true");
      }

      // Shell invariants: one main landmark, one main navigation, one h1,
      // the requested scheme, and no document-level horizontal overflow.
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(
        page.locator('nav[aria-label="Main navigation"]'),
      ).toHaveCount(1);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("html")).toHaveAttribute(
        "data-mantine-color-scheme",
        colorScheme,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(
        overflow,
        "document must not scroll horizontally",
      ).toBeLessThanOrEqual(0);

      // Full-page screenshot
      await page.screenshot({
        path: `e2e/screenshots/audit-${route.name}-${viewportLabel}-${colorScheme}.png`,
        fullPage: true,
      });

      // Per-section screenshots for long pages (e.g., competition detail)
      const sections = SCROLL_SECTIONS[route.name];
      if (sections) {
        for (const section of sections) {
          const el = page.locator(section.selector).first();
          if (await el.isVisible().catch(() => false)) {
            await el.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
            await page.screenshot({
              path: `e2e/screenshots/audit-${route.name}-${section.label}-${viewportLabel}-${colorScheme}.png`,
            });
          }
        }
      }
    });
  }
}
