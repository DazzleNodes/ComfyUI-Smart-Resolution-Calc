// @ts-check
// One-off (2026-09-26): PR #59's claim on the live 1.53 frontend, on top of the
// named-restore fix: custom scale steps survive serialize -> loadGraphData.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "pr59 scale"
// NOTE (later 2026-09-26): this probe passed for the wrong reason. Its node.serialize()
// call wrote the property as a side effect; a real 1.5x save never calls that hook.
// The regression test in tests/e2e/widget-restore-frontend-153.spec.js saves through
// app.graph.serialize() only, and caught the gap (fixed with a write-on-change hook, #60).
const { test, expect } = require('@playwright/test');

test('probe: pr59 scale steps round trip under adoption', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const sw = node.scaleWidgetInstance;
        sw.leftStep = 0.23; sw.rightStep = 0.47;
        const ser = node.serialize();
        // v0.12.5: steps live in node.properties (allowlisted by the 1.5x graph serializer)
        const saved = ser.properties?.dazzle_scale_steps;
        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const sw2 = n2.scaleWidgetInstance;
        return { saved, restored: { leftStep: sw2?.leftStep, rightStep: sw2?.rightStep }, retainedInWidgets: n2.widgets.includes(sw2) };
    });
    console.log(JSON.stringify(r));
    expect(r.saved).toEqual({ leftStep: 0.23, rightStep: 0.47 });
    expect(r.restored).toEqual({ leftStep: 0.23, rightStep: 0.47 });
});
