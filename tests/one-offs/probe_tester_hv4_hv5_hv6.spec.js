// @ts-check
// Tester sweep (2026-09-26), extending v0.12.5__Feature__frontend-1.53-widget-restore.md
// HV.4 (scale survives save/reload), HV.5 (custom step sizes survive save/reload,
// and the new step affects slider snapping), HV.6 (saved file carries no stale copy;
// dazzle_scale_steps appears in properties once set).
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "HV\\."
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(__dirname, '..', 'e2e', 'fixtures', 'frontend-1.53-stale-by-name-workflow.json');
const NODE_ID = '473';

async function boot(page) {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
}

test('HV.4: scale survives save and reload (real graph-serializer save path), queue reflects it without touching the slider', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const h = node.widgets.find(w => w.name === 'dimension_height');
        h.value = { on: true, value: 1400 };
        const sw = node.scaleWidgetInstance;
        sw.value = 1.5; sw.onValueChanged?.(sw.value);
        // Save via the real 1.5x path: app.graph.serialize() only, never node.serialize().
        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const sliderAfterReload = n2.scaleWidgetInstance?.value;
        // Queue without touching the slider again
        const p = await app.graphToPrompt();
        const inputs = p.output?.[String(n2.id)]?.inputs || {};
        return { sliderAfterReload, promptScale: inputs.scale };
    });
    console.log(JSON.stringify(r));
    expect(r.sliderAfterReload).toBe(1.5);
    expect(r.promptScale).toBe(1.5);
});

test('HV.5: custom step sizes survive save/reload and change what the slider snaps to', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const sw = node.scaleWidgetInstance;
        const beforeLeft = sw.leftStep, beforeRight = sw.rightStep;
        // Panel handlers do assignment + onStepsChanged(); the write is live, not
        // gated behind any serialize call (#60).
        sw.leftStep = 0.23; sw.onStepsChanged?.();
        sw.rightStep = 0.47; sw.onStepsChanged?.();
        const liveProps = { ...node.properties?.dazzle_scale_steps };
        // getStepSize() is what updateValueFromMouse() consults when snapping a drag
        const stepBelow1 = sw.getStepSize(0.5);
        const stepAtOrAbove1 = sw.getStepSize(1.2);
        const wf = app.graph.serialize();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const sw2 = n2.scaleWidgetInstance;
        return {
            beforeLeft, beforeRight, liveProps,
            stepBelow1, stepAtOrAbove1,
            restored: { leftStep: sw2?.leftStep, rightStep: sw2?.rightStep },
            restoredStepBelow1: sw2?.getStepSize(0.5),
            restoredStepAtOrAbove1: sw2?.getStepSize(1.2),
        };
    });
    console.log(JSON.stringify(r));
    expect(r.beforeLeft).toBe(0.05);   // constructor default, sanity check
    expect(r.beforeRight).toBe(0.1);
    expect(r.liveProps).toEqual({ leftStep: 0.23, rightStep: 0.47 });   // written live, no serialize needed
    expect(r.stepBelow1).toBe(0.23);
    expect(r.stepAtOrAbove1).toBe(0.47);
    expect(r.restored).toEqual({ leftStep: 0.23, rightStep: 0.47 });
    expect(r.restoredStepBelow1).toBe(0.23);      // dragging now snaps to the new steps
    expect(r.restoredStepAtOrAbove1).toBe(0.47);
});

test('HV.6: saved files carry no widgets_values_by_name (top level or extensions); dazzle_scale_steps appears once steps are set', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
    await boot(page);
    const r = await page.evaluate(async ({ wf, id }) => {
        const app = window.app;
        app.graph.clear();
        // "Load an image from before this fix" -> this fixture carries the node's
        // stale widgets_values_by_name alongside the frontend's widgets_values_named.
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const node = (app.graph._nodes || []).find(n => String(n.id) === id && n.comfyClass === 'SmartResolutionCalc');
        // "File > Export the workflow" -> app.graph.serialize() (no node.serialize() call)
        const exported = app.graph.serialize();
        const fileNode = exported.nodes.find(n => String(n.id) === id);
        const beforeSteps = fileNode?.properties?.dazzle_scale_steps ?? null;
        // Now set scale steps the way the panel does, then export again
        const sw = node.scaleWidgetInstance;
        sw.leftStep = 0.31; sw.onStepsChanged?.();
        sw.rightStep = 0.62; sw.onStepsChanged?.();
        const exported2 = app.graph.serialize();
        const fileNode2 = exported2.nodes.find(n => String(n.id) === id);
        return {
            hasByNameTopLevel: Object.prototype.hasOwnProperty.call(fileNode, 'widgets_values_by_name'),
            hasByNameInExtensions: !!fileNode.extensions?.widgets_values_by_name,
            hasConfigTopLevel: Object.prototype.hasOwnProperty.call(fileNode, 'widgets_config'),
            hasConfigInExtensions: !!fileNode.extensions?.widgets_config,
            beforeSteps,
            afterSteps: fileNode2?.properties?.dazzle_scale_steps ?? null,
        };
    }, { wf, id: NODE_ID });
    console.log(JSON.stringify(r));
    expect(r.hasByNameTopLevel).toBe(false);
    expect(r.hasByNameInExtensions).toBe(false);
    expect(r.hasConfigTopLevel).toBe(false);
    expect(r.hasConfigInExtensions).toBe(false);
    expect(r.afterSteps).toEqual({ leftStep: 0.31, rightStep: 0.62 });
});
