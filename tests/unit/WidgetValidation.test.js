import { describe, it, expect } from 'vitest';
import { validateWidgetValue, WIDGET_SCHEMAS } from '../../web/components/WidgetValidation.js';

describe('validateWidgetValue', () => {
    describe('output_image_mode', () => {
        it('accepts valid values', () => {
            const result = validateWidgetValue('output_image_mode', 'auto', 'test');
            expect(result.valid).toBe(true);
            expect(result.correctedValue).toBe('auto');
        });

        it('rejects invalid string values', () => {
            const result = validateWidgetValue('output_image_mode', 'INVALID', 'test');
            expect(result.valid).toBe(false);
            expect(result.correctedValue).toBe('auto'); // default
            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('corrects numeric index confusion (e.g., 0 -> "auto")', () => {
            const result = validateWidgetValue('output_image_mode', 0, 'test');
            expect(result.valid).toBe(false);
            expect(result.correctedValue).toBe('auto'); // index 0
        });

        it('corrects object corruption for primitive widget', () => {
            const result = validateWidgetValue('output_image_mode', { on: true, value: 0 }, 'test');
            expect(result.valid).toBe(false);
            expect(result.correctedValue).toBe('auto'); // default
        });
    });

    describe('fill_type', () => {
        it('accepts valid fill types', () => {
            const result = validateWidgetValue('fill_type', 'black', 'test');
            expect(result.valid).toBe(true);
        });

        it('rejects color hex as fill_type (cross-contamination)', () => {
            // This is the exact corruption pattern from Issue #8
            const result = validateWidgetValue('fill_type', '#522525', 'test');
            expect(result.valid).toBe(false);
            expect(result.correctedValue).toBe('black');
        });
    });

    describe('dimension widgets (object values)', () => {
        it('accepts valid dimension_width value', () => {
            const result = validateWidgetValue('dimension_width', { on: true, value: 1024 }, 'test');
            expect(result.valid).toBe(true);
        });

        it('rejects string value for dimension_width', () => {
            const result = validateWidgetValue('dimension_width', 'invalid', 'test');
            expect(result.valid).toBe(false);
        });
    });

    describe('unknown widgets', () => {
        it('passes through unknown widget names without validation', () => {
            const result = validateWidgetValue('nonexistent_widget', 'anything', 'test');
            expect(result.valid).toBe(true);
            expect(result.correctedValue).toBe('anything');
        });
    });

    describe('fill_color', () => {
        it('accepts valid hex colors', () => {
            const result = validateWidgetValue('fill_color', '#FF0000', 'test');
            expect(result.valid).toBe(true);
        });

        it('rejects invalid hex colors', () => {
            const result = validateWidgetValue('fill_color', 'not-a-color', 'test');
            expect(result.valid).toBe(false);
            expect(result.correctedValue).toBe('#522525'); // default
        });
    });
});
