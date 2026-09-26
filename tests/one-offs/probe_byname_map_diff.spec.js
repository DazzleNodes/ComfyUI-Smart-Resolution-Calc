// @ts-check
// One-off probe (2026-09-26): under the conditions that produced
// by-name(2100) != widget(1216) in the same serialize call (load into a
// session that already has a tab; no graph.clear()), diff our hook's whole
// by-name map against a replica read at the same instant, and check the
// `widgets` property's nature (getter? new array per access?).
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "map diff"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: by-name map diff under multi-tab load', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        const out = { runs: [] };
        for (let run = 0; run < 3; run++) {
            await app.loadGraphData(JSON.parse(JSON.stringify(wf)));      // no clear(): opens beside existing tabs
            await new Promise(r => setTimeout(r, 2000));
            const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
            const wd = Object.getOwnPropertyDescriptor(node, 'widgets') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'widgets') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object.getPrototypeOf(node)), 'widgets');
            const a1 = node.widgets, a2 = node.widgets;
            const replica = {}; a1.forEach(w => { if (w.value !== undefined) replica[w.name] = JSON.parse(JSON.stringify(w.value)); });
            const s = node.serialize();
            const hook = s.widgets_values_by_name || {};
            const diff = {};
            for (const k of new Set([...Object.keys(replica), ...Object.keys(hook)])) {
                const a = JSON.stringify(replica[k]), b = JSON.stringify(hook[k]);
                if (a !== b) diff[k] = { replica: replica[k], hook: hook[k], named: s.widgets_values_named?.[k] };
            }
            out.runs.push({ run, tabs: app.extensionManager?.workflow?.openWorkflows?.length ?? 'n/a',
                widgetsDesc: wd ? { get: !!wd.get, set: !!wd.set, hasValue: 'value' in wd } : null, sameArrayTwice: a1 === a2,
                nWidgets: a1.length, nSRC: (app.graph._nodes || []).filter(n => n.comfyClass === 'SmartResolutionCalc').length,
                diffKeys: Object.keys(diff), diff });
        }
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
});
