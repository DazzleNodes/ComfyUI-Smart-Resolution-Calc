/**
 * Widget Validation — schemas, validation, corruption diagnostics, behavior constants
 *
 * Extracted from smart_resolution_calc.js (Phase 3 refactor).
 * Lines 76-285 of the original file.
 *
 * Contains:
 * - WIDGET_SCHEMAS: validation schemas for each widget type
 * - validateWidgetValue(): validates a widget value against its schema
 * - logCorruptionDiagnostics(): logs corruption warnings to console
 * - ToggleBehavior: toggle direction constraint modes
 * - ValueBehavior: value editability modes
 */

import { visibilityLogger } from '../utils/debug_logger.js';

// ============================================================================
// Widget Schemas (was lines 76-143)
// ============================================================================

const WIDGET_SCHEMAS = {
    output_image_mode: {
        validValues: ["auto", "empty", "transform (distort)", "transform (crop/pad)",
                     "transform (scale/crop)", "transform (scale/pad)"],
        default: "auto",
        description: "Image output mode"
    },
    fill_type: {
        validValues: ["black", "white", "custom_color", "noise", "random"],
        default: "black",
        description: "Fill type for image transformations"
    },
    fill_color: {
        default: "#522525",
        validator: (v) => /^#?[0-9A-Fa-f]{6}$/.test(v),
        description: "Custom fill color (hex format)"
    },
    batch_size: {
        default: 1,
        validator: (v) => typeof v === 'number' && !isNaN(v) && v >= 1 && Number.isInteger(v),
        description: "Batch size (positive integer)"
    },
    scale: {
        default: 1,
        validator: (v) => typeof v === 'number' && !isNaN(v) && v > 0,
        description: "Scale factor (positive number)"
    },
    divisible_by: {
        validValues: ["8", "16", "32", "64"],
        default: "16",
        description: "Dimension divisibility constraint"
    },
    custom_ratio: {
        default: false,
        validator: (v) => typeof v === 'boolean',
        description: "Whether to use custom aspect ratio"
    },
    dimension_megapixel: {
        default: {on: false, value: 1},
        validator: (v) => {
            if (typeof v !== 'object' || v === null) return false;
            if (typeof v.on !== 'boolean') return false;
            if (typeof v.value !== 'number' || isNaN(v.value)) return false;
            return v.value >= 0.1 && v.value <= 100; // Reasonable megapixel range
        },
        description: "Dimension megapixel control (object with on/value)"
    },
    dimension_width: {
        default: {on: false, value: 1024},
        validator: (v) => {
            if (typeof v !== 'object' || v === null) return false;
            if (typeof v.on !== 'boolean') return false;
            if (typeof v.value !== 'number' || isNaN(v.value)) return false;
            return v.value >= 64 && v.value <= 16384; // Reasonable pixel range
        },
        description: "Dimension width control (object with on/value)"
    },
    dimension_height: {
        default: {on: false, value: 1024},
        validator: (v) => {
            if (typeof v !== 'object' || v === null) return false;
            if (typeof v.on !== 'boolean') return false;
            if (typeof v.value !== 'number' || isNaN(v.value)) return false;
            return v.value >= 64 && v.value <= 16384; // Reasonable pixel range
        },
        description: "Dimension height control (object with on/value)"
    }
};

// ============================================================================
// validateWidgetValue (was lines 145-221)
// ============================================================================

/**
 * Validates a widget value against its schema
 *
 * @param {string} widgetName - Name of widget to validate
 * @param {*} value - Value to validate
 * @param {string} context - Context string for logging (e.g., "save" or "restore")
 * @returns {{valid: boolean, correctedValue: *, warnings: string[]}} Validation result
 */
function validateWidgetValue(widgetName, value, context = "unknown") {
    const schema = WIDGET_SCHEMAS[widgetName];
    const warnings = [];

    // No schema = no validation (allow value as-is)
    if (!schema) {
        return { valid: true, correctedValue: value, warnings };
    }

    // Check for object values (corruption pattern for widgets that should have primitives)
    // BUT: Some widgets (like DimensionWidgets) legitimately have object values
    const schemaExpectsObject = typeof schema.default === 'object' && schema.default !== null;

    if (typeof value === 'object' && value !== null && !schemaExpectsObject) {
        // Object value for a widget that should have primitive value = corruption
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} has object value (should be primitive)`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value type: ${typeof value}`);
        warnings.push(`   Value: ${JSON.stringify(value)}`);
        warnings.push(`   🔧 Self-healing: Using default value "${schema.default}"`);
        visibilityLogger.error(`[Validation-${context}] Object corruption in ${widgetName}:`, value);
        return { valid: false, correctedValue: schema.default, warnings };
    }

    // Check for index confusion (number when should be string)
    if (schema.validValues && typeof value === 'number') {
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} has numeric value (index confusion?)`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value: ${value} (type: ${typeof value})`);
        warnings.push(`   Expected type: string`);
        warnings.push(`   Valid values: [${schema.validValues.join(', ')}]`);

        // Attempt recovery: if value is valid index, use that array element
        if (value >= 0 && value < schema.validValues.length) {
            const corrected = schema.validValues[value];
            warnings.push(`   🔧 Self-healing: Interpreting ${value} as index → "${corrected}"`);
            visibilityLogger.error(`[Validation-${context}] Index confusion in ${widgetName}: ${value} → ${corrected}`);
            return { valid: false, correctedValue: corrected, warnings };
        } else {
            warnings.push(`   🔧 Self-healing: Index ${value} out of range, using default "${schema.default}"`);
            visibilityLogger.error(`[Validation-${context}] Invalid index in ${widgetName}: ${value}`);
            return { valid: false, correctedValue: schema.default, warnings };
        }
    }

    // Check if value in valid set (for enum-like widgets)
    if (schema.validValues && !schema.validValues.includes(value)) {
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} has invalid value`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value: "${value}"`);
        warnings.push(`   Valid values: [${schema.validValues.join(', ')}]`);
        warnings.push(`   🔧 Self-healing: Using default value "${schema.default}"`);
        visibilityLogger.error(`[Validation-${context}] Invalid value in ${widgetName}: "${value}"`);
        return { valid: false, correctedValue: schema.default, warnings };
    }

    // Check custom validator (for non-enum values like fill_color)
    if (schema.validator && !schema.validator(value)) {
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} failed validation`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value: "${value}"`);
        warnings.push(`   🔧 Self-healing: Using default value "${schema.default}"`);
        visibilityLogger.error(`[Validation-${context}] Validation failed for ${widgetName}: "${value}"`);
        return { valid: false, correctedValue: schema.default, warnings };
    }

    // Value is valid
    return { valid: true, correctedValue: value, warnings };
}

// ============================================================================
// logCorruptionDiagnostics (was lines 223-253)
// ============================================================================

/**
 * Logs corruption diagnostics to console (visible to users and developers)
 *
 * @param {string[]} warnings - Array of warning messages
 * @param {object} context - Additional context for debugging
 */
function logCorruptionDiagnostics(warnings, context = {}) {
    if (warnings.length === 0) return;

    console.group('🚨 WIDGET CORRUPTION DETECTED - Smart Resolution Calculator');
    console.error('═'.repeat(80));
    warnings.forEach(msg => console.error(msg));

    if (Object.keys(context).length > 0) {
        console.error('');
        console.error('Additional Context:');
        Object.keys(context).forEach(key => {
            console.error(`   ${key}: ${JSON.stringify(context[key])}`);
        });
    }

    console.error('═'.repeat(80));
    console.error('Stack trace for debugging:');
    console.trace();
    console.error('═'.repeat(80));
    console.error('');
    console.error('💡 This self-healed automatically with default values.');
    console.error('💡 Please report this to the developer with the above information.');
    console.error('💡 GitHub: https://github.com/djdarcy/ComfyUI-Smart-Resolution-Calc/issues/8');
    console.groupEnd();
}

// ============================================================================
// Behavior Constants (was lines 255-285)
// ============================================================================

/**
 * Toggle Behavior Modes
 *
 * Controls when a toggle can be enabled/disabled.
 *
 * - SYMMETRIC: Can toggle both ON→OFF and OFF→ON freely
 *   Example: DimensionWidget can be enabled/disabled anytime
 *
 * - ASYMMETRIC: Can toggle one direction freely, other direction has constraints
 *   Example: ImageModeWidget can be disabled anytime, but can only be enabled when image connected
 */
const ToggleBehavior = {
    SYMMETRIC: 'symmetric',      // Can toggle both directions freely
    ASYMMETRIC: 'asymmetric'     // One direction free, other has constraints
};

/**
 * Value Behavior Modes
 *
 * Controls when widget values can be edited.
 *
 * - ALWAYS: Values are always editable regardless of toggle state
 *   Example: DimensionWidget values can be edited even when toggle is OFF
 *
 * - CONDITIONAL: Values only editable when certain conditions met
 *   Example: ImageModeWidget mode selector only editable when toggle is ON and image connected
 */
const ValueBehavior = {
    ALWAYS: 'always',            // Always editable
    CONDITIONAL: 'conditional'   // Only editable when conditions met
};

// ============================================================================
// Exports
// ============================================================================

export {
    WIDGET_SCHEMAS,
    validateWidgetValue,
    logCorruptionDiagnostics,
    ToggleBehavior,
    ValueBehavior
};
