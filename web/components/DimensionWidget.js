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

import { ToggleBehavior, ValueBehavior } from './WidgetValidation.js';
import { InfoIcon } from './TooltipSystem.js';
import { logger } from '../utils/debug_logger.js';

class DimensionWidget {
    constructor(name, defaultValue, isInteger = true, config = {}) {
        this.name = name;
        this.type = "custom";
        this.isInteger = isInteger;
        this.value = {
            on: false,
            value: defaultValue
        };

        // Behavior configuration
        // - Toggle Behavior: Controls when toggle can be enabled/disabled
        // - Value Behavior: Controls when values can be edited
        this.toggleBehavior = config.toggleBehavior ?? ToggleBehavior.SYMMETRIC;
        this.valueBehavior = config.valueBehavior ?? ValueBehavior.ALWAYS;

        // Mouse state
        this.mouseDowned = null;
        this.isMouseDownedAndOver = false;

        // Hit areas for mouse interaction (updated during draw)
        this.hitAreas = {
            toggle: { x: 0, y: 0, width: 0, height: 0 },
            valueDec: { x: 0, y: 0, width: 0, height: 0 },
            valueInc: { x: 0, y: 0, width: 0, height: 0 },
            valueEdit: { x: 0, y: 0, width: 0, height: 0 }
        };

        // Optional tooltip support (only used for MEGAPIXEL)
        this.infoIcon = config.tooltipContent ? new InfoIcon(config.tooltipContent) : null;
    }

    /**
     * Draw compact widget (rgthree-style)
     * Height: 24px (compact), Margins: 3px (tight)
     */
    draw(ctx, node, width, y, height) {
        const margin = 15;
        const innerMargin = 3;  // Reduced from 5px for tighter layout
        const midY = y + height / 2;

        ctx.save();

        // Draw background (rounded)
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, height - 2, 4);
        ctx.fill();

        let posX = margin + innerMargin;

        // Draw toggle switch (LEFT side)
        const toggleWidth = height * 1.5;
        this.drawToggle(ctx, posX, y, height, this.value.on);
        this.hitAreas.toggle = { x: posX, y: y, width: toggleWidth, height: height };
        posX += toggleWidth + innerMargin * 2;

        // Draw label with special handling for megapixel default state
        let labelColor = this.value.on ? "#ffffff" : "#888888";

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
        ctx.font = "13px sans-serif";  // Slightly smaller for compact layout

        const labelText = this.name.replace("dimension_", "").replace("_", " ").toUpperCase();
        const labelTextWidth = ctx.measureText(labelText).width;
        ctx.fillText(labelText, posX, midY);

        // Set tooltip trigger area on label (if tooltip configured)
        if (this.infoIcon) {
            this.infoIcon.setHitArea(posX, y, labelTextWidth, height);
        }

        // Draw number controls (RIGHT side)
        const numberWidth = 110;  // Reduced from 120 for compact layout
        const numberX = width - margin - numberWidth - innerMargin;

        if (this.value.on) {
            this.drawNumberWidget(ctx, numberX, y, numberWidth, height, this.value.on);
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

    /**
     * Draw toggle switch (rgthree-style)
     */
    drawToggle(ctx, x, y, height, state) {
        const radius = height * 0.36;
        const bgWidth = height * 1.5;

        ctx.save();

        // Toggle track background
        ctx.beginPath();
        ctx.roundRect(x + 4, y + 4, bgWidth - 8, height - 8, height * 0.5);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Toggle circle
        const circleX = state ? x + height : x + height * 0.5;
        ctx.beginPath();
        ctx.arc(circleX, y + height * 0.5, radius, 0, Math.PI * 2);
        ctx.fillStyle = state ? "#4CAF50" : "#888888";
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draw number input widget with +/- buttons (compact)
     */
    drawNumberWidget(ctx, x, y, width, height, isActive) {
        const buttonWidth = 18;  // Reduced from 20 for compact layout
        const midY = y + height / 2;

        ctx.save();

        // Value background
        ctx.fillStyle = isActive ? "#2a2a2a" : "#1a1a1a";
        ctx.beginPath();
        ctx.roundRect(x, y + 2, width, height - 4, 3);
        ctx.fill();

        // Decrement button [-]
        ctx.fillStyle = "#444444";
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 3, buttonWidth, height - 6, 2);
        ctx.fill();
        this.hitAreas.valueDec = { x: x, y: y, width: buttonWidth + 4, height: height };

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "14px sans-serif";
        ctx.fillText("\u2212", x + buttonWidth / 2 + 2, midY);

        // Value display (clickable to edit)
        const valueX = x + buttonWidth + 4;
        const valueWidth = width - (buttonWidth + 4) * 2;
        this.hitAreas.valueEdit = { x: valueX, y: y, width: valueWidth, height: height };

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.font = "12px monospace";
        const displayValue = this.isInteger ? String(Math.round(this.value.value)) : this.value.value.toFixed(1);
        ctx.fillText(displayValue, valueX + valueWidth / 2, midY);

        // Increment button [+]
        ctx.fillStyle = "#444444";
        ctx.beginPath();
        ctx.roundRect(x + width - buttonWidth - 2, y + 3, buttonWidth, height - 6, 2);
        ctx.fill();
        this.hitAreas.valueInc = { x: x + width - buttonWidth - 4, y: y, width: buttonWidth + 4, height: height };

        ctx.fillStyle = "#ffffff";
        ctx.fillText("+", x + width - buttonWidth / 2 - 2, midY);

        ctx.restore();
    }

    /**
     * Handle mouse events
     */
    mouse(event, pos, node) {
        const canvas = app.canvas;

        // Check info icon first (tooltip on label) if configured
        if (this.infoIcon) {
            const canvasBounds = { width: node.size[0], height: node.size[1] };
            if (this.infoIcon.mouse(event, pos, canvasBounds, node.pos)) {
                node.setDirtyCanvas(true);
                return true; // Tooltip handled the event
            }
        }

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

    /**
     * Check if position is within bounds
     */
    isInBounds(pos, bounds) {
        if (!bounds) return false;  // Guard against undefined bounds
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

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

    /**
     * Compute size for layout (compact height)
     */
    computeSize(width) {
        return [width, 24];  // Reduced from 30px for compact layout
    }

    /**
     * Serialize value for workflow JSON
     */
    serializeValue(node, index) {
        logger.debug(`serializeValue called: ${this.name} (index ${index}) =`, this.value);
        return this.value;
    }
}

export { DimensionWidget };
