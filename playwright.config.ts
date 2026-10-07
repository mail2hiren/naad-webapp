import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the mock-mode integration suite. VITE_USE_MOCK=1
 * (via .env.test) points the app at the in-memory mock Supabase client
 * instead of the live production project, so this suite NEVER writes test
 * data into real patient records.
 *
 * Two projects:
 *  - chromium:      the main suite, scripted ambient simulation (port 4173)
 *  - real-ambient:  the REAL microphone -> MediaRecorder -> upload ->
 *                   extraction-mapping path, driven by Chromium's fake audio
 *                   device with the edge function stubbed via page.route
 *                   (port 4174, built with `--mode realambient`)
 */
// Some sandboxes ship a pinned Chromium that predates the installed Playwright;
// use it when present. Elsewhere (CI, a laptop) fall back to the browser that
// `npx playwright install chromium` provides.
const PINNED_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumExe = existsSync(PINNED_CHROMIUM) ? { executablePath: PINNED_CHROMIUM } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run build:test && npm run preview -- --port 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run build:realambient && npx vite preview --outDir dist-realambient --port 4174',
      url: 'http://localhost:4174',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /real-ambient.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
        // This sandbox ships a pinned Chromium build under /opt/pw-browsers
        // that predates whatever @playwright/test version got installed --
        // launch the full, already-present chromium binary directly.
        launchOptions: chromiumExe,
      },
    },
    {
      name: 'real-ambient',
      testMatch: /real-ambient.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4174',
        permissions: ['microphone'],
        // The app registers a service worker; requests it handles bypass page.route.
        serviceWorkers: 'block',
        launchOptions: {
          ...chromiumExe,
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
    },
  ],
});
