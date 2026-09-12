import { expect, test } from "@playwright/test";

// Public, read-only checks. Never create a draft or alter a competition.
test("preseason bio shows sourced facts and returns keyboard focus", async ({
  page,
}) => {
  await page.goto("/seasons/season_51");
  const trigger = page.getByRole("button", {
    name: "View bio for Danny Kilby",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "About Danny Kilby" });
  await expect(
    dialog.getByText("Mount Forest, Ontario, Canada", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("London, Ontario, Canada", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Filmmaking, tabletop games, improv, kayaking", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Preseason questionnaire" }),
  ).toHaveAttribute(
    "href",
    "https://www.tvinsider.com/gallery/survivor-51-cast-open-era/",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("measurements retain their preseason self-report context", async ({
  page,
}) => {
  await page.goto("/seasons/season_51");
  await page
    .getByRole("button", { name: "View bio for Ori Jean-Charles", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "About Ori Jean-Charles" });
  await expect(
    dialog.getByText("6 ft 3 in (self-reported, preseason)", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("230–235 lb (self-reported, preseason)", { exact: true }),
  ).toBeVisible();
});
