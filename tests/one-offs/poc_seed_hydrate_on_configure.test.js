/**
 * PoC: seed recovery after workflow reload (2026-09-06)
 *
 * CLAIM under test: after a workflow is reloaded with the seed widget in
 * random mode (value -1), the real seed survives only in
 * node.properties.dazzle_last_seed; nothing hydrates seedWidget.lastSeed at
 * configure time, so the recycle button is dead until the first queue —
 * which then overwrites the property with a fresh random seed.
 *
 * FALSIFIABLE PREDICTION (written before running):
 *   CONTROL arm (current hook, no seed hydration): lastSeedAfterLoad === null,
 *     recycle disabled, clicking recycle leaves value at -1  -> test FAILS.
 *   FIX arm (hydrate lastSeed in onConfigure): lastSeedAfterLoad === saved
 *     seed, recycle enabled, click restores 582123831103465  -> test PASSES.
 * If the CONTROL arm passes, the diagnosis is wrong (something else already
 * hydrates) and the fix is not needed.
 *
 * Saved blob is node 237 verbatim from
 * private/claude/2026-09-06_10-21-14 _qwen_tile_guide_mushroom.json.
 *
 * Run:  npx vitest run --config tests/one-offs/poc_seed_hydrate.vitest.config.js
 */
import { describe, it, expect } from 'vitest';
import { SeedWidget, SPECIAL_SEED_INCREMENT } from '../../web/components/SeedWidget.js';
import { applyDazzleSerialization } from '../../web/utils/serialization.js';

const SAVED_SEED = 582123831103465;

// Node 237 as saved (only the fields the configure path touches).
const SAVED_INFO = {
    properties: { 'Node name for S&R': 'SmartResolutionCalc', dazzle_last_seed: SAVED_SEED },
    widgets_values_by_name: { fill_seed: { on: true, value: -1 } },
};

/**
 * Minimal stand-in for a LiteGraph node type. Its configure() does what
 * LGraphNode.configure does for the field we care about: copy `properties`
 * from the saved info. applyDazzleSerialization wraps this exactly as it
 * wraps the real nodeType.prototype.configure.
 */
function makeNodeType() {
    return class FakeNode {
        constructor() {
            this.properties = {};
            this.widgets = [new SeedWidget('fill_seed', -1, { services: { prompt: () => {} } })];
        }
        configure(info) {
            if (info.properties) Object.assign(this.properties, info.properties);
        }
        setDirtyCanvas() {}
    };
}

// The hook the fix would add to smart_resolution_calc.js onConfigure.
function hydrateSeedOnConfigure(info, node) {
    const sw = node.widgets?.find(w => w.name === 'fill_seed');
    if (sw && sw.lastSeed == null && typeof node.properties?.dazzle_last_seed === 'number') {
        sw.lastSeed = node.properties.dazzle_last_seed;
    }
}

function reloadThenClickRecycle(NodeType, info = SAVED_INFO) {
    const node = new NodeType();
    // Deep-clone: serialization.js:72 assigns the saved {on,value} object by
    // reference, so a recycle click would otherwise mutate the shared fixture
    // and pollute the next test (observed on first run of this PoC).
    node.configure(structuredClone(info));                  // workflow load
    const w = node.widgets[0];
    const lastSeedAfterLoad = w.lastSeed;
    const recycleEnabled = w.lastSeed != null;              // same predicate draw() uses (SeedWidget.js:163)
    const valueAfterLoad = w.value.value;
    const randomModeAfterLoad = w.randomizeMode;
    w.hitAreas.btnRecallLast = { x: 10, y: 0, width: 18, height: 24 };
    w.mouse({ type: 'pointerdown' }, [15, 12], node);      // click recycle
    return {
        lastSeedAfterLoad, recycleEnabled, valueAfterLoad, randomModeAfterLoad,
        valueAfterRecycle: w.value.value, randomModeAfterRecycle: w.randomizeMode, widget: w,
    };
}

describe('PoC: seed recovery after workflow reload', () => {
    it('CONTROL — current code (no seed hydration): recycle recovers saved seed [PREDICTED TO FAIL]', () => {
        const T = makeNodeType();
        applyDazzleSerialization(T, {});                    // current onConfigure does nothing for seeds
        const r = reloadThenClickRecycle(T);
        expect(r.valueAfterLoad).toBe(-1);                  // random mode restored (sanity)
        expect(r.lastSeedAfterLoad).toBe(SAVED_SEED);       // <- expected to be null under current code
        expect(r.recycleEnabled).toBe(true);
        expect(r.valueAfterRecycle).toBe(SAVED_SEED);
    });

    it('FIX — hydrate lastSeed in onConfigure: recycle recovers saved seed [PREDICTED TO PASS]', () => {
        const T = makeNodeType();
        applyDazzleSerialization(T, { onConfigure: hydrateSeedOnConfigure });
        const r = reloadThenClickRecycle(T);
        expect(r.lastSeedAfterLoad).toBe(SAVED_SEED);
        expect(r.recycleEnabled).toBe(true);
        expect(r.valueAfterRecycle).toBe(SAVED_SEED);
        expect(r.randomModeAfterRecycle).toBe(false);       // recycle locks the seed
    });

    it('FIX — random mode itself is preserved on reload (value stays -1, green tint)', () => {
        const T = makeNodeType();
        applyDazzleSerialization(T, { onConfigure: hydrateSeedOnConfigure });
        const r = reloadThenClickRecycle(T);
        expect(r.valueAfterLoad).toBe(-1);
        expect(r.randomModeAfterLoad).toBe(true);
    });

    it('FIX — increment mode (-2) after reload continues from the saved seed, not a fresh random', () => {
        const T = makeNodeType();
        applyDazzleSerialization(T, { onConfigure: hydrateSeedOnConfigure });
        const node = new T();
        node.configure({
            properties: { dazzle_last_seed: SAVED_SEED },
            widgets_values_by_name: { fill_seed: { on: true, value: SPECIAL_SEED_INCREMENT } },
        });
        expect(node.widgets[0].resolveActualSeed()).toBe(SAVED_SEED + 1);
    });

    it('FIX — hydration is a no-op when the saved workflow has no dazzle_last_seed (pre-v0.12.2 files)', () => {
        const T = makeNodeType();
        applyDazzleSerialization(T, { onConfigure: hydrateSeedOnConfigure });
        const r = reloadThenClickRecycle(T, { properties: {}, widgets_values_by_name: { fill_seed: { on: true, value: -1 } } });
        expect(r.lastSeedAfterLoad).toBeNull();
        expect(r.recycleEnabled).toBe(false);
        expect(r.valueAfterRecycle).toBe(-1);               // click is inert, as today
    });

    it('FIX — a fixed-mode save (value == seed) is unaffected: value shows seed, lastSeed hydrated too', () => {
        const T = makeNodeType();
        applyDazzleSerialization(T, { onConfigure: hydrateSeedOnConfigure });
        const node = new T();
        node.configure({
            properties: { dazzle_last_seed: 626775212942014 },
            widgets_values_by_name: { fill_seed: { on: true, value: 626775212942014 } },
        });
        const w = node.widgets[0];
        expect(w.value.value).toBe(626775212942014);
        expect(w.randomizeMode).toBe(false);                // serialization.js:77 clears it for value >= 0
        expect(w.lastSeed).toBe(626775212942014);
    });
});
