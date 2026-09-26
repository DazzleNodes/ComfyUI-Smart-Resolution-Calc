// @ts-check
// One-off probe (2026-09-26): after loading the pirate workflow, node.widgets'
// dimension_height reads 1216 but node.serialize().widgets_values_by_name says
// 2100. Who is our serialize hook reading? Instrument identities and accessors.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "serialize identity"
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('probe: serialize identity after loading the pirate workflow', async ({ page }) => {
    const wf = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp', 'pirate_workflow.json'), 'utf-8'));
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async (wf) => {
        const app = window.app;
        app.graph.clear();
        await app.loadGraphData(wf);
        await new Promise(r => setTimeout(r, 2500));
        const node = (app.graph._nodes || []).find(n => n.comfyClass === 'SmartResolutionCalc');
        const out = {};
        const list = node.widgets;
        out.widgetsIsArray = Array.isArray(list);
        out.widgetsSameOnReread = node.widgets === list;
        const hs = list.filter(w => w.name === 'dimension_height');
        out.heightCount = hs.length;
        const h = hs[0];
        const d = Object.getOwnPropertyDescriptor(h, 'value');
        out.valueGetterSrc = d?.get ? String(d.get).slice(0, 300) : null;
        out.valueSetterSrc = d?.set ? String(d.set).slice(0, 300) : null;
        out.ownKeys = Object.getOwnPropertyNames(h).slice(0, 40);
        out.hRead = JSON.parse(JSON.stringify(h.value));
        // Replicate our serialize hook's loop verbatim
        const m = {};
        list.forEach(w => { if (w.value !== undefined) m[w.name] = w.value; });
        out.replicaByName_height = JSON.parse(JSON.stringify(m.dimension_height));
        // Now the real hook
        const s = node.serialize();
        out.serialize_byName_height = s.widgets_values_by_name?.dimension_height;
        out.serialize_idx23 = s.widgets_values?.[23];
        out.serializeSrcHead = String(node.serialize).slice(0, 160);
        // Any hidden internal widget lists?
        out.internalLists = Object.keys(node).filter(k => /widget/i.test(k));
        for (const k of out.internalLists) {
            const v = node[k];
            if (Array.isArray(v)) out['list_' + k] = v.filter(w => w?.name === 'dimension_height').map(w => ({ ctor: w.constructor?.name, val: JSON.parse(JSON.stringify(w.value ?? null)), same: w === h }));
        }
        // Prototype chain of node and where serialize lives
        const chain = []; let o = node; while (o && chain.length < 5) { o = Object.getPrototypeOf(o); chain.push({ ctor: o?.constructor?.name, hasSerialize: !!(o && Object.prototype.hasOwnProperty.call(o, 'serialize')), ours: !!(o && Object.prototype.hasOwnProperty.call(o, 'serialize') && String(o.serialize).includes('widgets_values_by_name')) }); }
        out.nodeProtoChain = chain;
        // Does LiteGraph's own serialize get the same widget list? Call the frontend's original directly if reachable
        let origProto = null; o = node;
        while (o) { if (Object.prototype.hasOwnProperty.call(o, 'serialize') && !String(o.serialize).includes('widgets_values_by_name')) { origProto = o; break; } o = Object.getPrototypeOf(o); }
        if (origProto) {
            const s0 = origProto.serialize.call(node);
            out.origSerialize = { idx23: s0.widgets_values?.[23], named: s0.widgets_values_named?.dimension_height, hasByName: 'widgets_values_by_name' in s0, ext: s0.extensions?.widgets_values_by_name?.dimension_height };
        }
        return out;
    }, wf);
    console.log(JSON.stringify(r, null, 1));
});
