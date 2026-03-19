import { describe, it, expect, vi } from 'vitest';
import { SeedWidget, SPECIAL_SEED_RANDOM, SPECIAL_SEED_INCREMENT, SPECIAL_SEED_DECREMENT, SEED_MAX } from '../../web/components/SeedWidget.js';

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
});
