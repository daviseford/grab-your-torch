import { expect, test as setup } from "@playwright/test";
import dotenv from "dotenv";

// Use override: true so .env values take precedence over system env vars.
// On Windows, USERNAME is a built-in system variable (the Windows login name),
// which would shadow the email address in .env without override.
dotenv.config({ override: true });

setup("authenticate as admin", async ({ page }) => {
  const username = process.env.USERNAME;
  const password = process.env.PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Missing USERNAME or PASSWORD in .env file. " +
        "Create a .env at the project root with USERNAME=<email> and PASSWORD=<password>.",
    );
  }

  // Navigate to the app
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Open the AuthModal from the main navigation (a panel behind the burger
  // on narrow screens; the setup project runs at desktop width).
  const mainNav = page.getByRole("navigation", { name: "Main navigation" });
  await mainNav.getByRole("button", { name: "Sign in", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").waitFor({ timeout: 10_000 });
  await dialog.getByLabel("Email").fill(username);
  await dialog.getByRole("textbox", { name: "Password" }).fill(password);
  await dialog.getByRole("button", { name: "Sign in" }).click();

  // Wait for auth to settle: the navigation swaps Sign in for Logout.
  await expect(mainNav.getByRole("button", { name: "Logout" })).toBeVisible({
    timeout: 15_000,
  });

  // Save signed-in state so other tests can reuse it
  await page.context().storageState({ path: "e2e/.auth/state.json" });
});
