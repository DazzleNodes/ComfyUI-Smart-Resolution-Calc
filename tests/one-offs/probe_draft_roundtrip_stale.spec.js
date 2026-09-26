// @ts-check
// One-off probe (2026-09-26): can a tab switch (frontend 1.53 rebuilds the node
// from its persisted draft) leave widgets_values_by_name stale relative to
// widgets_values after a later edit? Flow: load pirate workflow -> new blank
// workflow tab -> switch back -> edit height in place -> serialize + prompt.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "draft roundtrip"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: draft round trip then edit', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        const ws = app.extensionManager?.workflow;
        const out = { steps: [] };
        const snap = (label) => {
            const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
            if (!node) { out.steps.push({ label, node: null }); return null; }
            const h = node.widgets.find(w => w.name === 'dimension_height');
            const s = node.serialize();
            out.steps.push({ label, nodeObjId: node.__probeId ??= Math.random().toString(36).slice(2, 7),
                read: JSON.parse(JSON.stringify(h.value)), idx23: s.widgets_values?.[23], byName: s.widgets_values_by_name?.dimension_height,
                named: s.widgets_values_named?.dimension_height, ext: s.extensions?.widgets_values_by_name?.dimension_height,
                ownByName: node.widgets_values_by_name?.dimension_height ?? null });
            return { node, h };
        };
        await app.loadGraphData(JSON.parse(JSON.stringify(wf)));
        await new Promise(r => setTimeout(r, 2000));
        const a = snap('A loaded');
        const wfA = ws?.activeWorkflow;
        // New blank tab
        if (ws?.createTemporary) { const t = await ws.createTemporary(); await ws.openWorkflow(t); } else { await app.loadGraphData({ nodes: [], links: [], version: 0.4 }, true, true, null, {}); }
        await new Promise(r => setTimeout(r, 1500));
        out.tabsAfterNew = ws?.openWorkflows?.length ?? 'n/a';
        // Switch back to A
        if (wfA && ws?.openWorkflow) await ws.openWorkflow(wfA);
        await new Promise(r => setTimeout(r, 2500));
        const b = snap('A after tab round trip');
        out.sameNodeObject = !!(a && b && a.node === b.node);
        if (b) {
            b.h.value.value = 2100;
            snap('A after in-place edit to 2100');
            const p = await app.graphToPrompt();
            const wfn = p.workflow.nodes.find(n => String(n.id) === String(b.node.id));
            out.prompt = { sent: p.output?.[String(b.node.id)]?.inputs?.dimension_height, wf_idx23: wfn?.widgets_values?.[23], wf_byName: wfn?.widgets_values_by_name?.dimension_height, wf_ext: wfn?.extensions?.widgets_values_by_name?.dimension_height };
        }
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
});
