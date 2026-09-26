// @ts-check
// One-off (2026-09-26): under frontend 1.53, in what order do onNodeCreated and
// configure run for a loaded node, and does node.scaleWidgetInstance exist when
// our onConfigure hook (widgets_config.scale restore) runs? PR #59's restore
// side reads node.scaleWidgetInstance there; live it restored defaults.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "hook order"
const { test } = require('@playwright/test');

test('probe: hook order on load (1.53)', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        const T = LiteGraph.registered_node_types['SmartResolutionCalc'];
        const events = [];
        const origCreated = T.prototype.onNodeCreated, origConfigure = T.prototype.configure;
        T.prototype.onNodeCreated = function () { events.push({ ev: 'onNodeCreated:enter', hasScale: !!this.scaleWidgetInstance, nWidgets: this.widgets?.length }); const r = origCreated?.apply(this, arguments); events.push({ ev: 'onNodeCreated:exit', hasScale: !!this.scaleWidgetInstance, nWidgets: this.widgets?.length }); return r; };
        T.prototype.configure = function (info) { events.push({ ev: 'configure:enter', hasScale: !!this.scaleWidgetInstance, nWidgets: this.widgets?.length, hasCfg: !!info?.widgets_config, cfg: info?.widgets_config?.scale ?? null }); const r = origConfigure.apply(this, arguments); events.push({ ev: 'configure:exit', hasScale: !!this.scaleWidgetInstance, steps: this.scaleWidgetInstance ? [this.scaleWidgetInstance.leftStep, this.scaleWidgetInstance.rightStep] : null }); return r; };
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        node.scaleWidgetInstance.leftStep = 0.23; node.scaleWidgetInstance.rightStep = 0.47;
        const wf = app.graph.serialize();
        const wfNode = wf.nodes.find(n => String(n.id) === String(node.id));
        events.push({ ev: 'serialized', cfg: wfNode.widgets_config?.scale ?? null, topKeys: Object.keys(wfNode) });
        events.length = 0; // keep only the load sequence
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        events.push({ ev: 'final', steps: [n2.scaleWidgetInstance?.leftStep, n2.scaleWidgetInstance?.rightStep], ownCfg: n2.widgets_config?.scale ?? null, ext: n2.extensions ?? null });
        T.prototype.onNodeCreated = origCreated; T.prototype.configure = origConfigure;
        return events;
    });
    console.log(JSON.stringify(r, null, 1));
});
