// @ts-check
// Tester sweep (2026-09-26), extending v0.12.5__Feature__frontend-1.53-widget-restore.md
// Edge cases beyond the checklist: two nodes' independent scale/steps, an untouched
// default-1.0x node, double loadGraphData of the same workflow, and console/page
// errors across the sweep.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "edge:"
const { test, expect } = require('@playwright/test');

// Errors already present on a clean boot: unrelated third-party extension
// failures and resource 404s, none naming SmartResCalc. Confirmed against the
// same baseline as tests/e2e/smoke.spec.js (which also sees ArtVenture.Upload
// and efficiency.widgethider errors on a clean load) plus this run's own
// observed noise (ComfyUI-Impact-Pack, comfyui_layerstyle, vite preload/404s).
// Only errors mentioning SmartResCalc/dazzle/scaleWidget content are ours to answer for.
function isKnownBenign(text) {
    if (/smartrescalc|dazzle|scalewidget/i.test(text)) return false;
    const benignPatterns = [
        /ArtVenture\.Upload/,
        /efficiency\.widgethider/,
        /Failed to load resource: the server responded with a status of 404/,
        /\[vite:preloadError\]/,
        /ComfyApp graph accessed before initialization/,
    ];
    return benignPatterns.some(re => re.test(text));
}

async function boot(page) {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
}

test('edge: two SmartResCalc nodes keep independent scale and step sizes across save/load', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error' && !isKnownBenign(msg.text())) consoleErrors.push(msg.text()); });
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const a = LiteGraph.createNode('SmartResolutionCalc'); a.pos = [100, 100]; app.graph.add(a);
        const b = LiteGraph.createNode('SmartResolutionCalc'); b.pos = [500, 100]; app.graph.add(b);
        await new Promise(r => setTimeout(r, 300));

        const swA = a.scaleWidgetInstance, swB = b.scaleWidgetInstance;
        swA.value = 1.5; swA.onValueChanged?.(swA.value);
        swA.leftStep = 0.21; swA.onStepsChanged?.();
        swA.rightStep = 0.42; swA.onStepsChanged?.();

        swB.value = 3.0; swB.onValueChanged?.(swB.value);
        swB.leftStep = 0.07; swB.onStepsChanged?.();
        swB.rightStep = 0.14; swB.onStepsChanged?.();

        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const nodes = (app.graph._nodes || []).filter(n => n.comfyClass === 'SmartResolutionCalc')
            .sort((x, y) => x.id - y.id);
        return nodes.map(n => ({
            id: n.id,
            scale: n.scaleWidgetInstance?.value,
            leftStep: n.scaleWidgetInstance?.leftStep,
            rightStep: n.scaleWidgetInstance?.rightStep,
        }));
    });
    console.log(JSON.stringify(r));
    expect(r.length).toBe(2);
    expect(r).toEqual(expect.arrayContaining([
        expect.objectContaining({ scale: 1.5, leftStep: 0.21, rightStep: 0.42 }),
        expect.objectContaining({ scale: 3.0, leftStep: 0.07, rightStep: 0.14 }),
    ]));
    // The two nodes' values must not have swapped or merged
    expect(r[0].scale).not.toBe(r[1].scale);
    expect(consoleErrors, `unexpected console errors: ${JSON.stringify(consoleErrors)}`).toEqual([]);
});

test('edge: a node left at default scale 1.0x round-trips with no dazzle_scale_steps written and default step sizes intact', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        // Untouched: no value change, no step change.
        const wf = app.graph.serialize();
        const savedNode = wf.nodes.find(n => String(n.id) === String(node.id));
        const savedSteps = savedNode?.properties?.dazzle_scale_steps ?? null;
        const savedScale = savedNode?.widgets_values_named?.scale ?? null;
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const sw2 = n2.scaleWidgetInstance;
        return {
            savedSteps, savedScale,
            restoredScale: sw2?.value,
            restoredSteps: { leftStep: sw2?.leftStep, rightStep: sw2?.rightStep },
        };
    });
    console.log(JSON.stringify(r));
    expect(r.savedSteps).toBeNull();          // never touched -> onStepsChanged never fired -> nothing written
    expect(r.savedScale).toBe(1.0);
    expect(r.restoredScale).toBe(1.0);
    expect(r.restoredSteps).toEqual({ leftStep: 0.05, rightStep: 0.1 });   // constructor defaults
});

test('edge: loading the same workflow twice in a row leaves exactly one node with the same values, no errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const h = node.widgets.find(w => w.name === 'dimension_height');
        h.value = { on: true, value: 1600 };
        const sw = node.scaleWidgetInstance;
        sw.value = 1.3; sw.onValueChanged?.(sw.value);
        const wf = app.graph.serialize();

        let firstLoadError = null, secondLoadError = null;
        try { await app.loadGraphData(wf); } catch (e) { firstLoadError = String(e); }
        await new Promise(r => setTimeout(r, 1500));
        const countAfterFirst = (app.graph._nodes || []).filter(n => n.comfyClass === 'SmartResolutionCalc').length;

        try { await app.loadGraphData(wf); } catch (e) { secondLoadError = String(e); }
        await new Promise(r => setTimeout(r, 1500));
        const nodesAfterSecond = (app.graph._nodes || []).filter(n => n.comfyClass === 'SmartResolutionCalc');

        return {
            firstLoadError, secondLoadError,
            countAfterFirst,
            countAfterSecond: nodesAfterSecond.length,
            height: nodesAfterSecond[0] ? JSON.parse(JSON.stringify(nodesAfterSecond[0].widgets.find(w => w.name === 'dimension_height').value)) : null,
            scale: nodesAfterSecond[0]?.scaleWidgetInstance?.value,
        };
    });
    console.log(JSON.stringify(r));
    expect(r.firstLoadError).toBeNull();
    expect(r.secondLoadError).toBeNull();
    expect(r.countAfterFirst).toBe(1);
    expect(r.countAfterSecond).toBe(1);       // re-loading the same workflow replaces, doesn't duplicate
    expect(r.height).toEqual({ on: true, value: 1600 });
    expect(r.scale).toBe(1.3);
    expect(pageErrors, `unexpected page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
});
