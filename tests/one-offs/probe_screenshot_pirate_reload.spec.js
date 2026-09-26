// @ts-check
// One-off (2026-09-26): visual record of the bug. Load the pirate workflow,
// centre the SmartResCalc node, screenshot -> tests/one-offs/tmp/pirate_reload.png
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "screenshot pirate"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: screenshot pirate reload', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(async (wf) => {
        const app = window.app;
        app.graph.clear();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        node.collapsed = false;
        app.canvas.selectNode(node);
        app.canvas.ds.scale = 1.0;
        app.canvas.ds.offset = [-(node.pos[0] - 40), -(node.pos[1] - 40)];
        app.canvas.setDirty(true, true);
        await new Promise(r => setTimeout(r, 800));
        const h = node.widgets.find(w => w.name === 'dimension_height');
        const s = node.widgets.find(w => w.name === 'fill_seed');
        return { height: h.value, seed: s.value, lastSeed: s.lastSeed ?? null, size: node.size };
    }, wf);
    const out = path.join(__dirname, 'tmp', 'pirate_reload.png');
    await page.screenshot({ path: out, fullPage: false });
    console.log('screenshot:', out, JSON.stringify(info));
});
