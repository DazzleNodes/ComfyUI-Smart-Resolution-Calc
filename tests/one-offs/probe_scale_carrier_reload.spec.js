// @ts-check
// One-off (2026-09-26): after a save/load the scale slider and its hidden
// carrier both read 1 although the file carried 1.5. Instrument the reload:
// values at configure enter/exit, after our hooks, and later; shared _state?
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "scale carrier reload"
const { test } = require('@playwright/test');

test('probe: scale carrier reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        const T = LiteGraph.registered_node_types['SmartResolutionCalc'];
        const ev = [];
        const read = (n, label) => { const c = n.widgets?.find(w => w.name === 'scale' && w !== n.scaleWidgetInstance); const s = n.scaleWidgetInstance; ev.push({ label, carrier: c?.value ?? null, slider: s?.value ?? null, sharedState: !!(c && s && c._state && c._state === s._state), carrierType: c?.type ?? null, nWidgets: n.widgets?.length }); };
        const origConfigure = T.prototype.configure;
        T.prototype.configure = function (info) { read(this, 'configure:enter'); ev.push({ label: 'info.widgets_values_named.scale', v: info?.widgets_values_named?.scale ?? null, wv: (info?.widgets_values || []).slice(0, 10) }); const r = origConfigure.apply(this, arguments); read(this, 'configure:exit'); return r; };
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        node.scaleWidgetInstance.value = 1.5; node.scaleWidgetInstance.onValueChanged?.(1.5);
        read(node, 'before save');
        const wf = app.graph.serialize();
        const wn = wf.nodes.find(n => String(n.id) === String(node.id));
        ev.push({ label: 'saved', namedScale: wn.widgets_values_named?.scale, widgets_values: wn.widgets_values.slice(0, 10) });
        ev.length = 0;
        await app.loadGraphData(wf);
        const n2 = () => (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        for (const ms of [50, 300, 1000, 2500]) { await new Promise(r => setTimeout(r, ms)); const n = n2(); if (n) read(n, `t+${ms}`); }
        T.prototype.configure = origConfigure;
        return ev;
    });
    console.log(JSON.stringify(r, null, 1));
});
