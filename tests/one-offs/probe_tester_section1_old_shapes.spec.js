// @ts-check
// Tester sweep (2026-09-26), extending v0.12.5__Feature__frontend-1.53-widget-restore.md
// Section 1: the three older-file shapes, each built by editing a serialized
// workflow in-page (not read from a fixture on disk, except where the fixture
// already carries the by-name-only shape's byte content).
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "Section 1"
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

test('Section 1a: by-name-only shape (no widgets_values_named, no extensions) restores from widgets_values_by_name, and the debug log names that source', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'));
    const node = wf.nodes.find(n => String(n.id) === NODE_ID);
    delete node.widgets_values_named;                 // pre-1.5x file shape
    delete node.extensions;
    node.widgets_values_by_name.dimension_height = { on: true, value: 1536 };

    const logs = [];
    await boot(page);
    page.on('console', msg => logs.push(msg.text()));
    await page.evaluate(() => localStorage.setItem('DEBUG_SMART_RES_CALC', 'true'));
    await page.reload();
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1000);

    const r = await page.evaluate(async ({ wf, id }) => {
        const app = window.app;
        app.graph.clear();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const node = (app.graph._nodes || []).find(n => String(n.id) === id && n.comfyClass === 'SmartResolutionCalc');
        const h = node.widgets.find(w => w.name === 'dimension_height');
        return { height: JSON.parse(JSON.stringify(h.value)) };
    }, { wf, id: NODE_ID });
    console.log(JSON.stringify(r));
    console.log('console lines mentioning configure:', JSON.stringify(logs.filter(l => l.includes('[configure]'))));
    expect(r.height).toEqual({ on: true, value: 1536 });
    expect(logs.some(l => l.includes('source: widgets_values_by_name'))).toBe(true);
});

test('Section 1b: named shape with scale=1 carrier and scale#1=1.5 slider restores the slider value, not 1.0', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        // Build the pre-v0.12.5-on-1.53 shape by editing a serialized workflow in-page,
        // simulating what a 1.53 frontend would have written before this fix existed:
        // the carrier "scale" left at 1 (never mirrored) and the slider under its
        // renamed key "scale#1" holding the value the user actually set.
        const wf = app.graph.serialize();
        const wn = wf.nodes.find(n => String(n.id) === String(node.id));
        wn.widgets_values_named.scale = 1;
        wn.widgets_values_named['scale#1'] = 1.5;
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const carrier = n2.widgets.find(w => w.name === 'scale' && w !== n2.scaleWidgetInstance);
        return {
            sliderName: n2.scaleWidgetInstance?.name,
            slider: n2.scaleWidgetInstance?.value,
            carrier: carrier?.value ?? null,
        };
    });
    console.log(JSON.stringify(r));
    test.skip(r.sliderName === 'scale', 'this frontend does not rename duplicate widgets; the scale#1 shape cannot occur');
    expect(r.slider).toBe(1.5);      // not 1.0
    expect(r.carrier).toBe(1.5);
});

test('Section 1c: pre-0.12.5 widgets_config.scale step shape restores the steps, and one save moves them into properties.dazzle_scale_steps', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
        const app = window.app;
        app.graph.clear();
        const node = LiteGraph.createNode('SmartResolutionCalc');
        node.pos = [100, 100];
        app.graph.add(node);
        await new Promise(r => setTimeout(r, 300));
        const wf = app.graph.serialize();
        const wn = wf.nodes.find(n => String(n.id) === String(node.id));
        // Pre-0.12.5 shape: no dazzle_scale_steps under properties, steps only in the
        // node-level widgets_config.scale block (the shape applyDazzleSerialization's
        // configure hook consumes before the frontend sees the loaded data).
        if (wn.properties) delete wn.properties.dazzle_scale_steps;
        wn.widgets_config = { scale: { leftStep: 0.11, rightStep: 0.33 } };
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2000));
        const n2 = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const sw2 = n2.scaleWidgetInstance;
        const restoredSteps = { leftStep: sw2?.leftStep, rightStep: sw2?.rightStep };
        // One save (the real 1.5x path) should now carry them under properties
        const wf2 = app.graph.serialize();
        const savedSteps = wf2.nodes.find(n => String(n.id) === String(n2.id))?.properties?.dazzle_scale_steps ?? null;
        return { restoredSteps, savedSteps, leakedWidgetsConfig: Object.prototype.hasOwnProperty.call(wf2.nodes.find(n => String(n.id) === String(n2.id)), 'widgets_config') };
    });
    console.log(JSON.stringify(r));
    expect(r.restoredSteps).toEqual({ leftStep: 0.11, rightStep: 0.33 });
    expect(r.savedSteps).toEqual({ leftStep: 0.11, rightStep: 0.33 });
    expect(r.leakedWidgetsConfig).toBe(false);   // the old key must not ride along into the new save
});
