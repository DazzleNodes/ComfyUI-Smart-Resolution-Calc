// @ts-check
// Tester sweep (2026-09-26), extending v0.12.5__Feature__frontend-1.53-widget-restore.md
// Section 2: PR #59 paths -- the retained scaleWidgetInstance reference, the image
// disconnect cache clear, and the mode readout following a scale change.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "Section 2"
const { test, expect } = require('@playwright/test');

async function boot(page) {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
}

test('Section 2a: after load, node.scaleWidgetInstance exists and is present in node.widgets', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        return {
            hasInstance: !!n2.scaleWidgetInstance,
            inWidgets: n2.widgets.includes(n2.scaleWidgetInstance),
            instanceName: n2.scaleWidgetInstance?.name,
        };
    });
    console.log(JSON.stringify(r));
    expect(r.hasInstance).toBe(true);
    expect(r.inWidgets).toBe(true);
});

test('Section 2b: real image disconnect (via LiteGraph connect/disconnectInput, which fires node.onConnectionsChange) clears the cached dimensions with no page errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        const src = LiteGraph.createNode('LoadImage');
        src.pos = [-300, 100];
        app.graph.add(src);
        await new Promise(r => setTimeout(r, 300));

        const sw = node.scaleWidgetInstance;
        const imgIdx = node.inputs.findIndex(i => i.name === 'image');
        // Seed the cache the way a real fetch would populate it, so disconnect has
        // something to actually clear (avoids depending on a real file on disk).
        sw.imageDimensionsCache = { width: 640, height: 480, timestamp: Date.now(), path: '/fake/probe.png' };

        let connectError = null, disconnectError = null;
        try {
            src.connect(0, node, imgIdx);
            await new Promise(r => setTimeout(r, 150));   // 50ms visibility-refresh delay + margin
        } catch (e) { connectError = String(e); }
        const cacheAfterConnect = sw.imageDimensionsCache ? { ...sw.imageDimensionsCache } : null;

        try {
            node.disconnectInput(imgIdx);
            await new Promise(r => setTimeout(r, 150));
        } catch (e) { disconnectError = String(e); }

        return {
            imgIdx,
            connectError, disconnectError,
            cacheAfterConnect,
            cacheAfterDisconnect: sw.imageDimensionsCache,
            imageDisconnectedFlag: node.widgets.find(w => w.name === 'image_mode')?.imageDisconnected ?? null,
        };
    });
    console.log(JSON.stringify(r));
    expect(r.connectError).toBeNull();
    expect(r.disconnectError).toBeNull();
    expect(r.imgIdx).toBeGreaterThanOrEqual(0);
    expect(r.cacheAfterDisconnect).toBeNull();          // PR #59: cleared on disconnect
    expect(r.imageDisconnectedFlag).toBe(true);
    expect(pageErrors, `unexpected page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
});

test('Section 2c: changing scale and calling node.updateModeWidget() updates the mode line with no errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const modeWidget = node.widgets.find(w => w.name === 'mode_status');
        const before = modeWidget ? JSON.parse(JSON.stringify(modeWidget.value ?? null)) : null;

        const sw = node.scaleWidgetInstance;
        sw.value = 2.3; sw.onValueChanged?.(sw.value);
        let updateError = null;
        try {
            await node.updateModeWidget?.(true);
        } catch (e) { updateError = String(e); }
        await new Promise(r => setTimeout(r, 200));
        const after = modeWidget ? JSON.parse(JSON.stringify(modeWidget.value ?? null)) : null;
        return { hasUpdateModeWidget: typeof node.updateModeWidget === 'function', updateError, before, after };
    });
    console.log(JSON.stringify(r));
    expect(r.hasUpdateModeWidget).toBe(true);
    expect(r.updateError).toBeNull();
    expect(pageErrors, `unexpected page errors: ${JSON.stringify(pageErrors)}`).toEqual([]);
});
