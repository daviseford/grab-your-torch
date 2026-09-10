import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },

  projects: [
    // Auth setup — runs first and saves storageState for other projects
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    // Desktop viewport
    {
      name: "chromium-desktop",
      testIgnore: /pool-public\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["setup"],
    },

    // Mobile viewport
    {
      name: "chromium-mobile",
      testIgnore: /pool-public\.spec\.ts/,
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["setup"],
    },

    // Signed out, on purpose.
    //
    // Every other project above loads e2e/.auth/state.json, which is a real
    // signed-in admin session, and depends on the setup project that produces
    // it. The public pool claim is about what a visitor with no account
    // touches, so running it under those projects would authenticate the very
    // thing under test and prove nothing. This project therefore has NO
    // storageState and NO setup dependency, and the two projects above ignore
    // the spec so it is never run signed in by accident.
    {
      name: "chromium-signed-out",
      testMatch: /pool-public\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  webServer: {
    command: "yarn dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
