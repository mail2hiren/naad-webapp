import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the mock-mode integration suite. VITE_USE_MOCK=1
 * (via .env.test, loaded by the `test` npm script below) points the app at
 * the in-memory mock Supabase client instead of the live production
 * project, so this suite NEVER writes test data into real patient records.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:test && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This sandbox ships a pinned Chromium build under /opt/pw-browsers
        // that predates whatever @playwright/test version got installed
        // (it looks for a newer chromium_headless_shell revision by
        // default) -- launch the full, already-present chromium binary
        // directly instead of trying to download a new one.
        launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
      },
    },
  ],
});
