// @ts-check
// One-off (2026-09-26): does the widget-value store swap a widget's _state after
// our configure (two widgets share the id graph:node:scale)? Track _state identity
// and values at the frontend's configure exit, our configure exit, and later.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "scale state swap"
const { test } = require('@playwright/test');

test('probe: scale state swap', async ({ page }) => {
    const lines = [];
    page.on('console', m => { if (/\[configure\]|Name-based/.test(m.text())) lines.push(m.text().slice(0, 200)); });
    await page.goto('/');
    await page.evaluate(() => { localStorage.setItem('DEBUG_SMART_RES_CALC', 'true'); });
    await page.reload();
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        const T = LiteGraph.registered_node_types['SmartResolutionCalc'];
        const ev = [];
        const states = new Map();
        const read = (n, label) => {
            const s = n.scaleWidgetInstance; const c = n.widgets?.find(w => w.name === 'scale' && w !== s);
            if (!s || !c) { ev.push({ label, missing: true }); return; }
            if (!states.has('s0')) { states.set('s0', s._state); states.set('c0', c._state); }
            ev.push({ label, slider: s.value, carrier: c.value, sliderStateSame: s._state === states.get('s0'), carrierStateSame: c._state === states.get('c0'),
                sliderStateVal: s._state?.value, carrierStateVal: c._state?.value, sliderWidgetId: s.widgetId ?? null, carrierWidgetId: c.widgetId ?? null });
        };
        const base = Object.getPrototypeOf(T.prototype);          // LGraphNode
        const origBase = base.configure;
        base.configure = function (info) { const r = origBase.apply(this, arguments); if (this.comfyClass === 'SmartResolutionCalc') read(this, 'frontend configure:exit'); return r; };
        const origOurs = T.prototype.configure;
        T.prototype.configure = function (info) { const r = origOurs.apply(this, arguments); read(this, 'our configure:exit'); return r; };
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        node.scaleWidgetInstance.value = 1.5; node.scaleWidgetInstance.onValueChanged?.(1.5);
        const wf = app.graph.serialize();
        states.clear(); ev.length = 0;
        const p = app.loadGraphData(wf);
        await p;
        const n2 = () => (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        for (const ms of [0, 50, 300, 1500]) { await new Promise(r => setTimeout(r, ms)); const n = n2(); if (n) read(n, `t+${ms}`); }
        base.configure = origBase; T.prototype.configure = origOurs;
        return ev;
    });
    console.log(JSON.stringify(r, null, 1));
    console.log('debug lines:', JSON.stringify(lines.slice(-6), null, 1));
});
