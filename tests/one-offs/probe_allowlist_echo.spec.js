// @ts-check
// One-off (2026-09-26): does frontend 1.53's graph serializer drop the keys our
// node.serialize hook adds (allowlist) and re-emit keys it LOADED from a file
// (echo)? If so, U1 is explained: the stale by-name block in the pirate image
// is the loaded file's block echoed by the frontend, never our fresh one.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "allowlist echo"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: allowlist and echo in graph-level serialization', async ({ page }) => {
    const pirate = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async ({ pirate }) => {
        const app = window.app;
        const out = {};
        const T = LiteGraph.registered_node_types['SmartResolutionCalc'];
        let lastInfoKeys = null;
        const origConfigure = T.prototype.configure;
        T.prototype.configure = function (info) { lastInfoKeys = Object.keys(info); return origConfigure.apply(this, arguments); };

        // Case 1: fresh node, steps changed, then graph-level serialize and prompt
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        node.scaleWidgetInstance.leftStep = 0.23;
        const direct = node.serialize();
        const g = app.graph.serialize();
        const gn = g.nodes.find(n => String(n.id) === String(node.id));
        const p = await app.graphToPrompt();
        const pn = p.workflow.nodes.find(n => String(n.id) === String(node.id));
        out.fresh = { directKeys: Object.keys(direct), graphKeys: Object.keys(gn), promptWfKeys: Object.keys(pn),
            graph_has_byName: 'widgets_values_by_name' in gn, graph_has_cfg: 'widgets_config' in gn, graph_ext: gn.extensions ?? null };
        await app.loadGraphData(g); await new Promise(r => setTimeout(r, 1500));
        out.fresh.configureInfoKeys = lastInfoKeys;

        // Case 2: the pirate file (has our keys at top level and under extensions)
        lastInfoKeys = null;
        app.graph.clear();
        await app.loadGraphData(JSON.parse(JSON.stringify(pirate))); await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        out.pirate = { configureInfoKeys: lastInfoKeys, ownUnknownProps: ['widgets_values_by_name', 'widgets_config', 'widgets_values_named', 'extensions'].filter(k => Object.prototype.hasOwnProperty.call(n2, k)) };
        // Edit height, then graph-level serialize: is the loaded (stale) by-name echoed?
        const h = n2.widgets.find(w => w.name === 'dimension_height'); h.value.value = 2100;
        const g2 = app.graph.serialize(); const gn2 = g2.nodes.find(n => String(n.id) === String(n2.id));
        out.pirate.after_edit = { graph_idx23: gn2.widgets_values?.[23], graph_named: gn2.widgets_values_named?.dimension_height,
            graph_byName_top: gn2.widgets_values_by_name?.dimension_height ?? null, graph_ext_byName: gn2.extensions?.widgets_values_by_name?.dimension_height ?? null,
            graph_cfg_top: gn2.widgets_config ?? null, graph_ext_cfg: gn2.extensions?.widgets_config ?? null, graphKeys: Object.keys(gn2) };
        T.prototype.configure = origConfigure;
        return out;
    }, { pirate });
    console.log(JSON.stringify(r, null, 1));
});
