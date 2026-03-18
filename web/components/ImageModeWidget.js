/**
 * ImageModeWidget -- toggle-based USE IMAGE DIMS widget
 *
 * Extracted from smart_resolution_calc.js (Phase 8 refactor).
 *
 * Dependencies:
 * - ToggleBehavior, ValueBehavior from WidgetValidation.js
 * - InfoIcon from TooltipSystem.js  
 * - logger, dimensionLogger from debug_logger.js
 * - app (ComfyUI global) -- accessed at runtime
 * Note: ScaleWidget and DimensionWidget accessed via node.widgets (duck-typing)
 *       TOOLTIP_CONTENT passed via constructor config
 */

import { ToggleBehavior, ValueBehavior } from './WidgetValidation.js';
import { InfoIcon } from './TooltipSystem.js';
import { logger, dimensionLogger } from '../utils/debug_logger.js';

/**
 * Image Mode Widget
 * Compact widget with toggle (LEFT) and mode selector (RIGHT)
 * Answers the question "USE IMAGE DIMS?" with ON/OFF + AR Only/Exact Dims
 */
class ImageModeWidget {
    constructor(name = "image_mode", config = {}) {
        this.name = name;
        this.type = "custom";
        this.value = {
            on: false,  // Default: disabled
            value: 0    // 0 = AR Only, 1 = Exact Dims
        };

        // Behavior configuration (both default to asymmetric/conditional for USE_IMAGE)
        // - Toggle: Can't enable without image (asymmetric)
        // - Values (mode): Can't change when toggle OFF or image disconnected (conditional)
        this.toggleBehavior = config.toggleBehavior ?? ToggleBehavior.ASYMMETRIC;
        this.valueBehavior = config.valueBehavior ?? ValueBehavior.CONDITIONAL;

        // Mode labels
        this.modes = ["AR Only", "Exact Dims"];

        // Track image connection state (set by onConnectionsChange)
        // NOTE: Don't use 'disabled' - LiteGraph checks it and blocks mouse() calls
        this.imageDisconnected = false;  // False = image connected, True = no image

        // Mouse state
        this.mouseDowned = null;
        this.isMouseDownedAndOver = false;

        // Hit areas
        this.hitAreas = {
            toggle: { x: 0, y: 0, width: 0, height: 0 },
            modeSelector: { x: 0, y: 0, width: 0, height: 0 }
        };

        // Info icon for tooltip
        this.infoIcon = config.tooltipContent ? new InfoIcon(config.tooltipContent) : null;
    }

    /**
     * Draw compact widget matching DimensionWidget style
     * Layout: [Toggle] USE IMAGE DIMS? [AR Only/Exact Dims]
     * Note: Visual appearance unchanged when disabled, only blocks clicks
     */
    draw(ctx, node, width, y, height) {
        const margin = 15;
        const innerMargin = 3;
        const midY = y + height / 2;

        ctx.save();

        // Background (normal appearance always)
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, height - 2, 4);
        ctx.fill();

        let posX = margin + innerMargin;

        // Draw toggle switch (LEFT) - matching DimensionWidget style
        const toggleWidth = height * 1.5;
        this.drawToggle(ctx, posX, y, height, this.value.on);

        // Always set toggle hit area - mouse() handles asymmetric logic
        // (allows turning OFF when disabled, blocks turning ON)
        this.hitAreas.toggle = { x: posX, y, width: toggleWidth, height };

        posX += toggleWidth + innerMargin * 2;

        // Draw label (MIDDLE) - "USE IMAGE DIMS?"
        const labelText = "USE IMAGE DIMS?";
        ctx.fillStyle = this.value.on ? "#ffffff" : "#888888";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "13px sans-serif";

        // Measure text width to position icon correctly
        const labelTextWidth = ctx.measureText(labelText).width;
        const labelStartX = posX;

        ctx.fillText(labelText, labelStartX, midY);

        // Calculate mode selector position (RIGHT side)
        const modeWidth = 100;  // Fixed width for mode selector
        const modeX = width - margin - modeWidth - innerMargin;

        // Draw mode selector (RIGHT)
        const modeText = this.modes[this.value.value];

        // Mode background (subtle highlight if enabled)
        if (this.value.on) {
            ctx.fillStyle = "#2a2a2a";
            ctx.beginPath();
            ctx.roundRect(modeX, y + 2, modeWidth, height - 4, 3);
            ctx.fill();
        }

        // Mode text
        ctx.fillStyle = this.value.on ? "#ffffff" : "#666666";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(modeText, modeX + modeWidth / 2, midY);

        // Only set mode selector hit area when image connected
        // (mouse() method will still block it, but this prevents visual feedback)
        if (!this.imageDisconnected) {
            this.hitAreas.modeSelector = { x: modeX, y, width: modeWidth, height };
        } else {
            this.hitAreas.modeSelector = { x: 0, y: 0, width: 0, height: 0 };
        }

        // Set tooltip trigger area to the label text itself (no icon drawn)
        // Hover over "USE IMAGE?" label shows tooltip, Shift+Click opens docs
        this.infoIcon.setHitArea(labelStartX, y, labelTextWidth, height);

        ctx.restore();
    }

    /**
     * Draw toggle switch (matching DimensionWidget style exactly)
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

        // Toggle circle (green when ON, gray when OFF)
        const circleX = state ? x + height : x + height * 0.5;
        ctx.beginPath();
        ctx.arc(circleX, y + height * 0.5, radius, 0, Math.PI * 2);
        ctx.fillStyle = state ? "#4CAF50" : "#888888";  // Green when ON, gray when OFF
        ctx.fill();

        ctx.restore();
    }

    /**
     * Handle mouse events
     * Asymmetric logic when no image connected:
     * - Allow turning OFF (user wants to disable USE_IMAGE)
     * - Block turning ON (doesn't make sense without image)
     * - Block mode selector entirely
     */
    mouse(event, pos, node) {
        // Check info icon first (before other interactions)
        // Pass node position for coordinate conversion (node-local → canvas-global)
        const canvasBounds = { width: node.size[0], height: node.size[1] };
        if (this.infoIcon.mouse(event, pos, canvasBounds, node.pos)) {
            node.setDirtyCanvas(true);
            return true; // Icon handled the event
        }

        if (event.type === "pointerdown") {
            logger.debug(`ImageModeWidget.mouse() - imageDisconnected: ${this.imageDisconnected}, value.on: ${this.value.on}, pos: [${pos[0]}, ${pos[1]}]`);
            logger.debug('Toggle hit area:', this.hitAreas.toggle);

            this.mouseDowned = [...pos];
            this.isMouseDownedAndOver = true;

            // Toggle click
            const inToggleBounds = this.isInBounds(pos, this.hitAreas.toggle);
            logger.debug(`Toggle bounds check: ${inToggleBounds}`);

            if (inToggleBounds) {
                const oldState = this.value.on;
                const newState = !this.value.on;

                logger.debug(`Toggle clicked: ${oldState} → ${newState}, imageDisconnected: ${this.imageDisconnected}`);

                // Toggle behavior check (asymmetric by default)
                if (this.toggleBehavior === ToggleBehavior.ASYMMETRIC) {
                    // Asymmetric logic when image disconnected:
                    // - Allow ON → OFF (user turning it off is fine)
                    // - Block OFF → ON (can't enable without image)
                    //
                    // DEPRECATED (v0.6.1+): This logic path should now be unreachable because the
                    // widget is auto-hidden when image input is disconnected. Preserved as defensive
                    // fallback in case visibility system has edge cases or is disabled in future.
                    if (this.imageDisconnected && newState === true) {
                        logger.debug('Toggle blocked: Cannot enable without image (asymmetric toggle behavior)');
                        return false;
                    }
                }
                // Symmetric toggle behavior would skip this check (always allow)

                this.value.on = newState;
                // dimensionLogger.debug('[TOGGLE] Image mode toggled:', oldState, '→', newState);
                logger.debug(`Image mode toggled: ${oldState} → ${this.value.on}`);

                // NEW: Mutual exclusivity - disable custom_ratio when enabling USE IMAGE DIMS (any mode)
                // Both Exact Dims and AR Only use image data, so both are mutually exclusive with custom_ratio
                if (newState === true) {  // Turning ON (either Exact Dims or AR Only)
                    const customRatioWidget = node.widgets?.find(w => w.name === "custom_ratio");
                    if (customRatioWidget && customRatioWidget.value === true) {
                        customRatioWidget.value = false;
                        const modeName = this.modes[this.value.value];
                        logger.info(`[ImageMode] Auto-disabled custom_ratio due to mutual exclusivity with USE IMAGE DIMS (${modeName})`);
                    }
                }

                // Invalidate dimension source cache when USE_IMAGE toggle changes
                node.dimensionSourceManager?.invalidateCache();
                node.updateModeWidget?.(); // Update MODE widget

                // Trigger scale dimension refresh when USE_IMAGE is toggled
                // IMPORTANT: Find the custom ScaleWidget instance, not the hidden default widget
                const scaleWidget = node.widgets?.find(w => w.refreshImageDimensions);
                // dimensionLogger.verbose('[TOGGLE] scaleWidget found:', scaleWidget);
                // dimensionLogger.verbose('[TOGGLE] scaleWidget.refreshImageDimensions exists:', scaleWidget?.refreshImageDimensions);
                // dimensionLogger.verbose('[TOGGLE] typeof refreshImageDimensions:', typeof scaleWidget?.refreshImageDimensions);

                if (scaleWidget?.refreshImageDimensions) {
                    // dimensionLogger.debug('[TOGGLE] Inside refresh condition, newState:', newState);
                    if (newState) {
                        // Toggled ON - fetch image dimensions
                        // dimensionLogger.debug('[TOGGLE] Calling refreshImageDimensions for ON state');
                        logger.info('[Toggle] USE_IMAGE enabled, triggering scale dimension refresh');
                        scaleWidget.refreshImageDimensions(node);
                    } else {
                        // Toggled OFF - clear cache
                        // dimensionLogger.debug('[TOGGLE] Clearing cache for OFF state');
                        scaleWidget.imageDimensionsCache = null;
                        logger.info('[Toggle] USE_IMAGE disabled, cleared scale dimension cache');
                    }
                } else {
                    // dimensionLogger.debug('[TOGGLE] No scale widget or refresh method found');
                    logger.debug('[Toggle] No scale widget or refresh method found');
                }

                node.setDirtyCanvas(true);
                return true;
            }

            // Mode selector - check value behavior mode
            // CONDITIONAL (default): Only when toggle ON and image connected
            // ALWAYS: Always allow (future use case: edit mode even when disabled)
            const allowModeEdit = this.valueBehavior === ValueBehavior.ALWAYS ||
                                  (this.value.on && !this.imageDisconnected);

            if (allowModeEdit && this.isInBounds(pos, this.hitAreas.modeSelector)) {
                this.value.value = this.value.value === 0 ? 1 : 0;
                logger.debug(`Image mode changed to: ${this.modes[this.value.value]}`);

                // NEW: Mutual exclusivity - disable custom_ratio when switching to AR Only mode
                if (this.value.value === 0) {  // Switched to AR Only
                    const customRatioWidget = node.widgets?.find(w => w.name === "custom_ratio");
                    if (customRatioWidget && customRatioWidget.value === true) {
                        customRatioWidget.value = false;
                        logger.info('[ImageMode] Auto-disabled custom_ratio due to mutual exclusivity with AR Only mode');
                    }
                }

                // Invalidate dimension source cache when mode changes (AR Only ↔ Exact Dims)
                node.dimensionSourceManager?.invalidateCache();
                node.updateModeWidget?.(); // Update MODE widget

                node.setDirtyCanvas(true);
                return true;
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
     * Compute size for layout
     */
    computeSize(width) {
        return [width, 24];  // Compact height matching DimensionWidget
    }

    /**
     * Serialize value for workflow JSON
     */
    serializeValue(node, index) {
        logger.debug(`serializeValue called: ${this.name} (index ${index}) =`, this.value);
        return this.value;
    }
}

export { ImageModeWidget };
