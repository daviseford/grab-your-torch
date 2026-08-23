import { expect, test } from "@playwright/test";

/**
 * Screenshot the redesigned admin surfaces (the control room) in both color
 * schemes: the dashboard and every rundown tab of the season workspace.
 *
 * SAFETY: This suite is READ-ONLY. It only navigates and takes screenshots.
 * It never submits a form, opens a delete confirmation, or drags a castaway.
 *
 * Screenshots are saved to e2e/screenshots/ as:
 *   redesign-admin-{route-name}-{viewport}-{colorScheme}.png
 *
 * Uses the saved admin session from the `setup` project.
 */

const SEASON_ID = "season_50";
const COLOR_SCHEMES = ["light", "dark"] as const;
const WORKSPACE_TABS = [
  "episodes",
  "events",
  "challenges",
  "eliminations",
  "teams",
] as const;

type AdminRoute = {
  path: string;
  name: string;
  /** Accessible name of the rundown tab that must be selected. */
  tab?: string;
};

const ROUTES: AdminRoute[] = [
  { path: "/admin", name: "dashboard" },
  ...WORKSPACE_TABS.map((tab) => ({
    path: `/admin/${SEASON_ID}?tab=${tab}`,
    name: `workspace-${tab}`,
    tab: tab.charAt(0).toUpperCase() + tab.slice(1),
  })),
];

for (const route of ROUTES) {
  for (const colorScheme of COLOR_SCHEMES) {
    test(`redesign admin ${route.name} – ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      const viewport =
        (testInfo.project.use as { viewport?: { width: number } }).viewport
          ?.width ?? 1280;
      const viewportLabel = viewport <= 500 ? "mobile" : "desktop";

      // domcontentloaded: Firebase onSnapshot listeners keep the network busy
      await page.goto(route.path, { waitUntil: "domcontentloaded" });

      await page.evaluate((scheme) => {
        document.documentElement.setAttribute(
          "data-mantine-color-scheme",
          scheme,
        );
      }, colorScheme);

      // Let Firebase data load and Mantine transitions settle
      await page.waitForTimeout(3_000);

      await expect(page.locator("body")).not.toBeEmpty();
      await expect(page.locator("h1")).toHaveCount(1);

      if (route.tab) {
        const tab = page.getByRole("tab", { name: route.tab, exact: true });
        await expect(tab).toBeVisible();
        await expect(tab).toHaveAttribute("aria-selected", "true");
      }

      // The document must never scroll sideways; wide boards scroll locally.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await page.screenshot({
        path: `e2e/screenshots/redesign-admin-${route.name}-${viewportLabel}-${colorScheme}.png`,
        fullPage: true,
      });
    });
  }
}
