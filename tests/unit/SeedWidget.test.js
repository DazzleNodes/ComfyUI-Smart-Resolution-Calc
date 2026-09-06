import { describe, it, expect, vi } from 'vitest';
import { SeedWidget, SPECIAL_SEED_RANDOM, SPECIAL_SEED_INCREMENT, SPECIAL_SEED_DECREMENT, SEED_MAX } from '../../web/components/SeedWidget.js';
import { applyDazzleSerialization } from '../../web/utils/serialization.js';

describe('SeedWidget', () => {
    const mockServices = { prompt: vi.fn() };

    function createWidget(defaultValue = -1) {
        return new SeedWidget('fill_seed', defaultValue, { services: mockServices });
    }

    describe('constructor', () => {
        it('enforces { on: boolean, value: any } shape', () => {
            const widget = createWidget(-1);
            expect(widget.value).toEqual({ on: true, value: -1 });
            expect(widget.name).toBe('fill_seed');
            expect(widget.type).toBe('custom');
        });

        it('defaults to on=true', () => {
            const widget = createWidget();
            expect(widget.value.on).toBe(true);
        });
    });

    describe('generateRandomSeed', () => {
        it('returns a non-negative integer', () => {
            const widget = createWidget();
            const seed = widget.generateRandomSeed();
            expect(seed).toBeGreaterThanOrEqual(0);
            expect(seed).toBeLessThanOrEqual(SEED_MAX);
            expect(Number.isInteger(seed)).toBe(true);
        });

        it('avoids special values', () => {
            const widget = createWidget();
            for (let i = 0; i < 100; i++) {
                const seed = widget.generateRandomSeed();
                expect(seed).not.toBe(SPECIAL_SEED_RANDOM);
                expect(seed).not.toBe(SPECIAL_SEED_INCREMENT);
                expect(seed).not.toBe(SPECIAL_SEED_DECREMENT);
            }
        });
    });

    describe('resolveActualSeed', () => {
        it('passes through fixed seeds when ON', () => {
            const widget = createWidget();
            widget.value.on = true;
            widget.value.value = 42;
            expect(widget.resolveActualSeed()).toBe(42);
        });

        it('passes through value as-is when OFF', () => {
            const widget = createWidget();
            widget.value.on = false;
            widget.value.value = -1;
            expect(widget.resolveActualSeed()).toBe(-1);
        });

        it('generates random for special value -1 when ON', () => {
            const widget = createWidget();
            widget.value.on = true;
            widget.value.value = SPECIAL_SEED_RANDOM;
            const seed = widget.resolveActualSeed();
            expect(seed).toBeGreaterThanOrEqual(0);
        });

        it('increments lastSeed for special value -2', () => {
            const widget = createWidget();
            widget.value.on = true;
            widget.value.value = SPECIAL_SEED_INCREMENT;
            widget.lastSeed = 100;
            expect(widget.resolveActualSeed()).toBe(101);
        });

        it('decrements lastSeed for special value -3', () => {
            const widget = createWidget();
            widget.value.on = true;
            widget.value.value = SPECIAL_SEED_DECREMENT;
            widget.lastSeed = 100;
            expect(widget.resolveActualSeed()).toBe(99);
        });

        it('falls back to random when lastSeed is null', () => {
            const widget = createWidget();
            widget.value.on = true;
            widget.value.value = SPECIAL_SEED_INCREMENT;
            widget.lastSeed = null;
            const seed = widget.resolveActualSeed();
            expect(seed).toBeGreaterThanOrEqual(0);
        });
    });

    describe('serializeValue', () => {
        it('returns value as-is (pure passthrough, no seed resolution)', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 42 };
            const result = widget.serializeValue({}, 0);
            expect(result).toEqual({ on: true, value: 42 });
        });

        it('returns -1 as-is in randomize mode (resolution happens in prompt hook)', () => {
            const widget = createWidget();
            widget.value = { on: true, value: -1 };
            widget.randomizeMode = true;
            const result = widget.serializeValue({}, 0);
            // serializeValue is now a pure passthrough — no resolution
            expect(result).toEqual({ on: true, value: -1 });
            // lastSeed should NOT be modified by serializeValue
            expect(widget.lastSeed).toBeNull();
        });

        it('does not modify lastSeed (only prompt interception does)', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 42 };
            widget.lastSeed = null;
            widget.serializeValue({}, 0);
            // serializeValue no longer tracks lastSeed
            expect(widget.lastSeed).toBeNull();
        });
    });

    describe('randomizeMode state', () => {
        it('defaults to true when value is -1 (random)', () => {
            const widget = createWidget(-1);
            expect(widget.randomizeMode).toBe(true);
        });

        it('defaults to false when value is a fixed seed', () => {
            const widget = createWidget(42);
            expect(widget.randomizeMode).toBe(false);
        });

        it('dice button sets randomizeMode true and value -1', () => {
            const widget = createWidget(42);
            widget.hitAreas.btnRandomize = { x: 10, y: 0, width: 18, height: 24 };
            widget.mouse({ type: 'pointerdown' }, [15, 12], { setDirtyCanvas: () => {} });
            expect(widget.randomizeMode).toBe(true);
            expect(widget.value.value).toBe(-1);
        });

        it('lock button clears randomizeMode', () => {
            const widget = createWidget(-1); // starts with randomizeMode=true
            expect(widget.randomizeMode).toBe(true);
            widget.hitAreas.btnFixRandom = { x: 10, y: 0, width: 18, height: 24 };
            widget.mouse({ type: 'pointerdown' }, [15, 12], { setDirtyCanvas: () => {} });
            expect(widget.randomizeMode).toBe(false);
        });

        it('recycle button clears randomizeMode', () => {
            const widget = createWidget(-1); // starts with randomizeMode=true
            widget.lastSeed = 42;
            widget.hitAreas.btnRecallLast = { x: 10, y: 0, width: 18, height: 24 };
            widget.mouse({ type: 'pointerdown' }, [15, 12], { setDirtyCanvas: () => {} });
            expect(widget.randomizeMode).toBe(false);
            expect(widget.value.value).toBe(42);
        });
    });

    describe('lock button saves lastSeed', () => {
        it('preserves current seed when generating new fixed random', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 42 };
            widget.hitAreas.btnFixRandom = { x: 10, y: 0, width: 18, height: 24 };

            const mockNode = { setDirtyCanvas: () => {} };
            widget.mouse({ type: 'pointerdown' }, [15, 12], mockNode);

            // After lock button: lastSeed should be the old value (42)
            expect(widget.lastSeed).toBe(42);
            // New value should be a different random
            expect(widget.value.value).not.toBe(42);
            expect(widget.value.value).toBeGreaterThanOrEqual(0);
        });

        it('allows recycle to recover seed after lock', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 42 };
            widget.hitAreas.btnFixRandom = { x: 10, y: 0, width: 18, height: 24 };
            widget.hitAreas.btnRecallLast = { x: 40, y: 0, width: 18, height: 24 };

            const mockNode = { setDirtyCanvas: () => {} };

            // Click lock — generates new random, saves 42 to lastSeed
            widget.mouse({ type: 'pointerdown' }, [15, 12], mockNode);
            const newRandom = widget.value.value;
            expect(widget.lastSeed).toBe(42);

            // Click recycle — recovers 42
            widget.mouse({ type: 'pointerdown' }, [45, 12], mockNode);
            expect(widget.value.value).toBe(42);
        });
    });

    describe('hydrateLastSeedFromNode', () => {
        it('copies node.properties.dazzle_last_seed into lastSeed and reports true', () => {
            const widget = createWidget(-1);
            const node = { properties: { dazzle_last_seed: 582123831103465 } };
            expect(widget.hydrateLastSeedFromNode(node)).toBe(true);
            expect(widget.lastSeed).toBe(582123831103465);
        });

        it('is a no-op (false) when the property is missing, non-numeric, or a special value', () => {
            for (const props of [{}, { dazzle_last_seed: '42' }, { dazzle_last_seed: null }, { dazzle_last_seed: -1 }, { dazzle_last_seed: -2 }]) {
                const widget = createWidget(-1);
                expect(widget.hydrateLastSeedFromNode({ properties: props })).toBe(false);
                expect(widget.lastSeed).toBeNull();
            }
            expect(createWidget(-1).hydrateLastSeedFromNode(undefined)).toBe(false);
            expect(createWidget(-1).hydrateLastSeedFromNode({})).toBe(false);
        });

        it('never overwrites a live lastSeed (undo/paste/queue-time fallback safety)', () => {
            const widget = createWidget(-1);
            widget.lastSeed = 7;
            expect(widget.hydrateLastSeedFromNode({ properties: { dazzle_last_seed: 99 } })).toBe(false);
            expect(widget.lastSeed).toBe(7);
        });
    });

    /**
     * Reload path: node 237 of the 2026-09-06 mushroom workflow, verbatim.
     * Goes through applyDazzleSerialization's configure wrapper with a minimal
     * LiteGraph-like node type whose configure() copies `properties`, as
     * LGraphNode.configure does. The onConfigure hook here is the same one
     * smart_resolution_calc.js installs (find fill_seed, hydrate).
     */
    describe('configure-time hydration (workflow reload / image drag-in)', () => {
        const SAVED_SEED = 582123831103465;
        const savedInfo = (seedWidgetValue = -1, props = { dazzle_last_seed: SAVED_SEED }) => ({
            properties: { 'Node name for S&R': 'SmartResolutionCalc', ...props },
            widgets_values_by_name: { fill_seed: { on: true, value: seedWidgetValue } },
        });
        function makeNodeType() {
            class FakeNode {
                constructor() {
                    this.properties = {};
                    this.widgets = [createWidget(-1)];
                }
                configure(info) { if (info.properties) Object.assign(this.properties, info.properties); }
                setDirtyCanvas() {}
            }
            applyDazzleSerialization(FakeNode, {
                onConfigure: (info, node) => {
                    node.widgets.find(w => w.name === 'fill_seed')?.hydrateLastSeedFromNode?.(node);
                },
            });
            return FakeNode;
        }
        function load(info) {
            const T = makeNodeType();
            const node = new T();
            node.configure(structuredClone(info));   // by-reference restore would otherwise share the fixture
            return { node, widget: node.widgets[0] };
        }

        it('random-mode save: recycle is enabled right after load and recovers the saved seed', () => {
            const { node, widget } = load(savedInfo(-1));
            expect(widget.value.value).toBe(-1);
            expect(widget.randomizeMode).toBe(true);           // random mode itself is preserved
            expect(widget.lastSeed).toBe(SAVED_SEED);          // was null before this fix
            widget.hitAreas.btnRecallLast = { x: 10, y: 0, width: 18, height: 24 };
            widget.mouse({ type: 'pointerdown' }, [15, 12], node);
            expect(widget.value.value).toBe(SAVED_SEED);
            expect(widget.randomizeMode).toBe(false);          // recycle locks
        });

        it('increment mode (-2) after load continues from the saved seed instead of a fresh random', () => {
            const { widget } = load(savedInfo(SPECIAL_SEED_INCREMENT));
            expect(widget.resolveActualSeed()).toBe(SAVED_SEED + 1);
        });

        it('pre-v0.12.2 file (no property): recycle stays disabled and the click is inert', () => {
            const { node, widget } = load(savedInfo(-1, {}));
            expect(widget.lastSeed).toBeNull();
            widget.hitAreas.btnRecallLast = { x: 10, y: 0, width: 18, height: 24 };
            widget.mouse({ type: 'pointerdown' }, [15, 12], node);
            expect(widget.value.value).toBe(-1);
        });

        it('fixed-mode save is unaffected: value shows the seed, random mode cleared, lastSeed hydrated', () => {
            const { widget } = load(savedInfo(626775212942014, { dazzle_last_seed: 626775212942014 }));
            expect(widget.value.value).toBe(626775212942014);
            expect(widget.randomizeMode).toBe(false);
            expect(widget.lastSeed).toBe(626775212942014);
        });
    });

    describe('getDisplayState (value box readout)', () => {
        it('random mode with a known last seed shows the seed dimmed, informational', () => {
            const widget = createWidget(-1);
            widget.lastSeed = 582123831103465;
            const d = widget.getDisplayState();
            expect(d.text).toBe('582123831103465');
            expect(d.informational).toBe(true);
            expect(typeof d.color).toBe('string');
            expect(widget.value.value).toBe(-1);               // stored value untouched
        });

        it('random mode with no last seed shows the literal Rnd: -1', () => {
            expect(createWidget(-1).getDisplayState()).toEqual({ text: 'Rnd: -1', color: undefined, informational: false });
        });

        it('fixed seed shows the digits in the normal colour', () => {
            const widget = createWidget(42);
            widget.lastSeed = 99;
            expect(widget.getDisplayState()).toEqual({ text: '42', color: undefined, informational: false });
        });

        it('-2 / -3 keep their labels even when a last seed exists', () => {
            for (const [v, label] of [[SPECIAL_SEED_INCREMENT, 'Inc: -2'], [SPECIAL_SEED_DECREMENT, 'Dec: -3']]) {
                const widget = createWidget(-1);
                widget.value.value = v;
                widget.lastSeed = 5;
                expect(widget.getDisplayState().text).toBe(label);
            }
        });

        it('toggle OFF shows the stored literal, never the last seed', () => {
            const widget = createWidget(-1);
            widget.value.on = false;
            widget.lastSeed = 5;
            expect(widget.getDisplayState().text).toBe('Rnd: -1');
        });

        it('a 16-digit seed (max range) renders as 16 characters, the value-box budget', () => {
            const widget = createWidget(-1);
            widget.lastSeed = SEED_MAX - 1;
            expect(widget.getDisplayState().text.length).toBeLessThanOrEqual(16);
        });
    });
});
