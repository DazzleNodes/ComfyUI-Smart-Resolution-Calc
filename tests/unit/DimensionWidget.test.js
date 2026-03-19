import { describe, it, expect, vi } from 'vitest';
import { DimensionWidget } from '../../web/components/DimensionWidget.js';

describe('DimensionWidget', () => {
    const mockServices = { prompt: vi.fn() };

    function createWidget(name = 'dimension_width', defaultValue = 1024, isInteger = true) {
        return new DimensionWidget(name, defaultValue, isInteger, { services: mockServices });
    }

    function createMockNode(divisibleBy = '16') {
        return {
            widgets: [{ name: 'divisible_by', value: divisibleBy }],
            setDirtyCanvas: vi.fn(),
            dimensionSourceManager: { invalidateCache: vi.fn() },
            updateModeWidget: vi.fn(),
        };
    }

    describe('constructor', () => {
        it('enforces { on: boolean, value: number } shape', () => {
            const widget = createWidget();
            expect(widget.value).toEqual({ on: false, value: 1024 });
        });

        it('sets isInteger flag', () => {
            const intWidget = createWidget('w', 1024, true);
            expect(intWidget.isInteger).toBe(true);

            const floatWidget = createWidget('mp', 1.0, false);
            expect(floatWidget.isInteger).toBe(false);
        });

        it('initializes hit areas', () => {
            const widget = createWidget();
            expect(widget.hitAreas.toggle).toBeDefined();
            expect(widget.hitAreas.valueDec).toBeDefined();
            expect(widget.hitAreas.valueInc).toBeDefined();
            expect(widget.hitAreas.valueEdit).toBeDefined();
        });
    });

    describe('changeValue', () => {
        it('increments integer by divisible_by value', () => {
            const widget = createWidget('w', 1024, true);
            const node = createMockNode('16');
            widget.changeValue(1, node);
            expect(widget.value.value).toBe(1040);
        });

        it('decrements integer by divisible_by value', () => {
            const widget = createWidget('w', 1024, true);
            const node = createMockNode('16');
            widget.changeValue(-1, node);
            expect(widget.value.value).toBe(1008);
        });

        it('respects Exact divisibility (increment by 1)', () => {
            const widget = createWidget('w', 1024, true);
            const node = createMockNode('Exact');
            widget.changeValue(1, node);
            expect(widget.value.value).toBe(1025);
        });

        it('respects divisible_by=32', () => {
            const widget = createWidget('w', 1024, true);
            const node = createMockNode('32');
            widget.changeValue(1, node);
            expect(widget.value.value).toBe(1056);
        });

        it('enforces minimum of 64 for integers', () => {
            const widget = createWidget('w', 64, true);
            const node = createMockNode('16');
            widget.changeValue(-1, node);
            expect(widget.value.value).toBe(64); // Can't go below 64
        });

        it('increments float (megapixel) by 0.1', () => {
            const widget = createWidget('mp', 1.0, false);
            const node = createMockNode();
            widget.changeValue(1, node);
            expect(widget.value.value).toBeCloseTo(1.1);
        });

        it('decrements float by 0.1', () => {
            const widget = createWidget('mp', 1.0, false);
            const node = createMockNode();
            widget.changeValue(-1, node);
            expect(widget.value.value).toBeCloseTo(0.9);
        });

        it('enforces minimum of 0.1 for floats', () => {
            const widget = createWidget('mp', 0.1, false);
            const node = createMockNode();
            widget.changeValue(-1, node);
            expect(widget.value.value).toBeCloseTo(0.1);
        });
    });

    describe('serializeValue', () => {
        it('returns { on, value } structure', () => {
            const widget = createWidget();
            widget.value = { on: true, value: 512 };
            const result = widget.serializeValue({}, 0);
            expect(result).toEqual({ on: true, value: 512 });
        });
    });

    describe('toggle via handleToggleClick', () => {
        it('flips on state', () => {
            const widget = createWidget();
            widget.hitAreas.toggle = { x: 10, y: 0, width: 30, height: 24 };
            expect(widget.value.on).toBe(false);

            const clicked = widget.handleToggleClick({ type: 'pointerdown' }, [15, 12]);
            expect(clicked).toBe(true);
            expect(widget.value.on).toBe(true);
        });

        it('ignores clicks outside toggle area', () => {
            const widget = createWidget();
            widget.hitAreas.toggle = { x: 10, y: 0, width: 30, height: 24 };

            const clicked = widget.handleToggleClick({ type: 'pointerdown' }, [200, 12]);
            expect(clicked).toBe(false);
            expect(widget.value.on).toBe(false);
        });

        it('ignores non-pointerdown events', () => {
            const widget = createWidget();
            widget.hitAreas.toggle = { x: 10, y: 0, width: 30, height: 24 };

            const clicked = widget.handleToggleClick({ type: 'pointermove' }, [15, 12]);
            expect(clicked).toBe(false);
        });
    });
});
