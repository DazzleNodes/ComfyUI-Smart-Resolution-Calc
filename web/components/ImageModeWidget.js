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

import { DazzleWidget, WIDGET_MARGIN, WIDGET_INNER_MARGIN, WIDGET_LABEL_FONT, WIDGET_LABEL_COLOR_ON, WIDGET_LABEL_COLOR_OFF } from './DazzleWidget.js';
import { ToggleBehavior, ValueBehavior } from './WidgetValidation.js';
import { logger, dimensionLogger } from '../utils/debug_logger.js';

/**
 * Image Mode Widget
 * Compact widget with toggle (LEFT) and mode selector (RIGHT)
 * Answers the question "USE IMAGE DIMS?" with ON/OFF + AR Only/Exact Dims
 */
class ImageModeWidget extends DazzleWidget {
    constructor(name = "image_mode", config = {}) {
        super(name, { on: false, value: 0 }, config);  // Default: disabled, 0 = AR Only, 1 = Exact Dims

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

        // Hit areas
        this.hitAreas = {
            toggle: { x: 0, y: 0, width: 0, height: 0 },
            modeSelector: { x: 0, y: 0, width: 0, height: 0 }
        };
    }

    /**
     * Draw compact widget matching DimensionWidget style
     * Layout: [Toggle] USE IMAGE DIMS? [AR Only/Exact Dims]
     * Note: Visual appearance unchanged when disabled, only blocks clicks
     */
    draw(ctx, node, width, y, height) {
        // Draw shared frame: background, toggle, set hitAreas.toggle
        // (mouse() handles asymmetric logic — allows turning OFF when disabled, blocks turning ON)
        const { posX: labelX, midY, margin, innerMargin } = this.drawWidgetFrame(ctx, node, width, y, height, this.value.on);
        let posX = labelX;

        // Draw label (MIDDLE) - "USE IMAGE DIMS?"
        const labelText = "USE IMAGE DIMS?";
        ctx.fillStyle = this.value.on ? WIDGET_LABEL_COLOR_ON : WIDGET_LABEL_COLOR_OFF;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = WIDGET_LABEL_FONT;

        // Measure text width to position icon correctly
        const labelTextWidth = ctx.measureText(labelText).width;
        const labelStartX = posX;

        ctx.fillText(labelText, labelStartX, midY);

        // Calculate mode selector position (RIGHT side)
        const modeWidth = 100;  // Fixed width for mode selector
        const modeX = width - WIDGET_MARGIN - modeWidth - WIDGET_INNER_MARGIN;

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

    // drawToggle() — inherited from DazzleWidget (matching DimensionWidget style exactly)

    /**
     * Handle mouse events
     * Asymmetric logic when no image connected:
     * - Allow turning OFF (user wants to disable USE_IMAGE)
     * - Block turning ON (doesn't make sense without image)
     * - Block mode selector entirely
     */
    mouse(event, pos, node) {
        // Check info icon first (before other interactions)
        if (this.handleTooltipMouse(event, pos, node)) return true;

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

    // isInBounds() — inherited from DazzleWidget
    // computeSize() — inherited from DazzleWidget (24px compact height matching DimensionWidget)

    /**
     * Serialize value for workflow JSON
     */
    serializeValue(node, index) {
        logger.debug(`serializeValue called: ${this.name} (index ${index}) =`, this.value);
        return this.value;
    }
}

export { ImageModeWidget };
