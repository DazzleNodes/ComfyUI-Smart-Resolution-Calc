/**
 * DimensionWidget — toggle-based dimension input (width, height, megapixel)
 *
 * Extracted from smart_resolution_calc.js (Phase 4 refactor).
 * Lines 1715-2060 of the original file.
 *
 * Compact rgthree-style widget with ON/OFF toggle, label, and +/- number input.
 * Data: { on: boolean, value: number }
 *
 * Dependencies:
 * - ToggleBehavior, ValueBehavior from WidgetValidation.js
 * - InfoIcon from TooltipSystem.js
 * - logger from debug_logger.js
 * - app (ComfyUI global) — accessed at runtime, not imported
 * - ScaleWidget — referenced via instanceof for image refresh; passed via node.widgets
 */

import { DazzleWidget, WIDGET_MARGIN, WIDGET_INNER_MARGIN, WIDGET_LABEL_FONT, WIDGET_LABEL_COLOR_ON, WIDGET_LABEL_COLOR_OFF } from './DazzleWidget.js';
import { ToggleBehavior, ValueBehavior } from './WidgetValidation.js';
import { logger } from '../utils/debug_logger.js';

class DimensionWidget extends DazzleWidget {
    constructor(name, defaultValue, isInteger = true, config = {}) {
        super(name, { on: false, value: defaultValue }, config);
        this.isInteger = isInteger;

        // Behavior configuration
        // - Toggle Behavior: Controls when toggle can be enabled/disabled
        // - Value Behavior: Controls when values can be edited
        this.toggleBehavior = config.toggleBehavior ?? ToggleBehavior.SYMMETRIC;
        this.valueBehavior = config.valueBehavior ?? ValueBehavior.ALWAYS;

        // Hit areas for mouse interaction (updated during draw)
        this.hitAreas = {
            toggle: { x: 0, y: 0, width: 0, height: 0 },
            valueDec: { x: 0, y: 0, width: 0, height: 0 },
            valueInc: { x: 0, y: 0, width: 0, height: 0 },
            valueEdit: { x: 0, y: 0, width: 0, height: 0 }
        };
    }

    /**
     * Draw compact widget (rgthree-style)
     * Height: 24px (compact), Margins: 3px (tight)
     */
    draw(ctx, node, width, y, height) {
        // Draw shared frame: background, toggle, set hitAreas.toggle
        const { posX: labelX, midY, margin, innerMargin } = this.drawWidgetFrame(ctx, node, width, y, height, this.value.on);
        let posX = labelX;

        // Draw label with special handling for megapixel default state
        let labelColor = this.value.on ? WIDGET_LABEL_COLOR_ON : WIDGET_LABEL_COLOR_OFF;

        // If megapixel is disabled but acting as default (no other dimensions active), make it whiter
        if (!this.value.on && this.name === "dimension_megapixel") {
            const widthWidget = node.widgets.find(w => w.name === "dimension_width");
            const heightWidget = node.widgets.find(w => w.name === "dimension_height");
            const widthActive = widthWidget?.value?.on ?? false;
            const heightActive = heightWidget?.value?.on ?? false;

            // If no other dimensions are constraining, megapixel is the default
            if (!widthActive && !heightActive) {
                labelColor = "#dddddd";  // Whiter to indicate it's active as default
            }
        }

        ctx.fillStyle = labelColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = WIDGET_LABEL_FONT;

        const labelText = this.name.replace("dimension_", "").replace("_", " ").toUpperCase();
        const labelTextWidth = ctx.measureText(labelText).width;
        ctx.fillText(labelText, posX, midY);

        // Set tooltip trigger area on label (if tooltip configured)
        if (this.infoIcon) {
            this.infoIcon.setHitArea(posX, y, labelTextWidth, height);
        }

        // Draw number controls (RIGHT side)
        const numberWidth = 110;  // Reduced from 120 for compact layout
        const numberX = width - WIDGET_MARGIN - numberWidth - WIDGET_INNER_MARGIN;

        if (this.value.on) {
            const displayValue = this.isInteger ? String(Math.round(this.value.value)) : this.value.value.toFixed(1);
            this.drawNumberWidget(ctx, numberX, y, numberWidth, height, this.value.on, { displayValue });
        } else {
            // Draw grayed out value (still clickable to edit - symmetric behavior)
            ctx.fillStyle = "#555555";
            ctx.textAlign = "center";
            ctx.font = "12px monospace";
            const displayValue = this.isInteger ? String(Math.round(this.value.value)) : this.value.value.toFixed(1);
            ctx.fillText(displayValue, numberX + numberWidth / 2, midY);

            // Set hit area for value editing (symmetric behavior - always editable)
            this.hitAreas.valueEdit = { x: numberX, y: y, width: numberWidth, height: height };

            // Clear +/- button hit areas (buttons not shown when toggle OFF)
            this.hitAreas.valueDec = { x: 0, y: 0, width: 0, height: 0 };
            this.hitAreas.valueInc = { x: 0, y: 0, width: 0, height: 0 };
        }

        ctx.restore();
    }

    // drawToggle() — inherited from DazzleWidget (rgthree-style ON/OFF pill)
    // drawNumberWidget() — inherited from DazzleWidget (+/- buttons with value display)

    /**
     * Handle mouse events
     */
    mouse(event, pos, node) {
        const canvas = app.canvas;

        // Check info icon first (tooltip on label) if configured
        if (this.handleTooltipMouse(event, pos, node)) return true;

        if (event.type === "pointerdown") {
            this.mouseDowned = [...pos];
            this.isMouseDownedAndOver = true;

            // Check toggle click
            if (this.isInBounds(pos, this.hitAreas.toggle)) {
                const oldState = this.value.on;
                this.value.on = !this.value.on;
                logger.debug(`Toggle clicked: ${this.name} - ${oldState} \u2192 ${this.value.on}`);

                // Invalidate dimension source cache when toggle changes
                node.dimensionSourceManager?.invalidateCache();
                node.updateModeWidget?.(); // Update MODE widget

                // Refresh image dimensions if image is connected and USE_IMAGE is enabled
                // This ensures fresh image data is loaded when dimension toggles change
                const imageWidget = node.widgets?.find(w => w.name === "image_mode");
                const imageConnected = imageWidget && !imageWidget.imageDisconnected;
                const useImageEnabled = imageWidget?.value?.on;

                if (imageConnected && useImageEnabled) {
                    // Find ScaleWidget by checking for refreshImageDimensions method
                    // (avoids importing ScaleWidget and creating circular dependency)
                    const scaleWidget = node.widgets?.find(w => w.refreshImageDimensions);
                    if (scaleWidget) {
                        logger.info(`[${this.name}] Dimension toggle changed, refreshing image data`);
                        scaleWidget.refreshImageDimensions(node);
                    }
                }

                node.setDirtyCanvas(true);
                return true;
            }

            // Value editing - check behavior mode
            // ALWAYS: Values editable regardless of toggle state (default)
            // CONDITIONAL: Values only editable when toggle ON
            const allowValueEdit = this.value.on ||
                                   (this.valueBehavior === ValueBehavior.ALWAYS);

            if (allowValueEdit) {
                // Decrement button
                if (this.isInBounds(pos, this.hitAreas.valueDec)) {
                    this.changeValue(-1, node);

                    // Invalidate dimension source cache when value changes
                    node.dimensionSourceManager?.invalidateCache();
                    node.updateModeWidget?.(); // Update MODE widget

                    node.setDirtyCanvas(true);
                    return true;
                }

                // Increment button
                if (this.isInBounds(pos, this.hitAreas.valueInc)) {
                    this.changeValue(1, node);

                    // Invalidate dimension source cache when value changes
                    node.dimensionSourceManager?.invalidateCache();
                    node.updateModeWidget?.(); // Update MODE widget

                    node.setDirtyCanvas(true);
                    return true;
                }

                // Value edit (prompt for new value)
                if (this.isInBounds(pos, this.hitAreas.valueEdit)) {
                    const currentValue = this.isInteger ? Math.round(this.value.value) : this.value.value;
                    canvas.prompt("Enter value", String(currentValue), (newValue) => {
                        const parsed = parseFloat(newValue);
                        if (!isNaN(parsed)) {
                            this.value.value = this.isInteger ? Math.round(parsed) : parsed;

                            // Invalidate dimension source cache when value changes
                            node.dimensionSourceManager?.invalidateCache();
                            node.updateModeWidget?.(); // Update MODE widget

                            node.setDirtyCanvas(true);
                        }
                    }, event);
                    return true;
                }
            }
        }

        return false;
    }

    // isInBounds() — inherited from DazzleWidget

    /**
     * Change value by increment
     */
    changeValue(delta, node) {
        if (this.isInteger) {
            // Get divisible_by setting from node
            let increment = 8; // Default to 8 for divisibility-friendly increments
            if (node && node.widgets) {
                const divisibleWidget = node.widgets.find(w => w.name === "divisible_by");
                if (divisibleWidget) {
                    if (divisibleWidget.value === "Exact") {
                        increment = 1;
                    } else {
                        const divisor = parseInt(divisibleWidget.value);
                        if (!isNaN(divisor)) {
                            increment = divisor;
                        }
                    }
                }
            }
            // Integer: increment by divisible_by value
            this.value.value = Math.max(64, Math.round(this.value.value) + delta * increment);
        } else {
            // Float: increment by 0.1
            this.value.value = Math.max(0.1, Math.round((this.value.value + delta * 0.1) * 10) / 10);
        }
    }

    // computeSize() — inherited from DazzleWidget (24px compact height)

    /**
     * Serialize value for workflow JSON
     */
    serializeValue(node, index) {
        logger.debug(`serializeValue called: ${this.name} (index ${index}) =`, this.value);
        return this.value;
    }
}

export { DimensionWidget };
