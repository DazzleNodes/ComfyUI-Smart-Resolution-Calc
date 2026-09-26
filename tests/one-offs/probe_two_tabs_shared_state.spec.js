// @ts-check
// One-off probe (2026-09-26): does frontend 1.53's widget-value store share a
// LegacyWidget's _state between two open workflows that carry the SAME graph id
// (the pirate workflow opened twice), so that an edit in one tab changes what
// the other tab serializes? Read-only apart from in-page graph loads.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "two tabs"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: two tabs with the same workflow id share widget state?', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        const out = {};
        const ws = app.extensionManager?.workflow;
        const findNode = () => (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        // Tab A
        await app.loadGraphData(JSON.parse(JSON.stringify(wf)));
        await new Promise(r => setTimeout(r, 2000));
        const nodeA = findNode(); const graphA = app.graph;
        const hA = nodeA.widgets.find(w => w.name === 'dimension_height');
        out.A = { graphId: graphA.id, nodeId: nodeA.id, widgetId: hA.widgetId ?? null, height: JSON.parse(JSON.stringify(hA.value)) };
        // Tab B: open the same workflow again (same graph id inside the JSON)
        await app.loadGraphData(JSON.parse(JSON.stringify(wf)), true, true, null, {});
        await new Promise(r => setTimeout(r, 2000));
        const nodeB = findNode(); const graphB = app.graph;
        const hB = nodeB.widgets.find(w => w.name === 'dimension_height');
        out.B = { graphId: graphB.id, nodeId: nodeB.id, widgetId: hB.widgetId ?? null, height: JSON.parse(JSON.stringify(hB.value)) };
        out.sameGraphObject = graphA === graphB;
        out.sameNodeObject = nodeA === nodeB;
        out.sameWidgetObject = hA === hB;
        out.sameStateObject = hA._state === hB._state;
        out.sameValueObject = hA.value === hB.value;
        out.openWorkflows = ws?.openWorkflows?.map?.(w => ({ path: w.path, isTemp: w.isTemporary, active: w === ws.activeWorkflow })) ?? 'n/a';
        // Edit in B (in place, like the mouse handler), then read A
        hB.value.value = 2100;
        out.afterEditB = { A_read: JSON.parse(JSON.stringify(hA.value)), B_read: JSON.parse(JSON.stringify(hB.value)),
            A_serialize_idx23: nodeA.serialize().widgets_values?.[23], A_serialize_byName: nodeA.serialize().widgets_values_by_name?.dimension_height };
        // Store inspection
        try {
            const stores = window.comfyAPI ? Object.keys(window.comfyAPI) : [];
            out.comfyAPIKeys = stores.filter(k => /widget|store|value/i.test(k));
        } catch (e) { out.storeErr = String(e); }
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
});
