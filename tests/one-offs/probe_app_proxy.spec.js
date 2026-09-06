// @ts-check
// One-off probe (#58): why does `app.handleFile = wrapper` not stick?
// Read-only apart from a temporary patch that is restored in the same evaluate.
// Run: npx playwright test --config tests/one-offs/playwright.probe.config.js -g "app proxy"
const { test, expect } = require('@playwright/test');

test('probe: app proxy / handleFile property descriptors and patch strategies', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window.app && window.app.graph && window.LiteGraph), null, { timeout: 60000 });
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
        const app = window.app;
        const out = {};
        const desc = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? { has: true, writable: d.writable, configurable: d.configurable, get: !!d.get, set: !!d.set, isFn: typeof d.value === 'function' } : { has: false }; };
        out.ownDesc = desc(app, 'handleFile');
        const proto = Object.getPrototypeOf(app);
        out.protoName = proto?.constructor?.name;
        out.protoDesc = desc(proto, 'handleFile');
        out.proto2Desc = desc(Object.getPrototypeOf(proto) || {}, 'handleFile');
        out.isExtensible = Object.isExtensible(app);
        // Does a plain set of a NEW property stick?
        app.__srcProbe = 1;
        out.newPropSticks = app.__srcProbe === 1;
        delete app.__srcProbe;
        // Does a plain set of handleFile stick? (restore after)
        const orig = app.handleFile;
        const marker = function probeWrapper() { return 'probe'; };
        app.handleFile = marker;
        out.assignSticks = app.handleFile === marker;
        out.assignReflect = Reflect.set(app, 'handleFile', marker);
        out.assignSticksAfterReflect = app.handleFile === marker;
        let defineErr = null;
        try { Object.defineProperty(app, 'handleFile', { value: marker, configurable: true, writable: true }); } catch (e) { defineErr = String(e); }
        out.defineSticks = app.handleFile === marker; out.defineErr = defineErr;
        out.ownDescAfterDefine = desc(app, 'handleFile');
        // restore whatever we did
        try { delete app.handleFile; } catch (e) {}
        if (app.handleFile !== orig) { try { Object.defineProperty(app, 'handleFile', { value: orig, configurable: true, writable: true }); } catch (e) {} }
        out.restored = app.handleFile === orig;
        // Is window.app a Proxy? (heuristic: util.types not available; compare with comfyAPI reference)
        out.comfyAPIAppSame = window.comfyAPI?.app?.app === app;
        out.appKeys = Object.keys(app).filter(k => /handle|graph|queue/i.test(k)).slice(0, 10);
        // What IS the own copy? bound (native code), the proto function itself, or our wrapper?
        out.ownIsProto = app.handleFile === proto.handleFile;
        out.ownSrcHead = String(app.handleFile).slice(0, 90);
        out.ownIsOurs = String(app.handleFile).includes('pendingImageSeeds');
        out.protoIsOurs = String(proto.handleFile).includes('pendingImageSeeds');
        // Strategy (i): patch the prototype and drop the instance copy; does app.handleFile become ours?
        const origProto = proto.handleFile;
        const origOwn = Object.getOwnPropertyDescriptor(app, 'handleFile');
        const protoWrapper = function protoWrapper() { return 'proto'; };
        proto.handleFile = protoWrapper;
        if (Object.prototype.hasOwnProperty.call(app, 'handleFile')) delete app.handleFile;
        out.protoStrategySticks = app.handleFile === protoWrapper;
        // restore
        proto.handleFile = origProto;
        if (origOwn) Object.defineProperty(app, 'handleFile', origOwn);
        out.restored2 = app.handleFile === orig && proto.handleFile === origProto;
        return out;
    });
    console.log(JSON.stringify(r, null, 1));
    expect(r.restored).toBe(true);
});
