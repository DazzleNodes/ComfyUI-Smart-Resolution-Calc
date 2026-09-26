// @ts-check
// One-off probe (2026-09-26): reproduce widgets_values_by_name.dimension_height
// going stale (1216) while widgets_values / the prompt carry the live value
// (2100), as seen in output/d3/2026-09-26_04-43-30 _Qwen_image_2-1_1.webp.
// The fresh-node probe (probe_dimension_value_identity) did NOT reproduce it,
// so this one adds the missing step: the node is CONFIGURED from saved data
// (by-name restore assigns the saved object by reference), then edited.
// Also checks whether our serialize hook still runs under 1.53 and whether the
// PR #59 claim (instanceof ScaleWidget fails after adoption) holds live.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "stale after configure"
const { test } = require('@playwright/test');

test('probe: by-name height stale after configure + edit', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        const out = { frontend: window.__COMFYUI_FRONTEND_VERSION__ || null };
        // 1. Build a node, set height 1216, serialize the graph (= "saved workflow")
        app.graph.clear();
        let node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        let h = node.widgets.find(w => w.name === 'dimension_height');
        h.value = { on: true, value: 1216 };
        const saved = app.graph.serialize();
        const savedNode = saved.nodes.find(n => String(n.id) === String(node.id));
        out.saved = { idx23: savedNode.widgets_values?.[23], byName: savedNode.widgets_values_by_name?.dimension_height, hasExt: !!savedNode.extensions };
        // 2. Reload it (= drag-in / File>Open path), like a user would
        await app.loadGraphData(JSON.parse(JSON.stringify(saved)));
        await new Promise(r => setTimeout(r, 2000));
        node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        h = node.widgets.find(w => w.name === 'dimension_height');
        out.afterLoad = { read: JSON.parse(JSON.stringify(h.value)), ctor: h.constructor?.name,
            serializeIsOurs: String(node.serialize).includes('widgets_values_by_name'),
            protoSerializeIsOurs: String(Object.getPrototypeOf(node).serialize || '').includes('widgets_values_by_name'),
            configureIsOurs: String(node.configure).includes('widgets_values_by_name') };
        // 3. Edit the way the mouse handler does (in place), then serialize + prompt
        h.value.value = 2100;
        const ser = node.serialize();
        out.afterEditInPlace = { read: JSON.parse(JSON.stringify(h.value)), idx23: ser.widgets_values?.[23],
            byName: ser.widgets_values_by_name?.dimension_height, ext_byName: ser.extensions?.widgets_values_by_name?.dimension_height,
            named: ser.widgets_values_named?.dimension_height };
        const p = await app.graphToPrompt();
        const wfn = p.workflow.nodes.find(n => String(n.id) === String(node.id));
        out.prompt = { sent: p.output?.[String(node.id)]?.inputs?.dimension_height, wf_idx23: wfn.widgets_values?.[23],
            wf_byName: wfn.widgets_values_by_name?.dimension_height, wf_ext_byName: wfn.extensions?.widgets_values_by_name?.dimension_height };
        // 4. Same, but edit by whole-object assignment
        h.value = { on: true, value: 1500 };
        const ser2 = node.serialize();
        out.afterEditAssign = { idx23: ser2.widgets_values?.[23], byName: ser2.widgets_values_by_name?.dimension_height, ext_byName: ser2.extensions?.widgets_values_by_name?.dimension_height };
        // 5. PR #59 claim: instanceof ScaleWidget after adoption
        const sw = node.scaleWidgetInstance;
        const inList = node.widgets.find(w => w.name === 'scale' && w !== sw) ? 'another "scale" widget exists' : 'only ours';
        out.scale = { retainedCtor: sw?.constructor?.name, retainedProtoChain: (() => { const c = []; let o = sw; while (o && c.length < 4) { o = Object.getPrototypeOf(o); c.push(o?.constructor?.name); } return c; })(),
            retainedIsInWidgets: node.widgets.includes(sw), otherScale: inList,
            widgetsConfig: ser.widgets_config };
        return out;
    });
    console.log(JSON.stringify(r, null, 1));
});
