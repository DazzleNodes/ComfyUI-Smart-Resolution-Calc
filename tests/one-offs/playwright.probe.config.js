// One-off Playwright config: runs only the #58 handleFile probe, never the e2e suite.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: '.',
    testMatch: /probe_.*\.spec\.js$/,
    timeout: 90000,
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: { baseURL: 'http://localhost:8188' },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
