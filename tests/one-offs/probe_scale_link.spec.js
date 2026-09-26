// @ts-check
// One-off (2026-09-26, single-widget design): can the `scale` input take a link on
// frontend 1.53, and what does the posted prompt carry for `scale` when it is linked?
// v0.12.5's queue intercept writes promptInputs.scale = slider value unconditionally,
// which would overwrite a link reference [nodeId, slot].
// No generation: POST /prompt is stubbed and the graph has no output node.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "scale link"
const { test } = require('@playwright/test');

test('probe: scale link', async ({ page }) => {
    const posted = [];
    await page.route(/\/(api\/)?prompt$/, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posted.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ prompt_id: 'probe-stub', number: 0, node_errors: {} }) });
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [400, 100]; app.graph.add(node);
        const prim = LiteGraph.createNode('PrimitiveFloat'); prim.pos = [50, 100]; app.graph.add(prim);
        await new Promise(r => setTimeout(r, 300));
        const out = {};
        out.inputs = (node.inputs || []).map(i => ({ name: i.name, type: i.type, widget: i.widget?.name ?? null }));
        out.scaleWidgets = node.widgets.filter(w => w.name === 'scale' || w.name === 'scale#1').map(w => ({ name: w.name, type: w.type, isSlider: w === node.scaleWidgetInstance, serialize: w.serialize ?? null }));
        const slot = (node.inputs || []).findIndex(i => i.name === 'scale');
        out.scaleSlot = slot;
        if (slot >= 0) {
            const pw = prim.widgets?.find(w => w.name === 'value'); if (pw) pw.value = 2.5;
            const link = prim.connect(0, node, slot);
            out.linked = !!link;
        }
        node.scaleWidgetInstance.value = 1.5; node.scaleWidgetInstance.onValueChanged?.(1.5);
        const p = await app.graphToPrompt();
        out.graphToPromptScale = p.output?.[String(node.id)]?.inputs?.scale ?? null;
        try { await app.queuePrompt(0, 1); } catch (e) { out.queueErr = String(e).slice(0, 120); }
        return { out, nodeId: String(node.id) };
    });
    await page.waitForTimeout(500);
    const postedScale = posted.length ? posted[posted.length - 1].prompt?.[r.nodeId]?.inputs?.scale : 'no POST';
    console.log(JSON.stringify({ ...r.out, postedScale }, null, 1));
});
