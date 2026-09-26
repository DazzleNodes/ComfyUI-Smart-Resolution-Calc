// @ts-check
// One-off probe (2026-09-26): load the EXACT workflow embedded in the pirate
// image (extracted to tests/one-offs/tmp/pirate_workflow.json), read what the
// SmartResCalc height widget shows after load, then edit it and serialize.
// Answers: (1) what height does a drag-in of this image show? (2) which block
// wins on restore? (3) does editing + serializing refresh the by-name block, or
// is the loaded block echoed back (stale)?
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "pirate workflow"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: pirate workflow round trip', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    const consoleLines = [];
    page.on('console', m => consoleLines.push(m.text()));
    await page.goto('/');
    await page.evaluate(() => { localStorage.setItem('DEBUG_SMART_RES_CALC', 'true'); });
    await page.reload();
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        const out = {};
        app.graph.clear();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2500));
        const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        if (!node) return { error: 'no SmartResCalc node after load', types: (app.graph._nodes||[]).map(n=>n.type).slice(0,10) };
        const h = node.widgets.find(w => w.name === 'dimension_height');
        const sw = node.widgets.find(w => w.name === 'fill_seed');
        out.afterLoad = { height: JSON.parse(JSON.stringify(h.value)), seedValue: JSON.parse(JSON.stringify(sw.value)), lastSeed: sw.lastSeed ?? null,
            nodeExtensions: node.extensions ? Object.keys(node.extensions) : null,
            serializeIsOurs: String(node.serialize).includes('widgets_values_by_name'),
            configureIsOurs: String(node.configure).includes('widgets_values_by_name'),
            widgetNames: node.widgets.map(w => w.name) };
        // Serialize WITHOUT editing: is by-name refreshed or echoed?
        const s0 = node.serialize();
        out.serializeNoEdit = { idx23: s0.widgets_values?.[23], byName: s0.widgets_values_by_name?.dimension_height,
            ext_byName: s0.extensions?.widgets_values_by_name?.dimension_height, named: s0.widgets_values_named?.dimension_height,
            topKeys: Object.keys(s0) };
        // Edit in place, serialize again
        h.value.value = 2100; h.value.on = true;
        const s1 = node.serialize();
        out.serializeAfterEdit = { idx23: s1.widgets_values?.[23], byName: s1.widgets_values_by_name?.dimension_height,
            ext_byName: s1.extensions?.widgets_values_by_name?.dimension_height, named: s1.widgets_values_named?.dimension_height };
        const p = await app.graphToPrompt();
        const wfn = p.workflow.nodes.find(n => String(n.id) === String(node.id));
        out.prompt = { sent: p.output?.[String(node.id)]?.inputs?.dimension_height, wf_idx23: wfn?.widgets_values?.[23],
            wf_byName: wfn?.widgets_values_by_name?.dimension_height, wf_ext_byName: wfn?.extensions?.widgets_values_by_name?.dimension_height };
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
    console.log('--- configure lines ---');
    for (const l of consoleLines.filter(l => /\[configure\]|Name-based|Error|error/.test(l)).slice(0, 12)) console.log(l);
});
