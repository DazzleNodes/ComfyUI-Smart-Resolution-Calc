// @ts-check
// One-off probe (2026-09-26): trace exactly what our serialize hook reads for
// dimension_height when its output (2100) disagrees with the widget (1216).
// Wraps the node's widget objects in logging proxies, calls the real hook via
// a proxied `this`, and also dumps the whole by-name map vs a replica loop.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "hook read trace"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: hook read trace', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        const out = {};
        out.openTabs = app.extensionManager?.workflow?.openWorkflows?.length ?? 'n/a';
        await app.loadGraphData(JSON.parse(JSON.stringify(wf)));
        await new Promise(r => setTimeout(r, 2000));
        const graphs = new Set(); for (const w of (app.extensionManager?.workflow?.openWorkflows || [])) { try { graphs.add(w.changeTracker?.activeState ? 'has-state' : 'no-state'); } catch (e) {} }
        const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const allSRC = (app.graph._nodes || []).filter(n => n.comfyClass === 'SmartResolutionCalc').length;
        out.srcNodesInActiveGraph = allSRC;
        const h = node.widgets.find(w => w.name === 'dimension_height');
        out.directRead = JSON.parse(JSON.stringify(h.value));
        // Replica of our hook loop on node.widgets
        const rep = {}; node.widgets.forEach(w => { if (w.value !== undefined) rep[w.name] = w.value; });
        out.replica_height = JSON.parse(JSON.stringify(rep.dimension_height));
        // Real hook output
        const s = node.serialize();
        out.hook_height = s.widgets_values_by_name?.dimension_height;
        out.hook_idx23 = s.widgets_values?.[23];
        // Trace: proxy every widget's `value` read, and proxy `this.widgets`
        const reads = [];
        const spyWidgets = node.widgets.map(w => new Proxy(w, { get(t, k, rcv) { const v = Reflect.get(t, k, t); if (k === 'value' && t.name === 'dimension_height') reads.push({ via: 'proxy', val: JSON.parse(JSON.stringify(v ?? null)) }); return typeof v === 'function' ? v.bind(t) : v; } }));
        const proxyNode = new Proxy(node, { get(t, k) { if (k === 'widgets') return spyWidgets; const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; } });
        let traced = null, tracedErr = null;
        try { const s2 = Object.getPrototypeOf(node).serialize.call(proxyNode); traced = { byName: s2.widgets_values_by_name?.dimension_height, idx23: s2.widgets_values?.[23] }; } catch (e) { tracedErr = String(e); }
        out.traced = traced; out.tracedErr = tracedErr; out.readsDuringTrace = reads;
        // Is the by-name map keyed by name colliding? count widgets per name in node.widgets
        const counts = {}; node.widgets.forEach(w => counts[w.name] = (counts[w.name] || 0) + 1);
        out.dupCounts = Object.fromEntries(Object.entries(counts).filter(([, c]) => c > 1));
        // Does the frontend expose the widget-value store value for this widgetId?
        try {
            const pinia = app.$pinia || window.__pinia || null;
            out.piniaStores = pinia ? Object.keys(pinia._s || {}).filter(k => /widget/i.test(k)) : 'n/a';
            const store = pinia?._s?.get?.('widgetValue') || pinia?._s?.get?.('widgetValueStore') || null;
            if (store && h.widgetId) { const g = store.getWidget?.(h.widgetId); out.storeValue = g ? JSON.parse(JSON.stringify(g.value ?? null)) : 'no entry'; }
        } catch (e) { out.storeErr = String(e); }
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
});
