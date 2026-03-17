// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Playwright config for SmartResCalc E2E tests.
 * Assumes ComfyUI is running at localhost:8188.
 */
module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false, // ComfyUI is a single instance
  workers: 1, // Single worker — all tests share one ComfyUI server
  retries: 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8188',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
