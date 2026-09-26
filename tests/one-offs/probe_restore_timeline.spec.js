// @ts-check
// One-off probe (2026-09-26): is there a late restore that rewrites widget values
// after our configure hook? Sample the height widget's value, its object identity,
// and the widget's identity at several points after loadGraphData, and read the
// frontend's namedValuesRestore flag.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "restore timeline"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: restore timeline after loading the pirate workflow', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        const out = { samples: [] };
        try { out.flag_namedValuesRestore = window.LiteGraph?.namedValuesRestore ?? window.LiteGraph?.LiteGraph?.namedValuesRestore ?? 'n/a'; } catch (e) { out.flagErr = String(e); }
        try { out.setting_namedValuesRestore = app.ui?.settings?.getSettingValue?.('LiteGraph.Widget.NamedValuesRestore') ?? app.extensionManager?.setting?.get?.('LiteGraph.Widget.NamedValuesRestore') ?? 'n/a'; } catch (e) { out.settingErr = String(e); }
        app.graph.clear();
        const t0 = performance.now();
        const p = app.loadGraphData(wf);
        let firstH = null, firstObj = null;
        const sample = (label) => {
            const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
            const h = node?.widgets?.find(w => w.name === 'dimension_height');
            const s = node?.widgets?.find(w => w.name === 'fill_seed');
            if (h && !firstH) { firstH = h; firstObj = h.value; }
            out.samples.push({ label, ms: Math.round(performance.now() - t0), hasNode: !!node,
                height: h ? JSON.parse(JSON.stringify(h.value)) : null, seed: s ? JSON.parse(JSON.stringify(s.value)) : null,
                sameWidget: h ? h === firstH : null, sameValueObj: h ? h.value === firstObj : null,
                valueIsLoadedByName: h && node ? h.value === node.widgets_values_by_name?.dimension_height : null,
                valueIsLoadedNamed: h && node ? h.value === node.widgets_values_named?.dimension_height : null });
        };
        sample('t+0 (sync after loadGraphData call)');
        await p; sample('after await loadGraphData');
        for (const ms of [50, 200, 500, 1000, 2000, 3500]) { await new Promise(r => setTimeout(r, ms - (out.samples.at(-1).ms > ms ? 0 : 0))); sample(`t+~${ms}`); }
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
});
