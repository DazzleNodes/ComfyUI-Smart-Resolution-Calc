// @ts-check
// One-off (2026-09-26): after a reload, assigning 1.5 to the two "scale" widgets
// seems not to stick. Assign by hand after configure and read back at once;
// capture console errors; inspect the carrier's options and value descriptor.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "scale setter"
const { test } = require('@playwright/test');

test('probe: scale setter', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (/error|Error|DataClone|structuredClone/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        node.scaleWidgetInstance.value = 1.5; node.scaleWidgetInstance.onValueChanged?.(1.5);
        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n = (app.graph._nodes || []).find(x => x.comfyClass === 'SmartResolutionCalc');
        const s = n.scaleWidgetInstance;
        const c = n.widgets.find(w => w.name === 'scale' && w !== s);
        const out = { afterLoad: { carrier: c.value, slider: s.value } };
        const desc = (o) => { const d = Object.getOwnPropertyDescriptor(o, 'value'); return d ? { get: !!d.get, set: !!d.set, src: d.set ? String(d.set).slice(0, 160) : null } : 'no own'; };
        out.carrierDesc = desc(c); out.sliderDesc = desc(s);
        out.carrierOptions = c.options ? { min: c.options.min, max: c.options.max, step: c.options.step, precision: c.options.precision, round: c.options.round } : null;
        out.carrierCtor = c.constructor?.name; out.carrierType = c.type;
        // Hand assignment right now
        c.value = 1.5; s.value = 1.5;
        out.afterHandAssign = { carrier: c.value, slider: s.value };
        // Try through the frontend's own setter if the carrier has setValue
        if (typeof c.setValue === 'function') { try { c.setValue(1.5); out.afterSetValue = c.value; } catch (e) { out.setValueErr = String(e); } }
        // Does node.widgets give the same objects on re-read?
        out.sameOnReread = n.widgets.find(w => w.name === 'scale' && w !== n.scaleWidgetInstance) === c;
        // What does structuredClone do to the named block object the frontend hands configure? (simulate)
        try { structuredClone(wf.nodes[0].widgets_values_named); out.cloneWf = 'ok'; } catch (e) { out.cloneWf = String(e); }
        return out;
    });
    console.log(JSON.stringify(r, null, 1));
    console.log('console errors:', JSON.stringify(errors.slice(0, 8), null, 1));
});
