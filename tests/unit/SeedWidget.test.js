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
        it('returns value as-is for fixed seeds', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 42 };
            const result = widget.serializeValue({}, 0);
            expect(result).toEqual({ on: true, value: 42 });
        });

        it('resolves special values and returns copy', () => {
            const widget = createWidget();
            widget.value = { on: true, value: -1 };
            widget.randomizeMode = true;
            const result = widget.serializeValue({}, 0);
            expect(result.on).toBe(true);
            expect(result.value).toBeGreaterThanOrEqual(0);
            // Original value should stay at -1 (randomizeMode preserves it)
            expect(widget.value.value).toBe(-1);
        });

        it('updates lastSeed after resolve', () => {
            const widget = createWidget();
            widget.value = { on: true, value: -1 };
            widget.randomizeMode = true;
            const result = widget.serializeValue({}, 0);
            expect(widget.lastSeed).toBe(result.value);
        });

        it('tracks lastSeed for non-negative values', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 42 };
            widget.serializeValue({}, 0);
            expect(widget.lastSeed).toBe(42);
        });
    });
});
