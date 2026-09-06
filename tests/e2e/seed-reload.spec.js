// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Seed recall after workflow reload (v0.12.3).
 *
 * Exercises the actual configure-time reload path in the live ComfyUI page:
 * builds one or more SmartResolutionCalc nodes, serializes the live graph
 * (app.graph.serialize()), then reloads it with app.loadGraphData(wf) --
 * which recreates node objects exactly the way opening a saved workflow
 * JSON does (see tests/checklists/v0.12.3__Feature__seed-recall-after-reload.md,
 * "Reset between sections"). Verifies hydrateLastSeedFromNode ran during
 * configure, the random-mode readout shows the recovered seed, and a
 * recycle-button click (simulated the way tests/unit/SeedWidget.test.js
 * does) locks it.
 *
 * Requires ComfyUI running at localhost:8188 (playwright.config.js baseURL).
 * Does not queue a prompt; no server-side output files are written.
 */

const SAVED_SEED = 582123831103465;

/**
 * Build one or more SmartResolutionCalc nodes (each tagged via
 * properties._test_tag for post-reload lookup), serialize the live graph,
 * reload it via app.loadGraphData (the same "recreate node objects"
 * mechanism as opening a saved workflow JSON), then read back each tagged
 * node's seed-widget state.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{tag: string, seedWidgetValue: number, randomMode?: boolean, dazzleLastSeed?: any, clearLastSeed?: boolean}>} specs
 */
async function buildAndReload(page, specs) {
    const built = await page.evaluate(async (specs) => {
        const app = window.app;
        app.graph.clear();
        let x = 100;
        for (const spec of specs) {
            const node = LiteGraph.createNode('SmartResolutionCalc');
            if (!node) return { error: `createNode failed for tag ${spec.tag}` };
            node.pos = [x, 100];
            x += 300;
            app.graph.add(node);
            const sw = node.widgets?.find(w => w.name === 'fill_seed');
            if (!sw) return { error: `no fill_seed widget for tag ${spec.tag}` };
            sw.value = { on: true, value: spec.seedWidgetValue };
            if (spec.randomMode && sw.setRandomMode) sw.setRandomMode(true);
            node.properties._test_tag = spec.tag;
            if (Object.prototype.hasOwnProperty.call(spec, 'dazzleLastSeed')) {
                node.properties.dazzle_last_seed = spec.dazzleLastSeed;
            }
            if (spec.clearLastSeed) sw.lastSeed = null;
        }
        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        return { ok: true };
    }, specs);
    if (built.error) return built;

    // app.loadGraphData's promise resolves before the recreated nodes finish
    // rendering (confirmed empirically: _nodes.length is 0 immediately after
    // the await, 1 after ~1s) -- same wait smoke.spec.js uses after loadGraphData.
    await page.waitForTimeout(2000);

    return page.evaluate((specs) => {
        const app = window.app;
        const nodes = app.graph._nodes || [];
        const out = {};
        for (const spec of specs) {
            const n = nodes.find(nn => nn.properties && nn.properties._test_tag === spec.tag);
            if (!n) { out[spec.tag] = { error: 'node missing after reload' }; continue; }
            const sw = n.widgets?.find(w => w.name === 'fill_seed');
            if (!sw) { out[spec.tag] = { error: 'no fill_seed widget after reload' }; continue; }
            out[spec.tag] = {
                nodeId: n.id,
                lastSeed: sw.lastSeed,
                value: JSON.parse(JSON.stringify(sw.value)),
                randomizeMode: sw.randomizeMode,
                display: sw.getDisplayState ? sw.getDisplayState() : null,
                resolveActualSeed: sw.resolveActualSeed ? sw.resolveActualSeed() : null,
            };
        }
        return { out };
    }, specs);
}

/** Boot the page with debug logging on, matching seed-metadata.spec.js. */
async function bootPage(page, consoleLines) {
    page.on('console', msg => consoleLines.push(msg.text()));
    await page.goto('/');
    await page.evaluate(() => {
        localStorage.setItem('DEBUG_SMART_RES_CALC', 'true');
    });
    await page.reload();
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
}

test('reload hydrates lastSeed, preserves random mode, and recycle recovers it', async ({ page }) => {
    const consoleLines = [];
    await bootPage(page, consoleLines);

    const result = await buildAndReload(page, [
        { tag: 'A', seedWidgetValue: -1, randomMode: true, dazzleLastSeed: SAVED_SEED, clearLastSeed: true },
    ]);
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    const a = result.out.A;
    expect(a.error, JSON.stringify(a)).toBeUndefined();

    expect(a.lastSeed).toBe(SAVED_SEED);
    expect(a.value).toEqual({ on: true, value: -1 });
    expect(a.randomizeMode).toBe(true);
    expect(a.display.text).toBe('582123831103465');
    expect(a.display.informational).toBe(true);

    const hydrateLog = consoleLines.some(l => /\[configure\] Node \S+: hydrated lastSeed=582123831103465/.test(l));
    expect(hydrateLog, consoleLines.join('\n')).toBe(true);

    // Simulate the recycle click the way tests/unit/SeedWidget.test.js does.
    const clicked = await page.evaluate(({ tag }) => {
        const app = window.app;
        const n = (app.graph._nodes || []).find(nn => nn.properties && nn.properties._test_tag === tag);
        const sw = n.widgets?.find(w => w.name === 'fill_seed');
        sw.hitAreas.btnRecallLast = { x: 10, y: 0, width: 18, height: 24 };
        sw.mouse({ type: 'pointerdown' }, [15, 12], n);
        return { value: JSON.parse(JSON.stringify(sw.value)), randomizeMode: sw.randomizeMode };
    }, { tag: 'A' });

    expect(clicked.value.value).toBe(SAVED_SEED);
    expect(clicked.randomizeMode).toBe(false);
});

test('reload with -2 (increment) resolves to saved seed + 1', async ({ page }) => {
    const consoleLines = [];
    await bootPage(page, consoleLines);

    const result = await buildAndReload(page, [
        { tag: 'B', seedWidgetValue: -2, dazzleLastSeed: SAVED_SEED, clearLastSeed: true },
    ]);
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    const b = result.out.B;
    expect(b.error, JSON.stringify(b)).toBeUndefined();
    expect(b.resolveActualSeed).toBe(SAVED_SEED + 1);
});

// ---------------------------------------------------------------------
// Edge probes (design doc "Edge cases" / constraint 3 guard verification)
// ---------------------------------------------------------------------

test('edge: a string dazzle_last_seed does not hydrate', async ({ page }) => {
    const consoleLines = [];
    await bootPage(page, consoleLines);

    const result = await buildAndReload(page, [
        { tag: 'STR', seedWidgetValue: -1, dazzleLastSeed: '42', clearLastSeed: true },
    ]);
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(result.out.STR.error, JSON.stringify(result.out.STR)).toBeUndefined();
    expect(result.out.STR.lastSeed).toBeNull();
});

test('edge: a dazzle_last_seed of -1 (special value) does not hydrate', async ({ page }) => {
    const consoleLines = [];
    await bootPage(page, consoleLines);

    const result = await buildAndReload(page, [
        { tag: 'NEG1', seedWidgetValue: -1, dazzleLastSeed: -1, clearLastSeed: true },
    ]);
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(result.out.NEG1.error, JSON.stringify(result.out.NEG1)).toBeUndefined();
    expect(result.out.NEG1.lastSeed).toBeNull();
});

test('edge: two SmartResolutionCalc nodes hydrate independently from their own properties', async ({ page }) => {
    const consoleLines = [];
    await bootPage(page, consoleLines);

    const SEED_X = 111111111111111;
    const SEED_Y = 222222222222222;
    const result = await buildAndReload(page, [
        { tag: 'X', seedWidgetValue: -1, dazzleLastSeed: SEED_X, clearLastSeed: true },
        { tag: 'Y', seedWidgetValue: -1, dazzleLastSeed: SEED_Y, clearLastSeed: true },
    ]);
    expect(result.error, JSON.stringify(result)).toBeUndefined();
    expect(result.out.X.error, JSON.stringify(result.out.X)).toBeUndefined();
    expect(result.out.Y.error, JSON.stringify(result.out.Y)).toBeUndefined();
    expect(result.out.X.lastSeed).toBe(SEED_X);
    expect(result.out.Y.lastSeed).toBe(SEED_Y);
    expect(result.out.X.nodeId).not.toBe(result.out.Y.nodeId);
});
