// @ts-check
// One-off probe (2026-09-26): why does widgets_values_by_name.dimension_height go
// stale under frontend 1.53 while widgets_values / the prompt carry the live value?
// Hypothesis: toConcreteWidget adoption swaps the DimensionWidget prototype and
// redefines `value`, so our in-place mutation (this.value.value = N) and the
// serializer's widget.value read different objects.
// Read-only apart from an in-page graph build. Run:
//   npx playwright test --config tests/one-offs/playwright.probe.config.js -g "dimension value identity"
const { test } = require('@playwright/test');

test('probe: dimension value identity under widget adoption', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        const out = { frontend: window.__COMFYUI_FRONTEND_VERSION__ || null };
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const names = node.widgets.map(w => w.name);
        out.widgetNames = names;
        out.dupNames = names.filter((n, i) => names.indexOf(n) !== i);
        const h = node.widgets.find(w => w.name === 'dimension_height');
        const desc = Object.getOwnPropertyDescriptor(h, 'value');
        out.height = {
            ctor: h.constructor?.name, protoCtor: Object.getPrototypeOf(h)?.constructor?.name,
            ownValueDesc: desc ? { get: !!desc.get, set: !!desc.set, writable: desc.writable, isObj: typeof desc.value === 'object' } : null,
            type: h.type, hasSerializeValue: typeof h.serializeValue === 'function',
            valueBefore: JSON.parse(JSON.stringify(h.value)),
        };
        // Mutate the way DimensionWidget's mouse handler does (in place)
        const objBefore = h.value;
        h.value.value = 2100; h.value.on = true;
        const objAfter = h.value;
        out.height.sameObjectAfterInPlaceMutation = objBefore === objAfter;
        out.height.valueReadBack = JSON.parse(JSON.stringify(h.value));
        const ser = node.serialize();
        out.serialize = {
            idx: ser.widgets_values, byName_height: ser.widgets_values_by_name?.dimension_height,
            named_height: ser.widgets_values_named?.dimension_height, ext_byName_height: ser.extensions?.widgets_values_by_name?.dimension_height,
        };
        const p = await app.graphToPrompt();
        out.prompt_height = p.output?.[String(node.id)]?.inputs?.dimension_height;
        const wfn = p.workflow.nodes.find(n => String(n.id) === String(node.id));
        out.wfSnapshot = { idx23: wfn.widgets_values?.[23], byName_height: wfn.widgets_values_by_name?.dimension_height };
        // Now mutate by whole-object assignment and compare
        h.value = { on: true, value: 1500 };
        const ser2 = node.serialize();
        out.afterAssign = { byName_height: ser2.widgets_values_by_name?.dimension_height, idx23: ser2.widgets_values?.[23], read: JSON.parse(JSON.stringify(h.value)) };
        // Store view, if present
        try {
            const store = window.comfyAPI?.widgetValueStore || null;
            out.storeApi = store ? Object.keys(store).slice(0, 10) : null;
        } catch (e) { out.storeErr = String(e); }
        return out;
    });
    console.log(JSON.stringify(r, null, 1));
});
