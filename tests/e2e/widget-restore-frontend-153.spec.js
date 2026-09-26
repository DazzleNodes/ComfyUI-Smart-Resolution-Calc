// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Widget restore under a 1.5x frontend (v0.12.5).
 *
 * Fixture: the workflow embedded in an image generated 2026-09-26 under
 * frontend 1.53.6 (`tests/e2e/fixtures/frontend-1.53-stale-by-name-workflow.json`).
 * Its SmartResCalc node (id 473) carries height 2100 and a random seed in the
 * frontend's `widgets_values` / `widgets_values_named`, but height 1216 and a
 * LOCKED seed 333670668065774 in our stale `widgets_values_by_name`. Before
 * the fix, our by-name restore ran last and won: the node showed 1216 and
 * reused the wrong seed on the next queue.
 *
 * No generation, no images: load, read, serialize.
 * Requires ComfyUI at localhost:8188 with a 1.5x frontend.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'frontend-1.53-stale-by-name-workflow.json');
const NODE_ID = '473';

async function boot(page) {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
}

test('loading a 1.53 workflow restores the frontend-consistent values, not our stale by-name block', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
    await boot(page);
    const r = await page.evaluate(async ({ wf, id }) => {
        const app = window.app;
        app.graph.clear();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const node = (app.graph._nodes || []).find(n => String(n.id) === id && n.comfyClass === 'SmartResolutionCalc');
        if (!node) return { error: 'node 473 not found' };
        const h = node.widgets.find(w => w.name === 'dimension_height');
        const s = node.widgets.find(w => w.name === 'fill_seed');
        const ser = node.serialize();
        // The saved file goes through the graph serializer, which on 1.5x echoes any
        // unknown key it was loaded with; our stale block must not come back that way.
        const fileNode = app.graph.serialize().nodes.find(n => String(n.id) === id);
        return {
            fileHasByName: Object.prototype.hasOwnProperty.call(fileNode, 'widgets_values_by_name')
                || !!fileNode.extensions?.widgets_values_by_name,
            frontend: window.__COMFYUI_FRONTEND_VERSION__ || null,
            frontendWritesNamed: !!ser.widgets_values_named,
            height: JSON.parse(JSON.stringify(h.value)),
            seed: JSON.parse(JSON.stringify(s.value)), randomizeMode: s.randomizeMode, lastSeed: s.lastSeed ?? null,
            serializedHasByName: Object.prototype.hasOwnProperty.call(ser, 'widgets_values_by_name'),
            serializedNamedHeight: ser.widgets_values_named?.dimension_height,
            serializedIdx23: ser.widgets_values?.[23],
        };
    }, { wf, id: NODE_ID });
    console.log(JSON.stringify(r));
    expect(r.error).toBeUndefined();
    test.skip(!r.frontendWritesNamed, 'this ComfyUI frontend does not write widgets_values_named; the precedence path is not exercised');
    expect(r.height).toEqual({ on: true, value: 2100 });            // was 1216
    expect(r.seed).toEqual({ on: true, value: -1 });                // was locked 333670668065774
    expect(r.randomizeMode).toBe(true);
    expect(r.lastSeed).toBe(601245609123048);                       // recall buffer from the property (0.12.3)
    expect(r.serializedHasByName).toBe(false);                      // no duplicate block on a 1.5x frontend
    expect(r.fileHasByName).toBe(false);                            // and no stale echo of the loaded one in the saved file
    expect(r.serializedNamedHeight).toEqual({ on: true, value: 2100 });   // the frontend's own block carries the live value
});

test('the scale slider reaches Python as `scale` and survives save/load (no scale#1 duplicate)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const sw = node.scaleWidgetInstance;
        const h = node.widgets.find(w => w.name === 'dimension_height');
        h.value = { on: true, value: 1400 };
        // Change the slider the way the mouse handler does (value + change hook)
        sw.value = 1.5; sw.onValueChanged?.(sw.value);
        const p = await app.graphToPrompt();
        const inputs = p.output?.[String(node.id)]?.inputs || {};
        const wfNode = p.workflow.nodes.find(n => String(n.id) === String(node.id));
        const before = { promptScale: inputs.scale, promptScale1: inputs['scale#1'] ?? null, promptModeStatus1: inputs['mode_status#1'] ?? null,
            namedScale: wfNode.widgets_values_named?.scale, namedScale1: wfNode.widgets_values_named?.['scale#1'] ?? null };
        // Save/load round trip
        await app.loadGraphData(app.graph.serialize());
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const h2 = n2.widgets.find(w => w.name === 'dimension_height');
        const carrier = n2.widgets.find(w => w.name === 'scale' && w !== n2.scaleWidgetInstance);
        return { before, after: { slider: n2.scaleWidgetInstance?.value, carrier: carrier?.value ?? null, height: JSON.parse(JSON.stringify(h2.value)) } };
    });
    console.log(JSON.stringify(r));
    expect(r.before.promptScale).toBe(1.5);           // was 1.0 (the hidden default) on 1.5x frontends
    // graphToPrompt may still list `scale#1` / `mode_status#1`; the queue intercept
    // (app.api.queuePrompt) strips them and Python ignores undeclared inputs anyway.
    expect(r.before.namedScale).toBe(1.5);
    expect(r.before.namedScale1).toBeNull();
    expect(r.after.slider).toBe(1.5);
    expect(r.after.carrier).toBe(1.5);
    expect(r.after.height).toEqual({ on: true, value: 1400 });   // positional restore still aligned with a non-serialized widget in the array
});

test('a file saved by a 1.5x frontend before v0.12.5 (slider stored as scale#1) restores the slider value', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const wf = app.graph.serialize();
        const wn = wf.nodes.find(n => String(n.id) === String(node.id));
        // Pre-v0.12.5 shape on 1.5x: carrier "scale" = 1 (never updated), slider "scale#1" = user's 1.5
        wn.widgets_values_named.scale = 1;
        wn.widgets_values_named['scale#1'] = 1.5;
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const carrier = n2.widgets.find(w => w.name === 'scale' && w !== n2.scaleWidgetInstance);
        return { slider: n2.scaleWidgetInstance?.value, carrier: carrier?.value ?? null, sliderName: n2.scaleWidgetInstance?.name };
    });
    console.log(JSON.stringify(r));
    test.skip(r.sliderName === 'scale', 'this frontend does not rename duplicate widgets; the scale#1 shape cannot occur');
    expect(r.slider).toBe(1.5);
    expect(r.carrier).toBe(1.5);
});

test('the queued prompt carries the slider value as `scale` when set without any change hook, and no #1 inputs', async ({ page }) => {
    // No generation: POST /api/prompt is answered by this stub and never reaches the
    // server. The graph also has no output node, so the server would reject it anyway.
    const posted = [];
    await page.route(/\/(api\/)?prompt$/, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posted.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ prompt_id: 'redgreen-stub', number: 0, node_errors: {} }) });
    });
    await boot(page);
    const nodeId = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        // Set the slider WITHOUT its change hook (another extension, a script, a missed
        // path): the carrier still says 1.0, so only the queue-time patch can fix it.
        node.scaleWidgetInstance.value = 1.5;
        try { await app.queuePrompt(0, 1); } catch (e) { /* stubbed response shape may not satisfy every caller */ }
        return String(node.id);
    });
    await page.waitForTimeout(500);
    expect(posted.length, 'no POST /prompt was captured').toBeGreaterThan(0);
    const inputs = posted[posted.length - 1].prompt?.[nodeId]?.inputs || {};
    console.log(JSON.stringify({ scale: inputs.scale, keys: Object.keys(inputs).filter(k => k.includes('#')) }));
    expect(inputs.scale).toBe(1.5);
    expect(inputs['scale#1']).toBeUndefined();
    expect(inputs['mode_status#1']).toBeUndefined();
});

test('a link into `scale` reaches the queued prompt as the link, not the slider value', async ({ page }) => {
    // CONSEQUENCE: 6 (behaviour) -- a linked scale drives the output; the slider neither overrides nor edits it.
    // No generation: POST /api/prompt is stubbed, and the graph has no output node.
    const posted = [];
    await page.route(/\/(api\/)?prompt$/, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posted.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ prompt_id: 'linked-scale-stub', number: 0, node_errors: {} }) });
    });
    await boot(page);
    const ids = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [400, 100]; app.graph.add(node);
        const prim = LiteGraph.createNode('PrimitiveFloat'); prim.pos = [50, 100]; app.graph.add(prim);
        await new Promise(r => setTimeout(r, 300));
        const slot = (node.inputs || []).findIndex(i => i.name === 'scale');
        if (slot < 0) return { error: 'no scale input socket' };
        const pw = prim.widgets?.find(w => w.name === 'value'); if (pw) pw.value = 2.5;
        if (!prim.connect(0, node, slot)) return { error: 'link failed' };
        node.scaleWidgetInstance.value = 1.5;
        // While linked, the slider does not take a drag
        const before = node.scaleWidgetInstance.value;
        const handled = node.scaleWidgetInstance.mouse({ type: 'pointerdown' }, [200, 5], node);
        const afterMouse = node.scaleWidgetInstance.value;
        try { await app.queuePrompt(0, 1); } catch (e) { /* stubbed response */ }
        return { nodeId: String(node.id), primId: String(prim.id), handled, unchanged: before === afterMouse,
                 linked: node.scaleWidgetInstance.isLinked?.(node) ?? null };
    });
    expect(ids.error).toBeUndefined();
    expect(ids.linked).toBe(true);
    expect(ids.handled).toBe(false);
    expect(ids.unchanged).toBe(true);
    await page.waitForTimeout(500);
    expect(posted.length, 'no POST /prompt was captured').toBeGreaterThan(0);
    const inputs = posted[posted.length - 1].prompt?.[ids.nodeId]?.inputs || {};
    console.log(JSON.stringify({ scale: inputs.scale }));
    expect(inputs.scale).toEqual([ids.primId, 0]);
});

test('custom scale step sizes survive save/load (stored in node.properties, PR #59 + #60)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc'); node.pos = [100, 100]; app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const sw = node.scaleWidgetInstance;
        // Change the steps the way the settings-panel handlers do (assignment + change hook)
        sw.leftStep = 0.23; sw.onStepsChanged?.();
        sw.rightStep = 0.47; sw.onStepsChanged?.();
        // No node.serialize() call here: a 1.5x save goes through the graph serializer only,
        // and an earlier probe passed solely because it called node.serialize() first.
        const wf = app.graph.serialize();
        const saved = wf.nodes.find(n => String(n.id) === String(node.id))?.properties?.dazzle_scale_steps ?? null;
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        return { saved, restored: { leftStep: n2.scaleWidgetInstance?.leftStep, rightStep: n2.scaleWidgetInstance?.rightStep } };
    });
    console.log(JSON.stringify(r));
    expect(r.saved).toEqual({ leftStep: 0.23, rightStep: 0.47 });
    expect(r.restored).toEqual({ leftStep: 0.23, rightStep: 0.47 });
});

test('the shipped example workflow (older by-name shape) restores its scale onto the slider', async ({ page }) => {
    // CONSEQUENCE: 6 (behaviour) -- files saved before 1.5x frontends restore their values, scale included.
    // Also covers the by-name fallback path (the separate by-name-only test was merged in here).
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'workflow', 'SmartResCalc-Test-Script.json'), 'utf-8'));
    const saved = wf.nodes.find(n => n.type === 'SmartResolutionCalc');
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);
    const r = await page.evaluate(async ({ wf, id }) => {
        const app = window.app;
        app.graph.clear();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n = (app.graph._nodes || []).find(x => String(x.id) === id);
        const native = n.widgets.find(w => w.name === 'scale');
        const height = n.widgets.find(w => w.name === 'dimension_height');
        const p = await app.graphToPrompt();
        return { slider: n.scaleWidgetInstance?.value, native: native?.value,
                 height: JSON.parse(JSON.stringify(height.value)),
                 promptScale: p.output?.[id]?.inputs?.scale,
                 steps: { l: n.scaleWidgetInstance?.leftStep, r: n.scaleWidgetInstance?.rightStep },
                 names: n.widgets.map(w => w.name).filter(x => /scale|mode_status/.test(x)) };
    }, { wf, id: String(saved.id) });
    console.log(JSON.stringify(r));
    expect(errors.filter(e => /smart|scale|dazzle/i.test(e))).toEqual([]);
    expect(r.height).toEqual(saved.widgets_values_by_name.dimension_height);   // {on:false, value:1200}
    expect(r.native).toBe(saved.widgets_values_by_name.scale);   // 1.1 in this file
    expect(r.slider).toBe(r.native);
    expect(r.promptScale).toBe(r.native);
    expect(r.steps).toEqual({ l: 0.05, r: 0.1 });
    expect(r.names.filter(x => x.includes('#'))).toEqual([]);     // no renamed duplicates
});

