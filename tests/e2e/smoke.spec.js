// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * SmartResCalc Smoke Tests
 *
 * Validates that the SmartResCalc node loads correctly in ComfyUI.
 * Requires ComfyUI running at localhost:8188.
 */

// Collect console errors during page load
const consoleErrors = [];

test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });

    page.on('pageerror', error => {
        consoleErrors.push(`PAGE ERROR: ${error.message}`);
    });
});

test('ComfyUI loads without SmartResCalc errors', async ({ page }) => {
    await page.goto('/');

    // Wait for ComfyUI to fully load (the graph canvas renders)
    await page.waitForTimeout(5000);

    // Filter for SmartResCalc-specific errors
    const smartResErrors = consoleErrors.filter(e =>
        e.includes('SmartResCalc') ||
        e.includes('SmartResolutionCalc') ||
        e.includes('smart_resolution_calc')
    );

    // The "already registered" error should NOT appear (single-loading)
    const doubleLoadErrors = consoleErrors.filter(e =>
        e.includes('already registered')
    );
    expect(doubleLoadErrors).toHaveLength(0);

    // No SmartResCalc-specific errors
    // Note: we allow the "already registered" check above to be separate
    // because it was a known issue we fixed
    if (smartResErrors.length > 0) {
        console.log('SmartResCalc errors found:', smartResErrors);
    }
    expect(smartResErrors).toHaveLength(0);
});

test('SmartResCalc node can be loaded via API', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Load the test workflow via ComfyUI API
    const workflowPath = path.join(__dirname, '..', '..', 'docs', 'workflow', 'SmartResCalc-Test-Script.json');

    // Check if the workflow file exists
    expect(fs.existsSync(workflowPath)).toBeTruthy();

    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

    // Load workflow into ComfyUI via the /api/load endpoint
    const response = await page.evaluate(async (wf) => {
        try {
            // Use ComfyUI's app.loadGraphData
            if (window.app && window.app.loadGraphData) {
                await window.app.loadGraphData(wf);
                return { success: true };
            }
            return { success: false, error: 'app.loadGraphData not available' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }, workflow);

    expect(response.success).toBeTruthy();

    // Wait for nodes to render
    await page.waitForTimeout(2000);

    // Verify SmartResCalc node exists in the graph
    const nodeCount = await page.evaluate(() => {
        if (!window.app || !window.app.graph) return 0;
        const nodes = window.app.graph._nodes || [];
        return nodes.filter(n =>
            n.type === 'SmartResolutionCalc' ||
            n.comfyClass === 'SmartResolutionCalc'
        ).length;
    });

    expect(nodeCount).toBeGreaterThan(0);
});

test('SmartResCalc node has expected widgets', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Load test workflow
    const workflowPath = path.join(__dirname, '..', '..', 'docs', 'workflow', 'SmartResCalc-Test-Script.json');
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

    await page.evaluate(async (wf) => {
        await window.app.loadGraphData(wf);
    }, workflow);

    await page.waitForTimeout(2000);

    // Get widget names from the SmartResCalc node
    const widgetInfo = await page.evaluate(() => {
        const nodes = window.app.graph._nodes || [];
        const srcNode = nodes.find(n =>
            n.type === 'SmartResolutionCalc' ||
            n.comfyClass === 'SmartResolutionCalc'
        );
        if (!srcNode) return null;

        return {
            widgetCount: srcNode.widgets ? srcNode.widgets.length : 0,
            widgetNames: srcNode.widgets ? srcNode.widgets.map(w => w.name) : [],
            widgetTypes: srcNode.widgets ? srcNode.widgets.map(w => w.type) : [],
        };
    });

    expect(widgetInfo).not.toBeNull();
    expect(widgetInfo.widgetCount).toBeGreaterThan(5);

    // Check for key widgets
    expect(widgetInfo.widgetNames).toContain('aspect_ratio');
    expect(widgetInfo.widgetNames).toContain('divisible_by');
    expect(widgetInfo.widgetNames).toContain('fill_type');
    expect(widgetInfo.widgetNames).toContain('fill_seed');

    // Check for custom widget types
    const customWidgets = widgetInfo.widgetTypes.filter(t => t === 'custom');
    expect(customWidgets.length).toBeGreaterThan(3); // dimension widgets + seed + scale
});

test('SmartResCalc node has expected outputs', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const workflowPath = path.join(__dirname, '..', '..', 'docs', 'workflow', 'SmartResCalc-Test-Script.json');
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

    await page.evaluate(async (wf) => {
        await window.app.loadGraphData(wf);
    }, workflow);

    await page.waitForTimeout(2000);

    const outputInfo = await page.evaluate(() => {
        const nodes = window.app.graph._nodes || [];
        const srcNode = nodes.find(n =>
            n.type === 'SmartResolutionCalc' ||
            n.comfyClass === 'SmartResolutionCalc'
        );
        if (!srcNode) return null;

        return {
            outputCount: srcNode.outputs ? srcNode.outputs.length : 0,
            outputNames: srcNode.outputs ? srcNode.outputs.map(o => o.name) : [],
            outputTypes: srcNode.outputs ? srcNode.outputs.map(o => o.type) : [],
        };
    });

    expect(outputInfo).not.toBeNull();
    expect(outputInfo.outputCount).toBe(8);

    // Verify output names match expected
    expect(outputInfo.outputNames).toContain('megapixels');
    expect(outputInfo.outputNames).toContain('width');
    expect(outputInfo.outputNames).toContain('height');
    expect(outputInfo.outputNames).toContain('seed');
    expect(outputInfo.outputNames).toContain('preview');
    expect(outputInfo.outputNames).toContain('image');
    expect(outputInfo.outputNames).toContain('latent');
    expect(outputInfo.outputNames).toContain('info');
});

test('Screenshot baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    const workflowPath = path.join(__dirname, '..', '..', 'docs', 'workflow', 'SmartResCalc-Test-Script.json');
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));

    await page.evaluate(async (wf) => {
        await window.app.loadGraphData(wf);
    }, workflow);

    await page.waitForTimeout(2000);

    // Take a screenshot for visual regression baseline
    await page.screenshot({
        path: 'tests/e2e/screenshots/baseline.png',
        fullPage: true
    });
});
