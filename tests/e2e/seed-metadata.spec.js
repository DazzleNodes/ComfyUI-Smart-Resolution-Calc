// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Seed metadata round-trip (A2 diagnostic / regression).
 *
 * Builds a two-node graph in the live ComfyUI page (SmartResCalc noise fill
 * -> SaveImage, no model needed), pre-seeds node.properties.dazzle_last_seed
 * with a sentinel that stands in for "the previous run", queues once, and
 * pulls the saved PNG back so tests/one-offs/measure_seed_metadata.py can
 * read the embedded workflow + prompt.
 *
 * What it answers (2026-09-06, see the dev-workflow doc of the same date):
 *   - Does the queuePrompt intercept find the workflow snapshot node?
 *     (`[Seed Intercept] ... workflow snapshot found|MISSING`)
 *   - Is the embedded dazzle_last_seed the sentinel (one run stale) or the
 *     seed of this run?
 *   - Do the intercept's widgets_values snapshot patches land in the PNG?
 *
 * Requires ComfyUI running at localhost:8188 (playwright.config.js baseURL).
 * Writes:   ComfyUI/output/seed_probe/probe_NNNNN_.png (server side)
 *           tests/one-offs/tmp/seed_probe.png (copy for the probe script)
 */

const SENTINEL_PREV_SEED = 111111111111111; // stands in for the previous run's seed
const OUT_DIR = path.join(__dirname, '..', 'one-offs', 'tmp');
const SEED_WIDGET_INDEX = 11; // fill_seed position in SmartResolutionCalc widgets_values

test.setTimeout(180000);

/** Read uncompressed tEXt chunks (SaveImage writes `prompt` and `workflow`) from a PNG buffer. */
function readPngText(buf) {
    const out = {};
    let off = 8;
    while (off + 8 <= buf.length) {
        const size = buf.readUInt32BE(off);
        const tag = buf.toString('latin1', off + 4, off + 8);
        if (tag === 'tEXt') {
            const body = buf.subarray(off + 8, off + 8 + size);
            const nul = body.indexOf(0);
            const key = body.toString('latin1', 0, nul);
            out[key] = body.toString('utf8', nul + 1);
        }
        off += 12 + size;
    }
    return out;
}

test('seed intercept: embedded workflow carries this run\'s seed', async ({ page }) => {
    const consoleLines = [];
    page.on('console', msg => consoleLines.push(msg.text()));

    // Debug logger reads localStorage at module load: set, then reload.
    await page.goto('/');
    await page.evaluate(() => {
        localStorage.setItem('DEBUG_SMART_RES_CALC', 'true');
    });
    await page.reload();
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    // Build the probe graph and queue it.
    const built = await page.evaluate(({ sentinel }) => {
        const app = window.app;
        app.graph.clear();
        const src = LiteGraph.createNode('SmartResolutionCalc');
        const save = LiteGraph.createNode('SaveImage');
        if (!src || !save) return { error: `createNode failed: src=${!!src} save=${!!save}` };
        src.pos = [100, 100];
        save.pos = [700, 100];
        app.graph.add(src);
        app.graph.add(save);
        const prefixW = save.widgets?.find(w => w.name === 'filename_prefix');
        if (prefixW) prefixW.value = 'seed_probe/probe';
        const outIdx = src.outputs.findIndex(o => o.type === 'IMAGE');
        const link = src.connect(outIdx, save, 0);
        const sw = src.widgets?.find(w => w.name === 'fill_seed');
        if (!sw) return { error: 'no fill_seed widget' };
        sw.value = { on: true, value: -1 };
        if (sw.setRandomMode) sw.setRandomMode(true);
        // Pretend a previous run happened: property mirror holds the sentinel.
        src.properties.dazzle_last_seed = sentinel;
        sw.lastSeed = null;
        return { srcId: src.id, saveId: save.id, outIdx, linked: !!link,
                 hasHydrate: typeof sw.hydrateLastSeedFromNode === 'function',
                 hasDisplayState: typeof sw.getDisplayState === 'function' };
    }, { sentinel: SENTINEL_PREV_SEED });
    expect(built.error, JSON.stringify(built)).toBeUndefined();
    expect(built.linked).toBe(true);

    const queued = await page.evaluate(async () => {
        const app = window.app;
        try {
            const r = await app.queuePrompt(0, 1);
            return { ok: true, r: r ?? null };
        } catch (e) {
            return { ok: false, err: String(e) };
        }
    });
    expect(queued.ok, JSON.stringify(queued)).toBe(true);

    // Wait for the server queue to drain, then find our output in history.
    const result = await page.evaluate(async ({ srcId }) => {
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            const q = await (await fetch('/queue')).json();
            if (!q.queue_running.length && !q.queue_pending.length) break;
            await new Promise(r => setTimeout(r, 500));
        }
        const hist = await (await fetch('/history?max_items=5')).json();
        const entries = Object.entries(hist).map(([id, h]) => ({ id, h }));
        // newest last in insertion order; scan from the end
        for (let i = entries.length - 1; i >= 0; i--) {
            const { id, h } = entries[i];
            const outs = h.outputs || {};
            for (const nodeId of Object.keys(outs)) {
                const imgs = outs[nodeId].images || [];
                const hit = imgs.find(im => im.subfolder === 'seed_probe');
                if (hit) {
                    const url = `/view?filename=${encodeURIComponent(hit.filename)}&subfolder=${encodeURIComponent(hit.subfolder)}&type=${hit.type}`;
                    const buf = await (await fetch(url)).arrayBuffer();
                    let bin = '';
                    const bytes = new Uint8Array(buf);
                    for (let j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
                    const src = window.app.graph.getNodeById(srcId);
                    const sw = src?.widgets?.find(w => w.name === 'fill_seed');
                    return { promptId: id, status: h.status?.status_str, filename: hit.filename, subfolder: hit.subfolder,
                             pngBase64: btoa(bin), liveProp: src?.properties?.dazzle_last_seed ?? null,
                             liveLastSeed: sw?.lastSeed ?? null, liveValue: sw?.value ?? null,
                             display: sw?.getDisplayState ? sw.getDisplayState() : null };
                }
            }
            if (h.status?.status_str === 'error') {
                return { promptId: id, status: 'error', messages: JSON.stringify(h.status.messages).slice(0, 1500) };
            }
        }
        return { status: 'not-found', historyIds: entries.map(e => e.id) };
    }, { srcId: built.srcId });

    const intercept = consoleLines.filter(l => l.includes('[Seed Intercept]') || l.includes('[configure]'));
    console.log('--- intercept/configure console lines ---');
    for (const l of intercept) console.log(l);
    console.log('--- result (sans png) ---');
    const { pngBase64, ...rest } = result;
    console.log(JSON.stringify(rest, null, 1));

    expect(result.status, JSON.stringify(rest)).toBe('success');
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outPath = path.join(OUT_DIR, 'seed_probe.png');
    fs.writeFileSync(outPath, Buffer.from(pngBase64, 'base64'));
    console.log('wrote', outPath);

    // Live-side invariants (independent of the embedded metadata question)
    expect(result.liveProp).not.toBe(SENTINEL_PREV_SEED);       // intercept wrote this run's seed to the live node
    expect(result.liveLastSeed).toBe(result.liveProp);           // and to the recall buffer
    expect(result.liveValue).toEqual({ on: true, value: -1 });   // random mode stays -1
    if (result.display) expect(result.display.text).toBe(String(result.liveProp)); // B: value box shows the seed

    // Embedded metadata: the image must carry ITS OWN run's seed (A2), while
    // widgets_values keeps the display state so drag-in restores random mode.
    const text = readPngText(fs.readFileSync(outPath));
    expect(text.workflow, 'PNG has no embedded workflow').toBeTruthy();
    expect(text.prompt, 'PNG has no embedded prompt').toBeTruthy();
    const wf = JSON.parse(text.workflow);
    const pr = JSON.parse(text.prompt);
    const wfNode = wf.nodes.find(n => String(n.id) === String(built.srcId));
    expect(wfNode, 'SmartResCalc node missing from embedded workflow').toBeTruthy();
    const sentSeed = pr[String(built.srcId)].inputs.fill_seed;
    const sentValue = (sentSeed && typeof sentSeed === 'object') ? sentSeed.value : sentSeed;
    // v0.12.5: two widgets (scale slider, mode_status) no longer serialize, so the
    // positional array is shorter on a 1.5x frontend. Take fill_seed's index from
    // the frontend's own name list when it wrote one; the constant is the old-frontend shape.
    const seedIdx = wfNode.widgets_values_named
        ? Object.keys(wfNode.widgets_values_named).indexOf('fill_seed')
        : SEED_WIDGET_INDEX;
    console.log('embedded: sent=', sentValue, 'prop=', wfNode.properties?.dazzle_last_seed,
                'widget=', JSON.stringify(wfNode.widgets_values?.[seedIdx]), 'idx=', seedIdx);
    expect(sentValue).toBe(result.liveProp);                                  // Python got this run's seed
    expect(wfNode.properties?.dazzle_last_seed).toBe(result.liveProp);        // and so did the image (not the sentinel)
    expect(wfNode.properties?.dazzle_last_seed).not.toBe(SENTINEL_PREV_SEED);
    expect(wfNode.widgets_values?.[seedIdx]).toEqual({ on: true, value: -1 });   // display state preserved
    // Name-keyed blocks carry the display state too. A 1.5x frontend writes its own
    // (`widgets_values_named`) and our block is then not written (v0.12.5); older
    // frontends get ours. Whichever is present must agree with the index block.
    const named = wfNode.widgets_values_named?.fill_seed ?? wfNode.widgets_values_by_name?.fill_seed;
    expect(named).toEqual({ on: true, value: -1 });
});
