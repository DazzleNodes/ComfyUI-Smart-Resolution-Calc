// @ts-check
// One-off probe for #58 (2026-09-06). Read-only: loads an existing image
// through the real drag-in entry (app.handleFile) and reports what the
// frontend's metadata readers return. Queues nothing.
//
// PREDICTION (written before running):
//   - window.comfyAPI.pnginfo has getPngMetadata and getWebpMetadata
//   - app.handleFile is a function
//   - getPngMetadata(probe_00001_.png) returns keys workflow and prompt
//   - prompt fill_seed for the SmartResCalc node = 91987083756186
//   - workflow property dazzle_last_seed = 111111111111111 (the pre-fix sentinel)
//   - after handleFile: the loaded node's lastSeed/property are the STALE
//     111111111111111 (bug reproduced through the real path)
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js
const { test, expect } = require('@playwright/test');

test('probe: pnginfo readers + handleFile with probe_00001_.png', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
        const out = {};
        out.hasComfyAPI = !!window.comfyAPI;
        out.pnginfoKeys = Object.keys(window.comfyAPI?.pnginfo || {});
        out.hasHandleFile = typeof window.app.handleFile === 'function';
        out.handleFileArity = window.app.handleFile?.length;
        const blob = await (await fetch('/view?filename=probe_00001_.png&subfolder=seed_probe&type=output')).blob();
        const file = new File([blob], 'probe_00001_.png', { type: 'image/png' });
        let meta = null;
        try { meta = await window.comfyAPI.pnginfo.getPngMetadata(file); } catch (e) { out.metaErr = String(e); }
        out.metaKeys = Object.keys(meta || {});
        try {
            const p = JSON.parse(meta.prompt);
            const e = Object.entries(p).find(([, v]) => v.class_type === 'SmartResolutionCalc');
            out.promptSeed = e ? { id: e[0], fill_seed: e[1].inputs.fill_seed } : null;
        } catch (e) { out.promptSeed = 'ERR ' + String(e); }
        try {
            const w = JSON.parse(meta.workflow);
            const n = w.nodes.find(n => n.type === 'SmartResolutionCalc');
            out.wfProp = { id: n.id, idType: typeof n.id, prop: n.properties?.dazzle_last_seed };
        } catch (e) { out.wfProp = 'ERR ' + String(e); }
        const t0 = Date.now();
        try { await window.app.handleFile(file); } catch (e) { out.handleFileErr = String(e); }
        out.handleFileResolvedMs = Date.now() - t0;
        let node = null;
        while (Date.now() - t0 < 8000) {
            node = (window.app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
            if (node) break;
            await new Promise(res => setTimeout(res, 200));
        }
        const sw = node?.widgets?.find(w => w.name === 'fill_seed');
        out.afterLoad = node ? {
            id: node.id, idType: typeof node.id, prop: node.properties?.dazzle_last_seed,
            lastSeed: sw?.lastSeed ?? null, value: sw?.value, display: sw?.getDisplayState?.().text,
            msUntilNode: Date.now() - t0,
        } : 'node not found within 8s';
        return out;
    });
    console.log(JSON.stringify(r, null, 1));
    expect(r.hasHandleFile).toBe(true);
});
