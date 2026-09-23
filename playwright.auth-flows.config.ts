import { defineConfig, devices } from "@playwright/test";

/**
 * Isolated auth-flow e2e. Unlike playwright.trades.config.ts, this suite never
 * touches production: the Vite dev server runs in `e2e-auth` mode
 * (.env.e2e-auth + emulator wiring in src/firebase.ts), so Auth, Firestore,
 * and Realtime Database all talk to local Firebase emulators under the
 * inert `demo-auth-flows` project. Run it through the emulator wrapper:
 *
 *   yarn e2e:auth-flows
 *
 * E2E_PORT moves the dev server off 5175 when another checkout holds it; the
 * VITE_EMULATOR_*_PORT variables (see src/firebase.ts) do the same for the
 * emulators when a local firebase config moves them.
 *
 * One worker: tests share the emulator and flush/reseed it between tests
 * (see e2e/auth-flows.spec.ts), so parallel workers would race.
 */
const PORT = Number(process.env.E2E_PORT) || 5175;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(auth-flows|redesign-draft|castaway-adp)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: "html",
  timeout: 90_000,

  use: {
    // Dedicated port: never reuse a server running another mode, since the
    // emulator wiring only exists in e2e-auth mode.
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },

  // Emulator round trips after auth (continuation, RTDB reads) can take a
  // few seconds; the default 5s expect timeout is too tight.
  expect: { timeout: 15_000 },

  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["iPhone 14"] } },
  ],

  webServer: {
    command: `yarn dev --mode e2e-auth --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
