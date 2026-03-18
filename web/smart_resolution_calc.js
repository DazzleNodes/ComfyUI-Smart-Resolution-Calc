/**
 * Smart Resolution Calculator - Compact Custom Widgets
 *
 * rgthree-style compact widgets with toggle on LEFT, value on RIGHT
 * Reduced spacing and height for professional, space-efficient layout
 *
 * COMPATIBILITY NOTE:
 * Uses dynamic imports with auto-depth detection to work in both:
 * - Standalone mode: /extensions/smart-resolution-calc/
 * - DazzleNodes mode: /extensions/DazzleNodes/smart-resolution-calc/
 */

// Import modular components
import { DimensionSourceManager } from './managers/dimension_source_manager.js';
import { logger, visibilityLogger, dimensionLogger } from './utils/debug_logger.js';

// Extracted components (Phase 2: TooltipSystem)
import {
    TooltipManager,
    InfoIcon,
    tooltipManager,
    wrapWidgetWithTooltip
} from './components/TooltipSystem.js';

// Extracted components (Phase 3: WidgetValidation)
import {
    WIDGET_SCHEMAS,
    validateWidgetValue,
    logCorruptionDiagnostics,
    ToggleBehavior,
    ValueBehavior
} from './components/WidgetValidation.js';

// Extracted components (Phase 4: DimensionWidget)
import { DimensionWidget } from './components/DimensionWidget.js';

// Extracted components (Phase 5: SeedWidget + seed constants)
import {
    SeedWidget,
    SPECIAL_SEED_RANDOM,
    SPECIAL_SEED_INCREMENT,
    SPECIAL_SEED_DECREMENT,
    SPECIAL_SEEDS,
    SEED_MAX
} from './components/SeedWidget.js';

// Extracted components (Phase 6: ScaleWidget + ImageDimensionUtils)
import { ScaleWidget } from './components/ScaleWidget.js';
import { ImageDimensionUtils } from './utils/ImageDimensionUtils.js';

// Dynamic import helper for standalone vs DazzleNodes compatibility (Option A: Inline)
async function importComfyCore() {
    const currentPath = import.meta.url;
    const urlParts = new URL(currentPath).pathname.split('/').filter(p => p);
    const depth = urlParts.length; // Each part requires one ../ to traverse up
    const prefix = '../'.repeat(depth);

    const [appModule, tooltipModule] = await Promise.all([
        import(`${prefix}scripts/app.js`),
        import('./tooltip_content.js')
    ]);

    return {
        app: appModule.app,
        TOOLTIP_CONTENT: tooltipModule.TOOLTIP_CONTENT
    };
}

// Initialize extension with dynamic imports
(async () => {
    // Import ComfyUI app and local tooltip content
    const { app, TOOLTIP_CONTENT } = await importComfyCore();

/**
 * Debug logging system
 * DebugLogger class and instances now imported from ./utils/debug_logger.js
 * See that file for usage documentation and configuration.
 */

/**
 * Widget Value Validation System (v0.5.0)
 *
 * PURPOSE: Detect and prevent widget value corruption caused by serialization issues.
 *
 * ROOT CAUSE: ComfyUI serializes widget values by array index, but we manually position
 * widgets during hide/show cycles. When widgets shift positions, their values get
 * restored to the wrong widgets.
 *
 * CORRUPTION PATTERNS:
 * - Index confusion: fill_type gets '1' (array index) instead of 'black' (value)
 * - Cross-contamination: output_image_mode gets 'custom_color' (fill_type's value)
 * - Position mismatch: Hidden widgets shift array indices during serialization
 *
 * STRATEGY:
 * 1. Validate values before save (catch corruption at source)
 * 2. Validate values after restore (catch corruption during load)
 * 3. Log corruption with diagnostics (identify code paths)
 * 4. Self-heal with defaults (prevent execution failures)
 */

// ============================================================================
// WIDGET_SCHEMAS, validateWidgetValue, logCorruptionDiagnostics,
// ToggleBehavior, ValueBehavior
// EXTRACTED to ./components/WidgetValidation.js (Phase 3 refactor)
// Imported at module level above. ~210 lines removed.
// ============================================================================

// ============================================================================
// TooltipManager, InfoIcon, tooltipManager singleton, wrapWidgetWithTooltip
// EXTRACTED to ./components/TooltipSystem.js (Phase 2 refactor)
// Imported at module level above. ~450 lines removed.
// ============================================================================
// ============================================================================
// ImageDimensionUtils
// EXTRACTED to ./utils/ImageDimensionUtils.js (Phase 6 refactor)
// Imported at module level above. ~111 lines removed.
// ============================================================================

// ============================================================================
// ScaleWidget
// EXTRACTED to ./components/ScaleWidget.js (Phase 6 refactor)
// Imported at module level above. ~1143 lines removed.
// ============================================================================

/**
 * Mode Status Widget - Read-only display showing current dimension calculation mode
 * Positioned above aspect_ratio to provide at-a-glance mode visibility
 *
 * Performance optimizations:
 * - Caches text truncation to avoid ctx.measureText() loops at 60fps
 * - Uses ctx.roundRect() when available for simpler drawing
 * - Only recalculates displayText when value changes
 */
class ModeStatusWidget {
    constructor(name = "mode_status") {
        this.name = name;
        this.type = "custom";
        this.value = "Calculating...";  // Default text
        this.conflicts = [];  // Calculation conflicts (AR mismatches, etc.)
        this.sourceWarning = null;  // Source validation warning (disconnect, disabled node, etc.) - SEPARATE from conflicts
        this._cachedDisplayText = null;  // Cached truncated text
        this._lastValue = null;           // Last value used for cache
        this._lastMaxWidth = null;        // Last max width used for cache

        // Native ComfyUI tooltip (shows on hover)
        this.tooltip = "Shows current dimension calculation mode (updated automatically, read-only)";

        // NEW: Mouse interaction state for tooltip
        this.isHoveringStatus = false; // Hovering over status text (for conflicts/warnings)
        this.tooltipTimeout = null;
        this.lastY = 0;  // Store widget Y position for hit testing
        this.lastHeight = 0;
        this.lastLabelWidth = 0;

        // Styling
        this.bgColor = "#2a2a2a";
        this.textColor = "#aaaaaa";
        this.borderColor = "#3a3a3a";
    }

    /**
     * Calculate truncated text (cached to avoid expensive measureText loops)
     */
    _getTruncatedText(ctx, text, maxWidth) {
        // Return cached value if nothing changed
        if (text === this._lastValue && maxWidth === this._lastMaxWidth && this._cachedDisplayText) {
            return this._cachedDisplayText;
        }

        // Calculate truncation
        let displayText = text || "Unknown";
        ctx.font = "12px monospace";  // Ensure font is set for measurement
        const textWidth = ctx.measureText(displayText).width;

        if (textWidth > maxWidth) {
            // Binary search for optimal truncation point (faster than while loop)
            let low = 0;
            let high = displayText.length;
            let bestFit = 0;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const testText = displayText.substring(0, mid) + "...";
                const testWidth = ctx.measureText(testText).width;

                if (testWidth <= maxWidth) {
                    bestFit = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            displayText = displayText.substring(0, bestFit) + "...";
        }

        // Cache result
        this._cachedDisplayText = displayText;
        this._lastValue = text;
        this._lastMaxWidth = maxWidth;

        return displayText;
    }

    draw(ctx, node, width, y, height) {
        ctx.save();

        const x = 15;  // Standard widget left margin
        const displayHeight = 24;
        const rectWidth = width - 30;

        // Store Y position and dimensions for hit testing
        this.lastY = y;
        this.lastHeight = displayHeight;

        // Label section dimensions
        const labelText = "Mode(AR):";
        ctx.font = "12px monospace";
        const labelWidth = ctx.measureText(labelText).width + 16;  // Text + padding
        this.lastLabelWidth = labelWidth;  // Store for hit testing

        // Draw label section with darker background (like USE IMAGE DIMS?)
        ctx.fillStyle = "#1a1a1a";  // Darker background for label
        ctx.fillRect(x, y, labelWidth, displayHeight);

        // Draw label text in brighter white
        ctx.fillStyle = "#dddddd";  // Brighter white for label
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, x + 8, y + displayHeight / 2);

        // Determine background color based on conflict severity
        let statusBgColor = this.bgColor;  // Default: #2a2a2a (gray)
        const hasWarningConflict = this.conflicts && this.conflicts.some(c =>
            (c.severity === 'warning') ||
            (typeof c === 'object' && c.message && c.message.includes('overriding'))
        );

        if (hasWarningConflict) {
            statusBgColor = "#3a3000";  // Yellowish background for override conflicts
        }

        // Draw status section with severity-based background
        ctx.fillStyle = statusBgColor;
        ctx.fillRect(x + labelWidth, y, rectWidth - labelWidth, displayHeight);

        // Draw status text in muted gray
        ctx.fillStyle = this.textColor;  // #aaaaaa

        // Reserve space for icons on RIGHT side: 🔌 (source warning) and ⚠️ (conflicts) adjacent
        const hasSourceWarning = this.sourceWarning !== null && this.sourceWarning !== undefined;
        const hasConflicts = this.conflicts && this.conflicts.length > 0;
        const iconSpacing = 2;  // Space between icons
        const sourceWarningWidth = hasSourceWarning ? 20 : 0;
        const conflictsWidth = hasConflicts ? 20 : 0;
        const totalIconWidth = sourceWarningWidth + conflictsWidth + (hasSourceWarning && hasConflicts ? iconSpacing : 0);
        const statusX = x + labelWidth + 8;
        const maxWidth = rectWidth - labelWidth - 16 - totalIconWidth;
        const displayText = this._getTruncatedText(ctx, this.value, maxWidth);

        // Draw mode text
        ctx.fillStyle = this.textColor;
        ctx.font = "12px monospace";
        ctx.fillText(displayText, statusX, y + displayHeight / 2);

        // Draw icons on right side, adjacent to each other
        let currentIconX = x + rectWidth - 4;  // Start from far right

        // Draw conflicts icon (⚠️) first (rightmost)
        if (hasConflicts) {
            currentIconX -= 20;
            ctx.fillStyle = "#ffaa00";  // Amber warning color
            ctx.font = "14px monospace";
            ctx.fillText("⚠️", currentIconX, y + displayHeight / 2);
        }

        // Draw source warning icon (🔌) to the left of conflicts
        if (hasSourceWarning) {
            currentIconX -= (hasConflicts ? iconSpacing : 0) + 20;
            ctx.fillStyle = "#ff6b6b";  // Red color for source issues
            ctx.font = "13px monospace";
            ctx.fillText("🔌", currentIconX, y + displayHeight / 2);
        }

        // Border around entire widget
        ctx.strokeStyle = this.borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, rectWidth, displayHeight);

        // Divider line between label and status
        ctx.strokeStyle = "#3a3a3a";
        ctx.beginPath();
        ctx.moveTo(x + labelWidth, y);
        ctx.lineTo(x + labelWidth, y + displayHeight);
        ctx.stroke();

        // NEW: Draw tooltip if hovering over status section (shows source warnings and/or conflicts)
        if (this.isHoveringStatus && (hasSourceWarning || hasConflicts)) {
            this.drawWarningTooltip(ctx, y, width);
        }

        ctx.restore();
    }

    computeSize(width) {
        return [width, 28];  // Height matches other custom widgets
    }

    // Update the mode display text and conflicts
    updateMode(modeDescription, conflicts = [], sourceWarning = null) {
        if (this.value !== modeDescription || this.conflicts !== conflicts || this.sourceWarning !== sourceWarning) {
            this.value = modeDescription || "Unknown";
            this.conflicts = conflicts || [];  // Calculation conflicts (AR mismatches, etc.)
            this.sourceWarning = sourceWarning;  // Source validation warning (separate)
            // Cache will be invalidated on next draw
        }
    }

    /**
     * Draw tooltip showing source warnings and/or conflicts (separate sections)
     */
    drawWarningTooltip(ctx, widgetY, width) {
        const hasSourceWarning = this.sourceWarning !== null && this.sourceWarning !== undefined;
        const hasConflicts = this.conflicts && this.conflicts.length > 0;
        if (!hasSourceWarning && !hasConflicts) return;

        const margin = 15;
        const padding = 8;
        const lineHeight = 16;

        ctx.save();

        // Build tooltip content with separate sections
        const lines = [];

        // Section 1: Source Warning (if present)
        if (hasSourceWarning) {
            lines.push(`🔌  Image Source: ${this.sourceWarning.message}`);
        }

        // Section 2: Conflicts (if present)
        if (hasConflicts) {
            if (hasSourceWarning) lines.push(''); // Blank line separator
            lines.push(`⚠️  Conflicts detected:`);
        }

        // Calculate max width
        ctx.font = "bold 11px monospace";
        let maxTooltipWidth = Math.max(...lines.map(l => ctx.measureText(l).width));

        // Add each conflict with word wrapping
        if (hasConflicts) {
            this.conflicts.forEach(conflict => {
                const msg = conflict.message || conflict;
                const indent = '    '; // 4 spaces for indentation
            const maxLineWidth = 500; // Maximum width in pixels for wrapped lines

            // Measure and wrap based on actual pixel width
            const words = msg.split(' ');
            let currentLine = indent;

            words.forEach((word, index) => {
                const testLine = index === 0 ? indent + word : currentLine + ' ' + word;
                const testWidth = ctx.measureText(testLine).width;

                if (testWidth > maxLineWidth && currentLine !== indent) {
                    // Line too long, push current line and start new one
                    lines.push(currentLine);
                    maxTooltipWidth = Math.max(maxTooltipWidth, ctx.measureText(currentLine).width);
                    currentLine = indent + word;
                } else {
                    // Add word to current line
                    currentLine = testLine;
                }
            });

            // Push final line
            if (currentLine.trim()) {
                lines.push(currentLine);
                maxTooltipWidth = Math.max(maxTooltipWidth, ctx.measureText(currentLine).width);
            }
        });
        }

        // Calculate tooltip dimensions
        const tooltipWidth = maxTooltipWidth + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;

        // Position tooltip ABOVE the widget (since it's at top of node)
        const tooltipX = margin;
        const tooltipY = widgetY - tooltipHeight - 4;  // 4px gap above widget

        // Draw tooltip background
        ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
        ctx.beginPath();
        ctx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 4);
        ctx.fill();

        // Draw tooltip border
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw tooltip text
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        lines.forEach((line, index) => {
            const textY = tooltipY + padding + (index * lineHeight);
            ctx.fillText(line, tooltipX + padding, textY);
        });

        ctx.restore();
    }

    /**
     * Check if mouse position is within widget bounds
     */
    isInBounds(pos, width) {
        const x = 15;
        const displayHeight = 24;
        const rectWidth = width - 30;

        return pos[0] >= x &&
               pos[0] <= x + rectWidth &&
               pos[1] >= this.lastY &&
               pos[1] <= this.lastY + displayHeight;
    }

    /**
     * Handle mouse events for tooltip display
     */
    mouse(event, pos, node) {
        const width = node.size[0];
        const x = 15;

        if (event.type === "pointermove") {
            // Clear any existing safety timeout
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }

            // Check if hovering over status section (not label)
            const wasHoveringStatus = this.isHoveringStatus;
            this.isHoveringStatus = false;

            if (this.isInBounds(pos, width)) {
                // Only track status section hover (label uses native tooltip)
                if (pos[0] > x + this.lastLabelWidth) {
                    this.isHoveringStatus = true;
                }
            }

            // Redraw if hover state changed
            if (wasHoveringStatus !== this.isHoveringStatus) {
                node.setDirtyCanvas(true);
            }

            // Keep tooltip visible while hovering (no auto-hide timeout)
            // Tooltip will only hide when mouse leaves widget bounds (handled below)
        }

        // Handle mouse leaving widget area - immediately hide tooltip
        if (event.type === "pointerleave" || event.type === "pointerout") {
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
            if (this.isHoveringStatus) {
                this.isHoveringStatus = false;
                node.setDirtyCanvas(true);
            }
        }

        return false;  // Don't capture clicks
    }
}

// ============================================================================
// DimensionWidget
// EXTRACTED to ./components/DimensionWidget.js (Phase 4 refactor)
// Imported at module level above. ~346 lines removed.
// ============================================================================

// ============================================================================
// SeedWidget + seed constants (SPECIAL_SEED_*, SEED_MAX)
// EXTRACTED to ./components/SeedWidget.js (Phase 5 refactor)
// Imported at module level above. ~462 lines removed.
// ============================================================================

// Placeholder comment to maintain grep-ability for SeedWidget references
// class SeedWidget — see ./components/SeedWidget.js
// SPECIAL_SEED_RANDOM, SPECIAL_SEED_INCREMENT, SPECIAL_SEED_DECREMENT, SPECIAL_SEEDS, SEED_MAX

// [Phase 5: SeedWidget body removed — 430+ lines]
// The following marker helps locate where SeedWidget used to be.
// Full class now in ./components/SeedWidget.js


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
        this.infoIcon = new InfoIcon(TOOLTIP_CONTENT.image_mode);
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
                const scaleWidget = node.widgets?.find(w => w instanceof ScaleWidget);
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

/**
 * Color Picker Button Widget
 * Custom widget that displays a color palette in canvas space for reliable positioning
 */
class ColorPickerButton {
    constructor(name = "color_picker_button", fillColorWidget) {
        this.name = name;
        this.type = "custom";  // Must be "custom" for addCustomWidget to route mouse events
        this.value = null;  // Buttons don't need a value
        this.fillColorWidget = fillColorWidget;  // Reference to fill_color widget for value storage

        // State
        this.isHoveringButton = false;
    }

    draw(ctx, node, width, y, height) {
        ctx.save();

        const x = 15;  // Standard widget left margin
        const buttonHeight = 28;
        const buttonWidth = width - 30;

        // Get current color
        const currentColor = this.fillColorWidget.value || "#808080";
        const normalizedColor = currentColor.startsWith('#') ? currentColor : '#' + currentColor;

        // Helper to get contrasting text color
        const getContrastColor = (hexColor) => {
            const hex = hexColor.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? '#000000' : '#FFFFFF';
        };

        const contrastColor = getContrastColor(normalizedColor);

        // === Draw Button ===

        // Button background (current color)
        ctx.fillStyle = normalizedColor;
        ctx.fillRect(x, y, buttonWidth, buttonHeight);

        // Button border
        ctx.strokeStyle = this.isHoveringButton ? "#888" : "#666";
        ctx.lineWidth = this.isHoveringButton ? 2 : 1;
        ctx.strokeRect(x, y, buttonWidth, buttonHeight);

        // Button text
        ctx.fillStyle = contrastColor;
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`🎨 ${normalizedColor.toUpperCase()}`, x + buttonWidth / 2, y + buttonHeight / 2);

        // Store button hit area
        this.hitAreaButton = { x, y, width: buttonWidth, height: buttonHeight };

        ctx.restore();
    }

    mouse(event, pos, node) {
        if (event.type === "pointermove") {
            // Check button hover
            const wasHoveringButton = this.isHoveringButton;
            this.isHoveringButton = this.isInBounds(pos, this.hitAreaButton);
            if (this.isHoveringButton !== wasHoveringButton) {
                node.setDirtyCanvas(true);
            }
            return false;
        }

        if (event.type === "pointerdown") {
            // Check button click (open native color picker)
            if (this.isInBounds(pos, this.hitAreaButton)) {
                visibilityLogger.debug('[ColorPicker] Button clicked, opening native picker');

                const currentColor = this.fillColorWidget.value || "#808080";
                const normalizedColor = currentColor.startsWith('#') ? currentColor : '#' + currentColor;

                // Position picker near mouse click with offset to avoid obscuring node
                const PICKER_OFFSET_X = 100; // Offset to the right of click
                const PICKER_OFFSET_Y = 0;   // No vertical offset
                const PICKER_WIDTH = 50;     // Width of our input element
                const PICKER_HEIGHT = 50;    // Height of our input element
                const MARGIN = 20;           // Minimum margin from viewport edge

                let pickerX = event.clientX + PICKER_OFFSET_X;
                let pickerY = event.clientY + PICKER_OFFSET_Y;

                // Ensure picker stays within viewport bounds
                if (pickerX + PICKER_WIDTH + MARGIN > window.innerWidth) {
                    // Position to left of click instead if too close to right edge
                    pickerX = event.clientX - PICKER_OFFSET_X - PICKER_WIDTH;
                }
                if (pickerY + PICKER_HEIGHT + MARGIN > window.innerHeight) {
                    pickerY = window.innerHeight - PICKER_HEIGHT - MARGIN;
                }
                if (pickerX < MARGIN) {
                    pickerX = MARGIN;
                }
                if (pickerY < MARGIN) {
                    pickerY = MARGIN;
                }

                visibilityLogger.debug(`[ColorPicker] Mouse position: (${event.clientX}, ${event.clientY})`);
                visibilityLogger.debug(`[ColorPicker] Picker position with offset: (${pickerX}, ${pickerY})`);

                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.value = normalizedColor;
                colorInput.style.position = "fixed";
                colorInput.style.left = pickerX + "px";
                colorInput.style.top = pickerY + "px";
                colorInput.style.width = "50px";
                colorInput.style.height = "50px";
                colorInput.style.border = "2px solid #666";
                colorInput.style.borderRadius = "4px";
                colorInput.style.cursor = "pointer";
                colorInput.style.zIndex = "10000";
                document.body.appendChild(colorInput);

                let pickerClosed = false;

                // Handle color selection
                const handleChange = (e) => {
                    if (pickerClosed) return;
                    pickerClosed = true;
                    this.fillColorWidget.value = e.target.value;
                    visibilityLogger.debug(`[ColorPicker] Color selected: ${e.target.value}`);
                    node.setDirtyCanvas(true, true);
                    if (colorInput.parentNode) {
                        document.body.removeChild(colorInput);
                    }
                };

                // Handle cancellation (ESC key or click outside)
                const handleCancel = (e) => {
                    if (pickerClosed) return;
                    // Give the picker time to fully open before allowing cancellation
                    setTimeout(() => {
                        if (pickerClosed) return;
                        if (e.type === 'keydown' && e.key === 'Escape') {
                            pickerClosed = true;
                            visibilityLogger.debug('[ColorPicker] Cancelled via ESC key');
                            if (colorInput.parentNode) {
                                document.body.removeChild(colorInput);
                            }
                        }
                    }, 200);
                };

                // Handle blur with delay to allow picker to open
                const handleBlur = () => {
                    setTimeout(() => {
                        if (pickerClosed) return;
                        if (colorInput.parentNode && document.activeElement !== colorInput) {
                            pickerClosed = true;
                            visibilityLogger.debug('[ColorPicker] Picker closed (blur)');
                            document.body.removeChild(colorInput);
                        }
                    }, 500);  // Longer delay to prevent immediate closure
                };

                colorInput.addEventListener("change", handleChange);
                colorInput.addEventListener("keydown", handleCancel);
                colorInput.addEventListener("blur", handleBlur);

                // Open native picker with delay to ensure DOM is ready
                setTimeout(() => {
                    if (!pickerClosed) {
                        colorInput.click();
                        colorInput.focus();
                    }
                }, 50);

                return true;
            }
        }

        return false;
    }

    isInBounds(pos, bounds) {
        if (!bounds) return false;  // Guard against undefined bounds
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

    computeSize(width) {
        return [width, 28];
    }
}

/**
 * Copy from Image Button Widget
 * Simple button to extract dimensions from connected image and populate widgets
 */
class CopyImageButton {
    constructor(name = "copy_from_image") {
        this.name = name;
        this.type = "custom";  // Must be "custom" for addCustomWidget to route mouse events
        this.value = null;  // Buttons don't need a value

        // Undo state
        this.undoStack = null;  // Stores previous values: {width: {on, value}, height: {on, value}}
        this.showUndo = false;  // Show undo button after copy

        // Hover states
        this.isHoveringCopy = false;
        this.isHoveringUndo = false;
    }

    draw(ctx, node, width, y, height) {
        ctx.save();

        const x = 15;  // Standard widget left margin
        const margin = 3;  // Space between buttons
        const buttonHeight = 28;

        // Check if image is connected
        const imageInput = node.inputs ? node.inputs.find(i => i.name === "image") : null;
        const hasImage = imageInput && imageInput.link != null;

        // Layout: [Copy Button] [Undo Button] if showUndo
        const undoButtonWidth = this.showUndo ? 60 : 0;
        const copyButtonWidth = this.showUndo
            ? width - 30 - undoButtonWidth - margin  // Leave space for undo
            : width - 30;  // Full width

        // === Draw Copy Button ===

        // Copy button style
        if (hasImage) {
            ctx.fillStyle = this.isHoveringCopy ? "#4a7a9a" : "#3a5a7a";
        } else {
            ctx.fillStyle = "#2a2a2a";
        }

        // Copy button background
        ctx.beginPath();
        ctx.roundRect(x, y, copyButtonWidth, buttonHeight, 4);
        ctx.fill();

        // Copy button border
        ctx.strokeStyle = hasImage ? "#5a8aaa" : "#3a3a3a";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Copy button text
        // DEPRECATED (v0.6.1+): The (No Image) state text should now be unreachable because
        // this widget is auto-hidden when image input is disconnected. Preserved as defensive
        // fallback in case visibility system has edge cases or is disabled in future.
        ctx.fillStyle = hasImage ? "#ffffff" : "#666666";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const text = hasImage ? "📋 Copy from Image" : "📋 Copy from Image (No Image)";
        ctx.fillText(text, x + copyButtonWidth / 2, y + buttonHeight / 2);

        // Store copy button hit area
        this.hitAreaCopy = { x, y, width: copyButtonWidth, height: buttonHeight };

        // === Draw Undo Button (if available) ===

        if (this.showUndo) {
            const undoX = x + copyButtonWidth + margin;

            // Undo button style
            ctx.fillStyle = this.isHoveringUndo ? "#9a4a4a" : "#7a3a3a";

            // Undo button background
            ctx.beginPath();
            ctx.roundRect(undoX, y, undoButtonWidth, buttonHeight, 4);
            ctx.fill();

            // Undo button border
            ctx.strokeStyle = "#aa5a5a";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Undo button text
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↶ Undo", undoX + undoButtonWidth / 2, y + buttonHeight / 2);

            // Store undo button hit area
            this.hitAreaUndo = { x: undoX, y, width: undoButtonWidth, height: buttonHeight };
        } else {
            this.hitAreaUndo = null;
        }

        ctx.restore();
    }

    mouse(event, pos, node) {
        if (event.type === "pointermove") {
            // Check hover state for both buttons
            const wasHoveringCopy = this.isHoveringCopy;
            const wasHoveringUndo = this.isHoveringUndo;

            this.isHoveringCopy = this.isInBounds(pos, this.hitAreaCopy);
            this.isHoveringUndo = this.hitAreaUndo && this.isInBounds(pos, this.hitAreaUndo);

            if (this.isHoveringCopy !== wasHoveringCopy || this.isHoveringUndo !== wasHoveringUndo) {
                node.setDirtyCanvas(true);
            }
            return false;
        }

        if (event.type === "pointerdown") {

            // Check Copy button click
            const inCopyBounds = this.isInBounds(pos, this.hitAreaCopy);
            if (inCopyBounds) {
                logger.debug("Copy button clicked");
                // Check if image is connected
                const imageInput = node.inputs ? node.inputs.find(i => i.name === "image") : null;
                if (imageInput && imageInput.link != null) {
                    logger.debug("Image connected - calling copyFromImage");
                    // Get the connected node
                    const link = node.graph.links[imageInput.link];
                    if (link) {
                        const sourceNode = node.graph.getNodeById(link.origin_id);
                        if (sourceNode) {
                            // Try to get image from source node's last execution
                            this.copyFromImage(node, sourceNode);
                        }
                    }
                } else {
                    logger.debug("No image connected - button disabled");
                }
                node.setDirtyCanvas(true);
                return true;
            }

            // Check Undo button click
            const inUndoBounds = this.hitAreaUndo && this.isInBounds(pos, this.hitAreaUndo);
            if (inUndoBounds) {
                logger.debug("Undo button clicked");
                this.undoCopy(node);
                return true;
            }

        }

        if (event.type === "pointerup") {
            if (this.isHoveringCopy || this.isHoveringUndo) {
                this.isHoveringCopy = false;
                this.isHoveringUndo = false;
                node.setDirtyCanvas(true);
            }
        }

        return false;
    }

    /**
     * Hybrid B+C Copy Strategy
     * Tier 1: Server endpoint (immediate for Load Image nodes)
     * Tier 2: Parse info output (post-execution caching)
     * Tier 3: Instructions dialog (user guidance)
     */
    async copyFromImage(node, sourceNode) {
        logger.info("===== COPY FROM IMAGE CLICKED =====");
        logger.debug("Copy from Image clicked! Starting hybrid B+C strategy...");
        logger.debug(`Source node:`, sourceNode);
        logger.debug(`Source node type: ${sourceNode?.type}`);

        // Tier 1: Try server endpoint for Load Image nodes
        try {
            const filePath = this.getImageFilePath(sourceNode);
            if (filePath) {
                logger.debug(`Attempting server endpoint with path: ${filePath}`);
                const dims = await this.fetchDimensionsFromServer(filePath);
                if (dims && dims.success) {
                    logger.debug(`Server success: ${dims.width}×${dims.height}`);
                    this.populateWidgets(node, dims.width, dims.height);
                    this.showSuccessNotification(node, dims.width, dims.height, "File");
                    return;
                }
                logger.debug("Server endpoint failed or returned no data");
            }
        } catch (e) {
            logger.debug(`Server endpoint error: ${e.message}`);
        }

        // Tier 2: Try parsing cached info output
        try {
            const dims = this.parseDimensionsFromInfo(node);
            if (dims) {
                logger.debug(`Info parsing success: ${dims.width}×${dims.height}`);
                this.populateWidgets(node, dims.width, dims.height);
                this.showSuccessNotification(node, dims.width, dims.height, "Cached");
                return;
            }
            logger.debug("No cached info output found");
        } catch (e) {
            logger.debug(`Info parsing error: ${e.message}`);
        }

        // Tier 3: Fallback - show instructions
        logger.debug("All methods failed - showing instructions");
        this.showInstructionsDialog();
    }

    /**
     * Extract file path from LoadImage node (delegates to shared utils)
     */
    getImageFilePath(sourceNode) {
        return ImageDimensionUtils.getImageFilePath(sourceNode);
    }

    /**
     * Fetch dimensions from server endpoint (delegates to shared utils)
     */
    async fetchDimensionsFromServer(imagePath) {
        return await ImageDimensionUtils.fetchDimensionsFromServer(imagePath);
    }

    /**
     * Parse dimensions from cached info output (delegates to shared utils)
     */
    parseDimensionsFromInfo(node) {
        return ImageDimensionUtils.parseDimensionsFromInfo(node);
    }

    /**
     * Populate dimension widgets with extracted values
     * IMPORTANT: Only updates VALUES, preserves user's ON/OFF toggle states
     * User decides which calculation mode to use (MP, W+H, W+AR, etc.)
     */
    populateWidgets(node, width, height) {
        logger.debug(`Populating widgets: ${width}×${height}`);

        // Find the dimension widgets
        const widthWidget = node.widgets?.find(w => w.name === "dimension_width");
        const heightWidget = node.widgets?.find(w => w.name === "dimension_height");

        if (!widthWidget || !heightWidget) {
            logger.error("Could not find dimension widgets!");
            return;
        }

        // Save current values to undo stack BEFORE changing
        this.undoStack = {
            width: { ...widthWidget.value },
            height: { ...heightWidget.value }
        };
        this.showUndo = true;
        logger.debug('Saved undo state:', this.undoStack);

        // ONLY update values - preserve user's toggle states
        // User may want dimensions copied but still use MP+AR calculation
        widthWidget.value = { on: widthWidget.value.on, value: width };
        heightWidget.value = { on: heightWidget.value.on, value: height };

        logger.debug(`Updated WIDTH=${width} (toggle: ${widthWidget.value.on ? 'ON' : 'OFF'})`);
        logger.debug(`Updated HEIGHT=${height} (toggle: ${heightWidget.value.on ? 'ON' : 'OFF'})`);

        // Mark node as modified and refresh canvas
        node.setDirtyCanvas(true, true);
        logger.debug("Widgets populated successfully (preserved user's toggle states)");
    }

    /**
     * Undo the last copy operation
     * Restores previous WIDTH/HEIGHT values (including toggle states)
     */
    undoCopy(node) {
        if (!this.undoStack) {
            logger.debug('No undo state available');
            return;
        }

        logger.debug('Restoring undo state:', this.undoStack);

        // Find the dimension widgets
        const widthWidget = node.widgets?.find(w => w.name === "dimension_width");
        const heightWidget = node.widgets?.find(w => w.name === "dimension_height");

        if (!widthWidget || !heightWidget) {
            logger.error("Could not find dimension widgets for undo!");
            return;
        }

        // Restore previous values (including toggle states)
        widthWidget.value = { ...this.undoStack.width };
        heightWidget.value = { ...this.undoStack.height };

        logger.info(`↶ Undone: Restored WIDTH=${this.undoStack.width.value} (${this.undoStack.width.on ? 'ON' : 'OFF'}), HEIGHT=${this.undoStack.height.value} (${this.undoStack.height.on ? 'ON' : 'OFF'})`);

        // Clear undo state and hide button
        this.undoStack = null;
        this.showUndo = false;

        // Mark node as modified and refresh canvas
        node.setDirtyCanvas(true, true);
    }

    /**
     * Show success notification
     */
    showSuccessNotification(node, width, height, source) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(width, height);
        const aspectRatio = `${width/divisor}:${height/divisor}`;

        logger.info(`✓ Copied from ${source}: ${width}×${height} (${aspectRatio})`);

        // Optional: Could show a brief toast notification here
        // For now, the log message is sufficient
    }

    /**
     * Show instructions dialog (Tier 3 fallback)
     */
    showInstructionsDialog() {
        const canvas = app.canvas;
        canvas.prompt(
            "Copy Image Dimensions",
            "To copy dimensions:\n\n1. Run the workflow once (Queue Prompt)\n2. After execution, click this button again\n3. Cached dimensions will be extracted\n\nOr manually enter width and height from your source image.\n\n(Server endpoint requires Load Image node with file path)",
            null,
            event
        );
        logger.debug("Showing instructions dialog (all auto-methods failed)");
    }

    isInBounds(pos, bounds) {
        if (!bounds) return false;
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

    computeSize(width) {
        return [width, 32];  // Button height
    }

    serializeValue(node, index) {
        // Buttons don't serialize - they're action triggers
        return undefined;
    }
}

/**
 * Register the Smart Resolution Calculator extension
 */
app.registerExtension({
    name: "SmartResolutionCalc.CompactWidgets",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "SmartResolutionCalc") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = function() {
                const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

                logger.debug('onNodeCreated called for node:', this.id);

                // Enable widget serialization (required for custom widgets to pass data to Python)
                this.serialize_widgets = true;
                logger.debug('serialize_widgets set to:', this.serialize_widgets);

                // Add image mode widget (USE IMAGE? toggle + AR Only/Exact Dims selector)
                // Asymmetric toggle: Can't enable without image, can disable anytime
                // Conditional values: Mode only editable when toggle ON and image connected
                const imageModeWidget = new ImageModeWidget("image_mode", {
                    toggleBehavior: ToggleBehavior.ASYMMETRIC,
                    valueBehavior: ValueBehavior.CONDITIONAL
                });

                // Add copy from image button
                const copyButton = new CopyImageButton("copy_from_image");

                // Add compact dimension widgets
                // Symmetric toggle: Can enable/disable freely
                // Always values: Can edit values even when toggle OFF
                const mpWidget = new DimensionWidget("dimension_megapixel", 1.0, false, {
                    toggleBehavior: ToggleBehavior.SYMMETRIC,
                    valueBehavior: ValueBehavior.ALWAYS,
                    tooltipContent: TOOLTIP_CONTENT.megapixel  // Add tooltip for MEGAPIXEL
                });
                const widthWidget = new DimensionWidget("dimension_width", 1024, true, {
                    toggleBehavior: ToggleBehavior.SYMMETRIC,
                    valueBehavior: ValueBehavior.ALWAYS
                });
                const heightWidget = new DimensionWidget("dimension_height", 1024, true, {
                    toggleBehavior: ToggleBehavior.SYMMETRIC,
                    valueBehavior: ValueBehavior.ALWAYS
                });

                // Add custom seed widget (for fill noise reproducibility)
                const seedWidget = new SeedWidget("fill_seed", -1, {
                    tooltipContent: TOOLTIP_CONTENT.fill_seed
                });
                this.seedWidgetInstance = seedWidget;

                // Add custom scale widget
                const scaleWidget = new ScaleWidget("scale", 1.0, { tooltipContent: TOOLTIP_CONTENT.scale });
                this.scaleWidgetInstance = scaleWidget; // Store reference for updateModeWidget

                // MODE widget: Optimizations insufficient - custom widgets in draw cycle cause corruption
                // Even with caching and binary search, draw() participation at 60fps is too expensive
                // Alternative approaches needed: DOM overlay, stock widget, or non-draw mechanism
                // const modeStatusWidget = new ModeStatusWidget("mode_status");

                // Add widgets to node (image mode first, then copy button, then dimension controls, then scale)
                this.addCustomWidget(imageModeWidget);
                this.addCustomWidget(copyButton);
                this.addCustomWidget(mpWidget);
                this.addCustomWidget(widthWidget);
                this.addCustomWidget(heightWidget);
                this.addCustomWidget(scaleWidget);
                this.addCustomWidget(seedWidget);
                // this.addCustomWidget(modeStatusWidget);

                // Reposition seed widget: move it right after blend_strength
                // (visual order: fill_type → blend_strength → SEED → output_image_mode)
                // addCustomWidget() puts it at the end, so splice it to the correct position
                const seedAddedIndex = this.widgets.indexOf(seedWidget);
                if (seedAddedIndex !== -1) {
                    this.widgets.splice(seedAddedIndex, 1);
                }
                const blendStrengthRef = this.widgets.find(w => w.name === "blend_strength");
                if (blendStrengthRef) {
                    const blendIdx = this.widgets.indexOf(blendStrengthRef);
                    this.widgets.splice(blendIdx + 1, 0, seedWidget);
                    logger.debug(`Repositioned seed widget after blend_strength at index ${blendIdx + 1}`);
                } else {
                    // Fallback: after fill_type if blend_strength doesn't exist
                    const fillTypeWidgetRef = this.widgets.find(w => w.name === "fill_type");
                    if (fillTypeWidgetRef) {
                        const fillTypeIdx = this.widgets.indexOf(fillTypeWidgetRef);
                        this.widgets.splice(fillTypeIdx + 1, 0, seedWidget);
                        logger.debug(`Repositioned seed widget after fill_type at index ${fillTypeIdx + 1}`);
                    }
                }

                logger.debug('Added 7 custom widgets to node (image mode + copy button + dimensions + scale + seed)');
                logger.debug('Widget names:', imageModeWidget.name, copyButton.name, mpWidget.name, widthWidget.name, heightWidget.name, scaleWidget.name, seedWidget.name);

                // Add image source validation method to node (Scenario 2: Invalid Source Detection)
                // Called by DimensionSourceManager to detect disabled sources through chain traversal
                this._validateImageSource = function(imageInput, maxDepth = 10) {
                    // DIAGNOSTIC: Log validation start (Phase 1 - Reconnect issue diagnosis)
                    logger.debug('[VALIDATION] Starting validation');
                    logger.debug('[VALIDATION] imageInput:', imageInput);
                    logger.debug('[VALIDATION] imageInput.link:', imageInput?.link);

                    if (!imageInput || !imageInput.link) {
                        logger.debug('[VALIDATION] Result: no_connection');
                        return { valid: false, reason: 'no_connection', severity: 'info' };
                    }

                    let currentInput = imageInput;
                    let depth = 0;
                    const visitedNodes = new Set();
                    const chain = [];  // For debugging/logging

                    while (depth < maxDepth) {
                        const link = this.graph.links[currentInput.link];

                        // DIAGNOSTIC: Log link lookup (Phase 1)
                        logger.debug(`[VALIDATION] Depth ${depth}: Looking up link ${currentInput.link}`);
                        logger.debug(`[VALIDATION] Depth ${depth}: Link object exists:`, !!link);

                        if (!link) {
                            logger.debug(`[VALIDATION] Result: broken_link at depth ${depth}, chain:`, chain);
                            return {
                                valid: false,
                                reason: 'broken_link',
                                severity: 'error',
                                depth,
                                chain
                            };
                        }

                        const sourceNode = this.graph.getNodeById(link.origin_id);
                        if (!sourceNode) {
                            return {
                                valid: false,
                                reason: 'missing_node',
                                severity: 'error',
                                depth,
                                chain
                            };
                        }

                        chain.push(sourceNode.title || sourceNode.type);

                        // Check for circular references
                        if (visitedNodes.has(sourceNode.id)) {
                            return {
                                valid: false,
                                reason: 'circular_reference',
                                severity: 'error',
                                depth,
                                chain
                            };
                        }
                        visitedNodes.add(sourceNode.id);

                        // Check if source is disabled/bypassed
                        // LiteGraph.NEVER = 2, BYPASS = 4
                        if (sourceNode.mode === 2 || sourceNode.mode === 4) {
                            return {
                                valid: false,
                                reason: 'disabled_source',
                                severity: 'warning',
                                depth,
                                nodeName: sourceNode.title || sourceNode.type,
                                chain
                            };
                        }

                        // Check if this is a reroute node - follow its input
                        // Multiple detection methods for different ComfyUI versions
                        const isReroute = sourceNode.type === 'Reroute' ||
                                        sourceNode.constructor.name === 'Reroute' ||
                                        (sourceNode.comfyClass && sourceNode.comfyClass === 'Reroute');

                        if (isReroute) {
                            const rerouteInput = sourceNode.inputs?.[0];
                            if (rerouteInput && rerouteInput.link) {
                                currentInput = rerouteInput;
                                depth++;
                                continue;
                            } else {
                                // Reroute with no input = broken
                                return {
                                    valid: false,
                                    reason: 'reroute_no_input',
                                    severity: 'error',
                                    depth,
                                    chain
                                };
                            }
                        }

                        // Reached actual source node (not a reroute)
                        logger.debug(`[VALIDATION] Result: valid, source="${sourceNode.title || sourceNode.type}", depth=${depth}, chain:`, chain);
                        return {
                            valid: true,
                            depth,
                            nodeName: sourceNode.title || sourceNode.type,
                            chain
                        };
                    }

                    // Max depth exceeded
                    logger.debug(`[VALIDATION] Result: max_depth_exceeded at depth ${depth}`);
                    return {
                        valid: false,
                        reason: 'max_depth_exceeded',
                        severity: 'warning',
                        depth,
                        chain
                    };
                };

                // Initialize DimensionSourceManager for centralized dimension calculation
                this.dimensionSourceManager = new DimensionSourceManager(this);
                logger.debug('Initialized DimensionSourceManager');

                // Hide the native mode_status widget (we'll create a custom widget instead)
                const nativeModeStatusWidget = this.widgets.find(w => w.name === "mode_status");
                if (nativeModeStatusWidget) {
                    nativeModeStatusWidget.type = "converted-widget";
                    nativeModeStatusWidget.computeSize = () => [0, -4];  // Hide it from layout
                    logger.debug('Hidden native mode_status widget');
                }

                // Create custom MODE status widget using existing ModeStatusWidget class
                const modeStatusWidget = new ModeStatusWidget("mode_status");

                // Insert custom widget above aspect_ratio
                const aspectRatioIndex = this.widgets.findIndex(w => w.name === "aspect_ratio");
                if (aspectRatioIndex !== -1) {
                    this.widgets.splice(aspectRatioIndex, 0, modeStatusWidget);
                    logger.debug('Created custom MODE status widget above aspect_ratio');
                } else {
                    this.widgets.push(modeStatusWidget);
                    logger.debug('Created custom MODE status widget at end');
                }

                // Hide the default "scale" widget created by ComfyUI (we use custom widget instead)
                const defaultScaleWidget = this.widgets.find(w => w.name === "scale" && w.type !== "custom");
                if (defaultScaleWidget) {
                    defaultScaleWidget.type = "converted-widget";
                    defaultScaleWidget.computeSize = () => [0, -4];  // Hide it from layout
                    defaultScaleWidget.draw = () => {};  // Prevent it from rendering entirely
                    logger.debug('Hidden default scale widget (blocked draw method)');
                }

                // Set minimum width to prevent seed widget buttons from overflowing
                const MIN_NODE_WIDTH = 320;
                this.size[0] = Math.max(this.size[0], MIN_NODE_WIDTH);

                // Enforce minimum width on resize
                const originalOnResize = this.onResize;
                this.onResize = function(size) {
                    size[0] = Math.max(size[0], MIN_NODE_WIDTH);
                    if (originalOnResize) originalOnResize.call(this, size);
                };

                // Set initial size (widgets will auto-adjust)
                this.setSize(this.computeSize());

                // Helper function to update MODE widget with current dimension source
                // @param {boolean} forceRefresh - If true, bypass cache and force recalculation
                const updateModeWidget = async (forceRefresh = false) => {
                    // DIAGNOSTIC: Log updateModeWidget call (Phase 1)
                    logger.debug('[UPDATE-MODE] updateModeWidget called, forceRefresh:', forceRefresh);

                    const modeWidget = this.widgets.find(w => w.name === "mode_status");
                    if (modeWidget && this.dimensionSourceManager) {
                        // Get imageDimensionsCache from stored ScaleWidget reference
                        const imageDimensionsCache = this.scaleWidgetInstance?.imageDimensionsCache;

                        logger.debug('[UPDATE-MODE] Calling getActiveDimensionSource with forceRefresh:', forceRefresh);

                        // Pass runtime context to manager (includes imageDimensionsCache for AR Only mode)
                        // Calls Python API for single source of truth
                        // forceRefresh=true bypasses cache (used when image connection changes)
                        const dimSource = await this.dimensionSourceManager.getActiveDimensionSource(forceRefresh, {
                            imageDimensionsCache: imageDimensionsCache
                        });

                        logger.debug('[UPDATE-MODE] Received dimSource:', dimSource?.mode, dimSource?.description);

                        if (dimSource) {
                            const scaleWidget = this.widgets.find(w => w.name === "scale" && w.type === "custom");
                            if (scaleWidget && scaleWidget.getSimplifiedModeLabel) {
                                const modeLabel = scaleWidget.getSimplifiedModeLabel(dimSource);
                                if (modeLabel) {
                                    // Update mode widget with conflicts AND source warnings (separate systems)
                                    if (modeWidget.updateMode) {
                                        // Custom widget with updateMode method
                                        modeWidget.updateMode(
                                            modeLabel,
                                            dimSource.conflicts || [],  // Calculation conflicts (AR mismatches, etc.)
                                            dimSource.sourceWarning || null  // Source validation warning (separate)
                                        );
                                    } else {
                                        // Fallback for native ComfyUI widget
                                        modeWidget.value = modeLabel;
                                    }
                                    this.setDirtyCanvas(true, false);  // Trigger redraw without full graph recompute
                                }
                            }
                        }
                    }
                };

                // Update MODE widget with initial state
                setTimeout(() => updateModeWidget(), 100); // Delay to ensure everything is initialized

                // Store updateModeWidget on node for access from custom widgets
                this.updateModeWidget = updateModeWidget;

                // Wrap native ComfyUI widgets with tooltip support
                // These are created by Python node definition, not custom widgets
                const divisibleWidget = this.widgets.find(w => w.name === "divisible_by");
                if (divisibleWidget) {
                    wrapWidgetWithTooltip(divisibleWidget, TOOLTIP_CONTENT.divisible_by, this);
                    logger.debug('Added tooltip to divisible_by widget, type:', divisibleWidget.type);
                } else {
                    logger.debug('divisible_by widget not found');
                }

                const customAspectRatioWidget = this.widgets.find(w => w.name === "custom_aspect_ratio");
                if (customAspectRatioWidget) {
                    wrapWidgetWithTooltip(customAspectRatioWidget, TOOLTIP_CONTENT.custom_aspect_ratio, this);
                    logger.debug('Added tooltip to custom_aspect_ratio widget, type:', customAspectRatioWidget.type);
                } else {
                    logger.debug('custom_aspect_ratio widget not found');
                }

                const aspectRatioWidget = this.widgets.find(w => w.name === "aspect_ratio");
                if (aspectRatioWidget) {
                    wrapWidgetWithTooltip(aspectRatioWidget, TOOLTIP_CONTENT.aspect_ratio, this);
                    logger.debug('Added tooltip to aspect_ratio widget, type:', aspectRatioWidget.type);
                } else {
                    logger.debug('aspect_ratio widget not found');
                }

                // Hook native widget callbacks to invalidate dimension source cache
                const customRatioWidget = this.widgets.find(w => w.name === "custom_ratio");
                if (customRatioWidget) {
                    const originalCallback = customRatioWidget.callback;
                    customRatioWidget.callback = async (value) => {
                        if (originalCallback) {
                            originalCallback.call(customRatioWidget, value);
                        }

                        // NEW: Mutual exclusivity - disable USE IMAGE DIMS if enabling custom_ratio (any mode)
                        // Both Exact Dims and AR Only use image data, so both are mutually exclusive with custom_ratio
                        if (value === true) {
                            const imageModeWidget = this.widgets.find(w => w.name === "image_mode");
                            if (imageModeWidget && imageModeWidget.value?.on) {
                                // USE IMAGE DIMS is ON (either Exact Dims or AR Only)
                                const modeName = imageModeWidget.value?.value === 0 ? 'AR Only' : 'Exact Dims';
                                imageModeWidget.value.on = false;
                                logger.info(`[custom_ratio] Auto-disabled USE IMAGE DIMS (${modeName}) due to mutual exclusivity`);
                            }
                        }

                        // Invalidate cache when custom_ratio toggle changes
                        this.dimensionSourceManager?.invalidateCache();
                        await updateModeWidget(); // Wait for MODE widget update
                        logger.debug('custom_ratio changed, MODE widget updated');
                    };
                }

                if (customAspectRatioWidget) {
                    const originalCallback = customAspectRatioWidget.callback;
                    customAspectRatioWidget.callback = async (value) => {
                        if (originalCallback) {
                            originalCallback.call(customAspectRatioWidget, value);
                        }
                        // Invalidate cache when custom_aspect_ratio text changes
                        this.dimensionSourceManager?.invalidateCache();
                        await updateModeWidget(); // Wait for MODE widget update
                        logger.debug('custom_aspect_ratio changed, MODE widget updated');
                    };
                }

                if (aspectRatioWidget) {
                    const originalCallback = aspectRatioWidget.callback;
                    aspectRatioWidget.callback = async (value) => {
                        if (originalCallback) {
                            originalCallback.call(aspectRatioWidget, value);
                        }
                        // Invalidate cache when aspect_ratio dropdown changes
                        this.dimensionSourceManager?.invalidateCache();
                        await updateModeWidget(); // Wait for MODE widget update
                        logger.debug('aspect_ratio changed, MODE widget updated');
                    };
                }

                // Set up hit areas for native widgets after they're drawn
                // We need to intercept drawWidgets to get accurate Y positions
                const originalDrawWidgets = nodeType.prototype.drawWidgets;
                nodeType.prototype.drawWidgets = function(ctx, area) {
                    // Call original drawWidgets
                    if (originalDrawWidgets) {
                        originalDrawWidgets.call(this, ctx, area);
                    }

                    // After widgets are drawn, set hit areas for native widgets with tooltips
                    ctx.save();
                    ctx.font = "13px sans-serif";

                    for (const widget of this.widgets) {
                        if (widget.infoIcon && widget.type !== "custom" && widget.last_y !== undefined) {
                            // Native widget with tooltip - last_y is set by LiteGraph during rendering
                            const widgetHeight = LiteGraph.NODE_WIDGET_HEIGHT;
                            const labelText = widget.label || widget.name;
                            const labelWidth = ctx.measureText(labelText).width;

                            // Set hit area using LiteGraph's last_y position
                            widget.infoIcon.setHitArea(15, widget.last_y, labelWidth, widgetHeight);
                        }
                    }

                    ctx.restore();
                };

                // ===== NEW: Conditional visibility for image output parameters =====
                // Hide image output parameters until "image" output (position 5) is connected

                // Store references to image output widgets (hidden/shown based on image input)
                // NOTE: fill_type is NOT tracked here - it stays always visible because it
                // controls latent fill even without an input image (noise, DazNoise, random, etc.)
                // NOTE: fill_color is NOT tracked here - it stays visible (but rendered as size 0)
                // to act as a value storage and stable anchor for the color picker button
                this.imageOutputWidgets = {
                    output_image_mode: this.widgets.find(w => w.name === "output_image_mode"),
                    image_mode: this.widgets.find(w => w.name === "image_mode"),
                    copy_from_image: this.widgets.find(w => w.name === "copy_from_image")
                };

                // Debug: Log initial widget references to verify correct widgets found
                if (visibilityLogger.debugEnabled) {
                    const fillTypeRef = this.widgets.find(w => w.name === "fill_type");
                    visibilityLogger.debug('[WidgetInit] Initial widget references:', {
                        output_image_mode: {
                            name: this.imageOutputWidgets.output_image_mode?.name,
                            type: this.imageOutputWidgets.output_image_mode?.type,
                            value: this.imageOutputWidgets.output_image_mode?.value,
                            index: this.widgets.indexOf(this.imageOutputWidgets.output_image_mode)
                        },
                        fill_type: {
                            name: fillTypeRef?.name,
                            type: fillTypeRef?.type,
                            value: fillTypeRef?.value,
                            index: this.widgets.indexOf(fillTypeRef),
                            alwaysVisible: true
                        }
                    });
                }

                // Store original widget types, indices, and default values for restore
                this.imageOutputWidgetIndices = {};
                this.imageOutputWidgetValues = {
                    output_image_mode: "auto"
                };

                // ===== Color picker button widget =====
                // Create a dedicated button widget for color picking, separate from text widget
                // Find fill_color widget (not tracked in imageOutputWidgets, stays visible as anchor)
                const fillColorWidget = this.widgets.find(w => w.name === "fill_color");
                if (fillColorWidget) {
                    // Hide the fill_color text widget since button shows the color
                    // Keep widget for value storage but don't render it (acts as stable anchor)
                    fillColorWidget.computeSize = function() { return [0, 0]; };
                    fillColorWidget.draw = function() { /* Hidden */ };

                    // Initialize value if needed
                    if (!fillColorWidget.value || fillColorWidget.value === undefined) {
                        fillColorWidget.value = "#808080";
                    }

                    // Create custom color picker button widget (canvas-space rendering for reliable positioning)
                    const colorPickerButton = new ColorPickerButton("color_picker_button", fillColorWidget);
                    this.addCustomWidget(colorPickerButton);

                    // addCustomWidget() automatically adds to end of array, so remove it first
                    const addedIndex = this.widgets.indexOf(colorPickerButton);
                    if (addedIndex !== -1) {
                        this.widgets.splice(addedIndex, 1);
                    }

                    // Insert button right after fill_color widget
                    const fillColorIndex = this.widgets.indexOf(fillColorWidget);
                    this.widgets.splice(fillColorIndex + 1, 0, colorPickerButton);

                    // Add button to image output widgets list
                    this.imageOutputWidgets.color_picker_button = colorPickerButton;

                    // Store original widget index for button
                    this.imageOutputWidgetIndices.color_picker_button = fillColorIndex + 1;

                    // Force canvas update to ensure widget becomes interactive immediately
                    this.setDirtyCanvas(true, true);

                    // Also trigger a size recalculation to ensure proper layout
                    this.setSize(this.computeSize());
                }

                // Save origType for each widget before any hide/show cycles
                // CRITICAL: Must run AFTER all widgets are added to imageOutputWidgets
                // This ensures custom widgets like color_picker_button get their type preserved
                Object.keys(this.imageOutputWidgets).forEach(key => {
                    const widget = this.imageOutputWidgets[key];
                    if (widget) {
                        widget.origType = widget.type;
                        visibilityLogger.debug(`[OrigType] Saved ${key}: origType = "${widget.type}"`);
                        // Store original index in widgets array
                        this.imageOutputWidgetIndices[key] = this.widgets.indexOf(widget);

                        // Skip value initialization for custom widgets - they manage their own state
                        // Custom widgets have complex value structures and internal state that should not be modified
                        if (widget.type === "custom") {
                            visibilityLogger.debug(`[ValueInit] Skipping value init for custom widget ${key} (type="${widget.type}")`);
                        } else {
                            // Initialize widget value if not already set (standard widgets only)
                            if (widget.value === undefined || typeof widget.value === 'object') {
                                widget.value = this.imageOutputWidgetValues[key];
                            } else {
                                // Use actual widget value if already initialized
                                this.imageOutputWidgetValues[key] = widget.value;
                            }
                        }
                    }
                });

                // Function to update widget visibility based on image input connection (v0.6.1)
                this.updateImageOutputVisibility = function() {
                    visibilityLogger.debug('=== updateImageOutputVisibility called ===');

                    // Check if image INPUT has connections (v0.6.1 fix for img2img workflow visibility)
                    // Changed from checking image OUTPUT to checking image INPUT because:
                    // - With VAE encoding, INPUT image + VAE -> latent output uses these settings
                    // - Users need control over output_image_mode/fill_type for img2img/outpainting
                    const imageInput = this.inputs ? this.inputs.find(inp => inp.name === "image") : null;
                    visibilityLogger.debug('Image input:', imageInput);
                    visibilityLogger.debug('Image input link:', imageInput?.link);

                    // Check if input has a connection (single link, not array like outputs)
                    const hasConnection = imageInput && imageInput.link != null;

                    visibilityLogger.debug(`Image input connected: ${hasConnection}`);
                    visibilityLogger.debug('imageOutputWidgets keys:', Object.keys(this.imageOutputWidgets));

                    // DIAGNOSTIC: Check link existence in graph (Phase 1 - Reconnect issue diagnosis)
                    if (imageInput && imageInput.link != null) {
                        const linkObject = this.graph.links[imageInput.link];
                        visibilityLogger.debug('[RECONNECT-DEBUG] Link ID:', imageInput.link);
                        visibilityLogger.debug('[RECONNECT-DEBUG] Link exists in graph.links:', !!linkObject);
                        if (linkObject) {
                            visibilityLogger.debug('[RECONNECT-DEBUG] Link origin_id:', linkObject.origin_id);
                            visibilityLogger.debug('[RECONNECT-DEBUG] Link target_id:', linkObject.target_id);
                            const sourceNode = this.graph.getNodeById(linkObject.origin_id);
                            visibilityLogger.debug('[RECONNECT-DEBUG] Source node exists:', !!sourceNode);
                            visibilityLogger.debug('[RECONNECT-DEBUG] Source node type:', sourceNode?.type);
                        }
                    }

                    // Update ImageModeWidget's imageDisconnected property (v0.6.1)
                    // This property controls the asymmetric toggle behavior
                    const imageModeWidget = this.imageOutputWidgets.image_mode;
                    if (imageModeWidget) {
                        imageModeWidget.imageDisconnected = !hasConnection;
                        visibilityLogger.debug(`Updated image_mode.imageDisconnected = ${imageModeWidget.imageDisconnected}`);
                    }

                    // Show/hide widgets based on connection status
                    if (hasConnection) {
                        // SOLUTION 5: Hybrid Anchor + Sequential Insertion
                        // Use batch_size as stable anchor, insert sequentially to account for index shifts

                        // Anchor: fill_type is always visible (never hidden).
                        // Insert output_image_mode after fill_type when image is connected.
                        const fillTypeWidget = this.widgets.find(w => w.name === "fill_type");
                        const fillColorWidget = this.widgets.find(w => w.name === "fill_color");
                        const fillTypeIndex = fillTypeWidget ? this.widgets.indexOf(fillTypeWidget) : -1;

                        if (fillTypeIndex === -1) {
                            visibilityLogger.error("Cannot find fill_type widget anchor");
                            return;
                        }

                        if (visibilityLogger.debugEnabled) {
                            visibilityLogger.debug(`fill_type found at index ${fillTypeIndex}`);
                            visibilityLogger.debug('[WidgetRestore] Widget references:', {
                                output_image_mode: this.imageOutputWidgets.output_image_mode?.name,
                                color_picker_button: this.imageOutputWidgets.color_picker_button?.name || 'button'
                            });
                            visibilityLogger.debug('[WidgetRestore] Saved values:', this.imageOutputWidgetValues);
                        }

                        // Start inserting after fill_type (which is always visible)
                        let currentIndex = fillTypeIndex + 1;

                        // 1. Insert output_image_mode after fill_type
                        const outputWidget = this.imageOutputWidgets.output_image_mode;
                        if (visibilityLogger.debugEnabled) {
                            visibilityLogger.debug(`[WidgetRestore] output_image_mode widget:`, {
                                name: outputWidget?.name,
                                type: outputWidget?.type,
                                value: outputWidget?.value,
                                options: outputWidget?.options?.values
                            });
                        }
                        if (outputWidget && this.widgets.indexOf(outputWidget) === -1) {
                            // Restore saved value with validation (v0.5.0 corruption protection)
                            const savedValue = this.imageOutputWidgetValues.output_image_mode;
                            if (savedValue !== undefined) {
                                const validation = validateWidgetValue('output_image_mode', savedValue, 'restore');
                                if (!validation.valid) {
                                    logCorruptionDiagnostics(validation.warnings, {
                                        widget: 'output_image_mode',
                                        savedValue: savedValue,
                                        widgetIndex: this.widgets.indexOf(outputWidget),
                                        operation: 'restore (showing widgets)'
                                    });
                                }
                                outputWidget.value = validation.correctedValue;
                            }

                            this.widgets.splice(currentIndex, 0, outputWidget);
                            outputWidget.type = outputWidget.origType || "combo";
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`Inserted output_image_mode at index ${currentIndex}, value: ${outputWidget.value}`);
                            }
                            currentIndex++; // Move insertion point forward
                        } else if (outputWidget) {
                            // Already visible, update currentIndex to point after it
                            const existingIndex = this.widgets.indexOf(outputWidget);
                            if (existingIndex >= currentIndex) {
                                currentIndex = existingIndex + 1;
                            }
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`output_image_mode already visible at ${existingIndex}`);
                            }
                        }

                        // 2. fill_color should already be in array (invisible)
                        //    Find it and position button after it
                        const fillColorIndex = fillColorWidget ? this.widgets.indexOf(fillColorWidget) : -1;
                        if (fillColorIndex !== -1) {
                            currentIndex = fillColorIndex + 1;
                            visibilityLogger.debug(`fill_color found at index ${fillColorIndex}, button will go at ${currentIndex}`);

                            // 3. Insert color picker button
                            const buttonWidget = this.imageOutputWidgets.color_picker_button;
                            if (buttonWidget && this.widgets.indexOf(buttonWidget) === -1) {
                                // Button widget doesn't have a primitive value to restore
                                this.widgets.splice(currentIndex, 0, buttonWidget);
                                const restoredType = buttonWidget.origType || "button";
                                buttonWidget.type = restoredType;
                                visibilityLogger.debug(`Inserted color_picker_button at index ${currentIndex}, type: "${restoredType}" (origType: "${buttonWidget.origType}")`);
                                currentIndex++; // Move insertion point forward
                            } else if (buttonWidget) {
                                const existingIndex = this.widgets.indexOf(buttonWidget);
                                if (existingIndex >= currentIndex) {
                                    currentIndex = existingIndex + 1;
                                }
                                visibilityLogger.debug(`color_picker_button already visible at ${existingIndex}`);
                            }

                            // 4. Insert image_mode (USE IMAGE DIMS?) toggle
                            const imageModeWidget = this.imageOutputWidgets.image_mode;
                            if (imageModeWidget && this.widgets.indexOf(imageModeWidget) === -1) {
                                // Custom widget - don't modify type property or value (must stay "custom" for custom draw/mouse)
                                // ImageModeWidget manages its own state internally
                                this.widgets.splice(currentIndex, 0, imageModeWidget);
                                visibilityLogger.debug(`Inserted image_mode at index ${currentIndex}, type: "${imageModeWidget.type}"`);
                                currentIndex++; // Move insertion point forward
                            } else if (imageModeWidget) {
                                const existingIndex = this.widgets.indexOf(imageModeWidget);
                                if (existingIndex >= currentIndex) {
                                    currentIndex = existingIndex + 1;
                                }
                                visibilityLogger.debug(`image_mode already visible at ${existingIndex}`);
                            }

                            // 5. Insert copy_from_image button
                            const copyButtonWidget = this.imageOutputWidgets.copy_from_image;
                            if (copyButtonWidget && this.widgets.indexOf(copyButtonWidget) === -1) {
                                // Custom widget - don't modify type property (must stay "custom" for mouse/draw events)
                                this.widgets.splice(currentIndex, 0, copyButtonWidget);
                                visibilityLogger.debug(`Inserted copy_from_image at index ${currentIndex}, type: "${copyButtonWidget.type}"`);
                            } else if (copyButtonWidget) {
                                visibilityLogger.debug(`copy_from_image already visible at ${this.widgets.indexOf(copyButtonWidget)}`);
                            }

                            // 6. After ALL widgets restored, refresh image dimensions
                            // CRITICAL: Must happen AFTER image_mode widget restored, otherwise refreshImageDimensions
                            // can't find the widget and returns early thinking USE_IMAGE is disabled
                            // See: 2025-11-11__20-09-38__full-postmortem_reconnect-timing-root-cause.md
                            if (this.scaleWidgetInstance && this.scaleWidgetInstance.refreshImageDimensions) {
                                logger.info('[Visibility] Widgets restored, triggering dimension refresh');
                                this.scaleWidgetInstance.refreshImageDimensions(this);
                            } else {
                                logger.debug('[Visibility] No scale widget or refresh method found');
                            }
                        } else {
                            visibilityLogger.error("Cannot find fill_color for button placement");
                        }
                    } else {
                        // When hiding, remove in reverse order to avoid index shifts
                        visibilityLogger.debug('HIDING WIDGETS - hasConnection is false');
                        const widgetsToHide = Object.keys(this.imageOutputWidgets)
                            .map(key => ({
                                key,
                                widget: this.imageOutputWidgets[key],
                                currentIndex: this.widgets.indexOf(this.imageOutputWidgets[key])
                            }))
                            .filter(item => item.widget && item.currentIndex !== -1)
                            .sort((a, b) => b.currentIndex - a.currentIndex); // Reverse order

                        visibilityLogger.debug('Widgets to hide:', widgetsToHide.map(w => `${w.key} at index ${w.currentIndex}`));

                        widgetsToHide.forEach(item => {
                            // Hide widget - save current value with validation (v0.5.0 corruption protection)
                            const currentValue = item.widget.value;
                            const validation = validateWidgetValue(item.key, currentValue, 'save');

                            if (!validation.valid) {
                                logCorruptionDiagnostics(validation.warnings, {
                                    widget: item.key,
                                    currentValue: currentValue,
                                    widgetIndex: item.currentIndex,
                                    operation: 'save (hiding widgets)'
                                });
                            }

                            // Save validated value
                            this.imageOutputWidgetValues[item.key] = validation.correctedValue;
                            visibilityLogger.debug(`Widget ${item.key} hidden from index ${item.currentIndex}, saved value: ${validation.correctedValue}`);

                            this.widgets.splice(item.currentIndex, 1);
                        });

                        // Update Mode(AR) for disconnect (backend state overridden, show defaults)
                        // NOTE: For RECONNECT, updateModeWidget() is called in refreshImageDimensions()
                        // after imageDimensionsCache is populated. This fixes timing issue where
                        // runtime_context.image_info was empty on reconnect.
                        // See: 2025-11-11__20-09-38__full-postmortem_reconnect-timing-root-cause.md
                        if (this.updateModeWidget) {
                            this.updateModeWidget(true);  // Force refresh to bypass cache
                            visibilityLogger.debug('Triggered updateModeWidget(forceRefresh=true) for disconnect');
                        }
                    }

                    // Resize node to accommodate shown/hidden widgets
                    // Preserve width, only change height
                    const currentSize = this.size || this.computeSize();
                    const newSize = this.computeSize();
                    this.setSize([currentSize[0], newSize[1]]);
                };

                // Initially hide widgets - delay until outputs are ready
                setTimeout(() => {
                    this.updateImageOutputVisibility();
                }, 100);

                // Monitor connection changes - store bound function on instance
                const originalOnConnectionsChange = this.onConnectionsChange;
                this.onConnectionsChange = function(type, index, connected, link_info) {
                    // Call original handler
                    if (originalOnConnectionsChange) {
                        originalOnConnectionsChange.apply(this, arguments);
                    }

                    // If image INPUT connection changed, update visibility (v0.6.1 fix)
                    if (type === LiteGraph.INPUT && this.inputs && this.inputs[index]) {
                        const input = this.inputs[index];
                        if (input.name === "image") {
                            this.updateImageOutputVisibility();
                        }
                    }
                };

                // Also monitor onConnectionsRemove for disconnect events (fallback)
                const originalOnConnectionsRemove = this.onConnectionsRemove;
                this.onConnectionsRemove = function(type, index, link_info) {
                    // Call original handler
                    if (originalOnConnectionsRemove) {
                        originalOnConnectionsRemove.apply(this, arguments);
                    }

                    // If image INPUT was disconnected, update visibility (v0.6.1 fix)
                    if (type === LiteGraph.INPUT && this.inputs && this.inputs[index]) {
                        const input = this.inputs[index];
                        if (input.name === "image") {
                            this.updateImageOutputVisibility();
                        }
                    }
                };

                // Periodic check for connection status changes (fallback for when events don't fire)
                // NOTE: This is necessary because LiteGraph disconnect events don't fire reliably
                // The 500ms polling is acceptable UX-wise and handles the edge case
                // v0.6.1: Changed to check INPUT image connection instead of OUTPUT
                this._lastImageConnectionState = false;
                this._connectionCheckInterval = setInterval(() => {
                    const imageInput = this.inputs ? this.inputs.find(inp => inp.name === "image") : null;
                    const currentState = imageInput && imageInput.link != null;

                    if (currentState !== this._lastImageConnectionState) {
                        visibilityLogger.debug(`Image INPUT connection state changed: ${this._lastImageConnectionState} → ${currentState}`);
                        this._lastImageConnectionState = currentState;
                        this.updateImageOutputVisibility();
                    }
                }, 500); // Check every 500ms

                return r;
            };

            // Intercept node-level mouse events to handle native widget tooltips
            // Native widgets don't get their mouse() method called by LiteGraph
            const originalOnMouseMove = nodeType.prototype.onMouseMove;
            nodeType.prototype.onMouseMove = function(event, localPos, graphCanvas) {
                // Check native widgets with tooltips first
                for (const widget of this.widgets) {
                    if (widget.infoIcon && widget.type !== "custom") {
                        const canvasBounds = { width: this.size[0], height: this.size[1] };
                        if (widget.infoIcon.mouse(event, localPos, canvasBounds, this.pos)) {
                            this.setDirtyCanvas(true, true);
                            return true; // Tooltip handled the event
                        }
                    }
                }

                // Call original handler
                if (originalOnMouseMove) {
                    return originalOnMouseMove.call(this, event, localPos, graphCanvas);
                }
                return false;
            };

            const originalOnMouseDown = nodeType.prototype.onMouseDown;
            nodeType.prototype.onMouseDown = function(event, localPos, graphCanvas) {
                // Check native widgets with tooltips first (for Shift+Click)
                for (const widget of this.widgets) {
                    if (widget.infoIcon && widget.type !== "custom") {
                        const canvasBounds = { width: this.size[0], height: this.size[1] };
                        if (widget.infoIcon.mouse(event, localPos, canvasBounds, this.pos)) {
                            this.setDirtyCanvas(true, true);
                            return true; // Tooltip handled the event
                        }
                    }
                }

                // Call original handler
                if (originalOnMouseDown) {
                    return originalOnMouseDown.call(this, event, localPos, graphCanvas);
                }
                return false;
            };

            // Store scale widget configuration in workflow (not sent to Python)
            const onSerialize = nodeType.prototype.serialize;
            nodeType.prototype.serialize = function() {
                // === SERIALIZATION DIAGNOSTICS (v0.5.0) ===
                // Capture widget array state at moment of serialization to debug corruption
                const serializationDiagnostics = {
                    timestamp: new Date().toISOString(),
                    widgetCount: this.widgets ? this.widgets.length : 0,
                    widgetPositions: {},
                    widgetValues: {},
                    imageOutputWidgetsState: {}
                };

                // Track all widget positions and values
                if (this.widgets) {
                    this.widgets.forEach((widget, index) => {
                        serializationDiagnostics.widgetPositions[widget.name] = index;
                        serializationDiagnostics.widgetValues[widget.name] = {
                            value: widget.value,
                            type: typeof widget.value,
                            visible: widget.type !== undefined // Hidden widgets have type undefined
                        };
                    });
                }

                // Track image output widgets specifically (corruption-prone area)
                if (this.imageOutputWidgets) {
                    Object.keys(this.imageOutputWidgets).forEach(key => {
                        const widget = this.imageOutputWidgets[key];
                        if (widget) {
                            const arrayIndex = this.widgets ? this.widgets.indexOf(widget) : -1;
                            serializationDiagnostics.imageOutputWidgetsState[key] = {
                                inArray: arrayIndex !== -1,
                                arrayIndex: arrayIndex,
                                currentValue: widget.value,
                                savedValue: this.imageOutputWidgetValues ? this.imageOutputWidgetValues[key] : undefined
                            };
                        }
                    });
                }

                // Log diagnostics
                if (visibilityLogger.debugEnabled) {
                    visibilityLogger.debug('[SERIALIZE] Widget array state:', serializationDiagnostics);
                }

                const data = onSerialize ? onSerialize.apply(this) : {};

                // === PHASE 2A: NAME-BASED SERIALIZATION (v0.5.1) ===
                // Serialize widgets by NAME instead of relying on array index
                // This prevents corruption at the source rather than fixing it during restore
                const widgetsByName = {};
                if (this.widgets) {
                    this.widgets.forEach(widget => {
                        widgetsByName[widget.name] = widget.value;
                    });
                }
                data.widgets_values_by_name = widgetsByName;
                if (visibilityLogger.debugEnabled) {
                    visibilityLogger.debug('[SERIALIZE] Saved widgets by name:', widgetsByName);
                }

                // Store scale widget step configuration
                const scaleWidget = this.widgets ? this.widgets.find(w => w instanceof ScaleWidget) : null;
                if (scaleWidget) {
                    if (!data.widgets_config) data.widgets_config = {};
                    data.widgets_config.scale = {
                        leftStep: scaleWidget.leftStep,
                        rightStep: scaleWidget.rightStep
                    };
                    logger.debug('Serializing scale config:', data.widgets_config.scale);
                }

                // Store serialization diagnostics for debugging (not needed in production, but helpful)
                if (!data.widgets_config) data.widgets_config = {};
                data.widgets_config._serialization_diagnostics = serializationDiagnostics;

                return data;
            };

            // Handle widget serialization for workflow save/load
            const onConfigure = nodeType.prototype.configure;
            nodeType.prototype.configure = function(info) {
                logger.group('configure called');
                logger.debug('info:', info);
                logger.debug('widgets_values:', info.widgets_values);

                // === DESERIALIZATION DIAGNOSTICS (v0.5.0) ===
                // Capture state before and after deserialization to debug corruption
                const beforeState = {
                    timestamp: new Date().toISOString(),
                    widgetCount: this.widgets ? this.widgets.length : 0,
                    widgetPositions: {},
                    widgetValues: {}
                };

                if (this.widgets) {
                    this.widgets.forEach((widget, index) => {
                        beforeState.widgetPositions[widget.name] = index;
                        beforeState.widgetValues[widget.name] = widget.value;
                    });
                }

                if (visibilityLogger.debugEnabled) {
                    visibilityLogger.debug('[DESERIALIZE-BEFORE] Widget state:', beforeState);
                }

                // Check if workflow has serialization diagnostics from save
                if (info.widgets_config && info.widgets_config._serialization_diagnostics) {
                    if (visibilityLogger.debugEnabled) {
                        visibilityLogger.debug('[DESERIALIZE] Serialization diagnostics from workflow:', info.widgets_config._serialization_diagnostics);
                    }
                }

                if (onConfigure) {
                    onConfigure.apply(this, arguments);
                }

                // === PHASE 2A: DIRECT NAME-BASED RESTORE (v0.5.2) ===
                // Prefer direct name-based serialization format over diagnostics-based restoration
                // This is the cleanest approach - values serialized by name, restored by name
                if (info.widgets_values_by_name) {
                    visibilityLogger.info('[NAME-BASED-RESTORE] Using direct name-based serialization (v0.5.2+)');
                    let restoredCount = 0;
                    let skippedCount = 0;

                    this.widgets.forEach(widget => {
                        if (info.widgets_values_by_name[widget.name] !== undefined) {
                            widget.value = info.widgets_values_by_name[widget.name];
                            restoredCount++;
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`[NAME-BASED-RESTORE] Restored ${widget.name} = ${JSON.stringify(widget.value)}`);
                            }
                        } else {
                            skippedCount++;
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`[NAME-BASED-RESTORE] Skipped ${widget.name} (not in saved data)`);
                            }
                        }
                    });

                    visibilityLogger.info(`[NAME-BASED-RESTORE] Direct restore complete: ${restoredCount} restored, ${skippedCount} skipped`);
                }
                // === PHASE 2a: DIAGNOSTICS-BASED RESTORE (v0.5.1 fallback) ===
                // Fix corruption by restoring widget values by name instead of index
                // Uses serialization diagnostics to map widget names to their saved values
                else if (info.widgets_config && info.widgets_config._serialization_diagnostics && info.widgets_values) {
                    const diagnostics = info.widgets_config._serialization_diagnostics;
                    visibilityLogger.info('[NAME-BASED-RESTORE] Using serialization diagnostics to restore by name');

                    // Build name→value map from save-time widget positions
                    const valuesByName = {};
                    Object.keys(diagnostics.widgetPositions).forEach(widgetName => {
                        const savedIndex = diagnostics.widgetPositions[widgetName];
                        if (savedIndex < info.widgets_values.length) {
                            valuesByName[widgetName] = info.widgets_values[savedIndex];
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`[NAME-BASED-RESTORE] Mapped ${widgetName} from saved index ${savedIndex}`);
                            }
                        }
                    });

                    // Restore values by name (current positions may differ from save time)
                    let restoredCount = 0;
                    let skippedCount = 0;
                    this.widgets.forEach(widget => {
                        if (valuesByName[widget.name] !== undefined) {
                            const savedValue = valuesByName[widget.name];
                            const currentIndex = this.widgets.indexOf(widget);

                            // Log position changes (indicates why index-based would corrupt)
                            const savedIndex = diagnostics.widgetPositions[widget.name];
                            if (savedIndex !== currentIndex) {
                                visibilityLogger.info(`[NAME-BASED-RESTORE] ${widget.name} position changed: saved index ${savedIndex} → current index ${currentIndex}`);
                            }

                            // Restore value (will be validated later)
                            widget.value = savedValue;
                            restoredCount++;
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`[NAME-BASED-RESTORE] Restored ${widget.name} = ${JSON.stringify(savedValue)}`);
                            }
                        } else {
                            skippedCount++;
                            if (visibilityLogger.debugEnabled) {
                                visibilityLogger.debug(`[NAME-BASED-RESTORE] Skipped ${widget.name} (not in diagnostics, keeping current value)`);
                            }
                        }
                    });

                    visibilityLogger.info(`[NAME-BASED-RESTORE] Restored ${restoredCount} widgets by name, skipped ${skippedCount}`);
                }

                // Restore widget values from saved workflow (old heuristic method for workflows without diagnostics)
                // NOTE: If name-based restore succeeded above, this section is skipped to avoid double-restoration
                const useNameBasedRestore = !!(info.widgets_config && info.widgets_config._serialization_diagnostics);
                if (info.widgets_values && !useNameBasedRestore) {
                    // Fallback for old workflows without diagnostics - use type-based heuristic matching
                    visibilityLogger.info('[FALLBACK-RESTORE] No serialization diagnostics - using old heuristic restore (may corrupt)');
                    visibilityLogger.info('[FALLBACK-RESTORE] Please re-save workflow to enable name-based restore');

                    // Restore ImageModeWidget (has {on, value} structure)
                    const imageModeWidgets = this.widgets.filter(w => w instanceof ImageModeWidget);
                    const imageModeValues = info.widgets_values.filter(v => v && typeof v === 'object' && 'on' in v && 'value' in v && typeof v.value === 'number' && v.value <= 1);

                    logger.debug('Found', imageModeWidgets.length, 'ImageModeWidgets and', imageModeValues.length, 'image mode values');

                    if (imageModeWidgets.length > 0 && imageModeValues.length > 0) {
                        logger.debug(`Restoring ${imageModeWidgets[0].name}:`, imageModeValues[0]);
                        imageModeWidgets[0].value = { ...imageModeValues[0] };
                    }

                    // Restore DimensionWidgets (have {on, value} structure)
                    const dimWidgets = this.widgets.filter(w => w instanceof DimensionWidget);
                    const dimValues = info.widgets_values.filter(v => v && typeof v === 'object' && 'on' in v && 'value' in v && typeof v.value === 'number' && v.value > 1);

                    logger.debug('Found', dimWidgets.length, 'DimensionWidgets and', dimValues.length, 'dimension values');

                    for (let i = 0; i < Math.min(dimWidgets.length, dimValues.length); i++) {
                        if (dimValues[i]) {
                            logger.debug(`Restoring ${dimWidgets[i].name}:`, dimValues[i]);
                            dimWidgets[i].value = { ...dimValues[i] };
                        }
                    }

                    // Restore ScaleWidget value (just the number)
                    const scaleWidgets = this.widgets.filter(w => w instanceof ScaleWidget);
                    const scaleValues = info.widgets_values.filter(v => typeof v === 'number');

                    logger.debug('Found', scaleWidgets.length, 'ScaleWidgets and', scaleValues.length, 'scale values');

                    for (let i = 0; i < Math.min(scaleWidgets.length, scaleValues.length); i++) {
                        if (typeof scaleValues[i] === 'number') {
                            logger.debug(`Restoring ${scaleWidgets[i].name} value:`, scaleValues[i]);
                            scaleWidgets[i].value = scaleValues[i];
                        }
                    }

                    // Restore ScaleWidget step configuration from widgets_config
                    if (info.widgets_config && info.widgets_config.scale) {
                        const scaleWidget = this.widgets.find(w => w instanceof ScaleWidget);
                        if (scaleWidget) {
                            scaleWidget.leftStep = info.widgets_config.scale.leftStep || 0.05;
                            scaleWidget.rightStep = info.widgets_config.scale.rightStep || 0.1;
                            logger.debug('Restored scale config:', info.widgets_config.scale);
                        }
                    }

                    // === DESERIALIZATION DIAGNOSTICS - AFTER (v0.5.0) ===
                    // Capture state after deserialization to compare with before state
                    const afterState = {
                        timestamp: new Date().toISOString(),
                        widgetCount: this.widgets ? this.widgets.length : 0,
                        widgetPositions: {},
                        widgetValues: {}
                    };

                    if (this.widgets) {
                        this.widgets.forEach((widget, index) => {
                            afterState.widgetPositions[widget.name] = index;
                            afterState.widgetValues[widget.name] = widget.value;
                        });
                    }

                    if (visibilityLogger.debugEnabled) {
                        visibilityLogger.debug('[DESERIALIZE-AFTER] Widget state:', afterState);
                    }

                    // Detect position changes (potential corruption source)
                    Object.keys(beforeState.widgetPositions).forEach(widgetName => {
                        const beforeIndex = beforeState.widgetPositions[widgetName];
                        const afterIndex = afterState.widgetPositions[widgetName];
                        if (beforeIndex !== afterIndex) {
                            visibilityLogger.info(`[DESERIALIZE] Widget position changed: ${widgetName} moved from index ${beforeIndex} → ${afterIndex}`);
                        }
                    });

                    // Validate combo widgets after workflow load (v0.5.0 corruption protection)
                    // This catches corruption that happens during serialization/deserialization
                    const comboWidgetsToValidate = ['output_image_mode', 'fill_type', 'fill_color',
                                                     'batch_size', 'scale', 'divisible_by', 'custom_ratio',
                                                     'dimension_megapixel', 'dimension_width', 'dimension_height'];
                    comboWidgetsToValidate.forEach(widgetName => {
                        const widget = this.widgets.find(w => w.name === widgetName);
                        if (widget && widget.value !== undefined) {
                            const validation = validateWidgetValue(widgetName, widget.value, 'workflow-load');
                            if (!validation.valid) {
                                logCorruptionDiagnostics(validation.warnings, {
                                    widget: widgetName,
                                    loadedValue: widget.value,
                                    widgetIndex: this.widgets.indexOf(widget),
                                    operation: 'configure (workflow load)',
                                    workflowInfo: {
                                        hasWidgetsValues: !!info.widgets_values,
                                        widgetsValuesCount: info.widgets_values ? info.widgets_values.length : 0
                                    },
                                    beforeState: beforeState,
                                    afterState: afterState
                                });
                                widget.value = validation.correctedValue;
                                logger.info(`[Validation-workflow-load] Corrected ${widgetName}: ${widget.value} → ${validation.correctedValue}`);
                            }
                        }
                    });
                }

                logger.groupEnd();
            };

            // Add visual indicator when image input is connected
            // Also disable/enable USE_IMAGE widget based on connection state
            const onConnectionsChange = nodeType.prototype.onConnectionsChange;
            nodeType.prototype.onConnectionsChange = function(type, index, connected, link_info) {
                if (onConnectionsChange) {
                    onConnectionsChange.apply(this, arguments);
                }

                // Check if this is the image input (find it dynamically)
                if (type === LiteGraph.INPUT && this.inputs && this.inputs[index]) {
                    const input = this.inputs[index];

                    if (input.name === "image") {
                        // dimensionLogger.debug('[CONNECTION] Image connection change event, connected:', connected);

                        // Find the ImageModeWidget and ScaleWidget
                        const imageModeWidget = this.widgets?.find(w => w.name === "image_mode");
                        // IMPORTANT: Find the custom ScaleWidget instance, not the hidden default widget
                        const scaleWidget = this.widgets?.find(w => w instanceof ScaleWidget);

                        // dimensionLogger.verbose('[CONNECTION] imageModeWidget found:', imageModeWidget);
                        // dimensionLogger.verbose('[CONNECTION] scaleWidget found:', scaleWidget);
                        // dimensionLogger.verbose('[CONNECTION] scaleWidget.refreshImageDimensions exists:', scaleWidget?.refreshImageDimensions);

                        if (connected) {
                            // dimensionLogger.debug('[CONNECTION] Processing image CONNECTED event');

                            // Mark image as connected (enable asymmetric toggle logic)
                            if (imageModeWidget) {
                                imageModeWidget.imageDisconnected = false;
                            }

                            // NOTE: refreshImageDimensions() moved to updateImageOutputVisibility()
                            // Must be called AFTER widgets are restored, otherwise image_mode widget not found
                            // See: 2025-11-11__20-09-38__full-postmortem_reconnect-timing-root-cause.md

                            logger.debug('Image input connected - USE_IMAGE widget enabled');
                        } else {
                            // dimensionLogger.debug('[CONNECTION] Processing image DISCONNECTED event');

                            // Mark image as disconnected (enable asymmetric toggle logic)
                            if (imageModeWidget) {
                                imageModeWidget.imageDisconnected = true;
                            }

                            // Clear dimension cache when image disconnected
                            if (scaleWidget) {
                                // dimensionLogger.debug('[CONNECTION] Clearing cache for disconnected image');
                                scaleWidget.imageDimensionsCache = null;
                                logger.info('[Connection] Image disconnected, cleared scale dimension cache');
                            }

                            logger.debug('Image input disconnected - USE_IMAGE asymmetric toggle active');
                        }

                        // Trigger canvas redraw to update disabled state visually
                        if (this.graph && this.graph.canvas) {
                            this.graph.canvas.setDirty(true);
                        }
                    }
                }
            };

            // No node-level rendering needed - tooltips draw at graph level for proper z-order

            // WORKAROUND: Manually route mouse events to custom widgets
            // ComfyUI's addCustomWidget doesn't seem to be routing pointermove events correctly
            const onMouseMove = nodeType.prototype.onMouseMove;
            nodeType.prototype.onMouseMove = function(e, localPos, graphCanvas) {
                // Call original handler first
                if (onMouseMove) {
                    onMouseMove.apply(this, arguments);
                }

                // Manually route to custom widgets that have mouse() methods
                if (this.widgets) {
                    for (const widget of this.widgets) {
                        if (widget.type === "custom" && typeof widget.mouse === "function") {
                            // Convert event to pointermove format
                            const event = { type: "pointermove" };
                            // Call widget's mouse handler with node-local coordinates
                            if (widget.mouse(event, localPos, this)) {
                                // Widget handled the event, mark canvas as dirty to trigger redraw
                                this.setDirtyCanvas(true);
                                return true;
                            }
                        }
                    }
                }

                return false;
            };

            // WORKAROUND: Manually route mouse down events to custom widgets
            const onMouseDown = nodeType.prototype.onMouseDown;
            nodeType.prototype.onMouseDown = function(e, localPos, graphCanvas) {
                // Call original handler first
                if (onMouseDown) {
                    const result = onMouseDown.apply(this, arguments);
                    if (result) return result;
                }

                // Manually route to custom widgets that have mouse() methods
                if (this.widgets) {
                    for (const widget of this.widgets) {
                        if (widget.type === "custom" && typeof widget.mouse === "function") {
                            // Convert event to pointerdown format
                            const event = { type: "pointerdown" };
                            // Call widget's mouse handler with node-local coordinates
                            if (widget.mouse(event, localPos, this)) {
                                // Widget handled the event, mark canvas as dirty to trigger redraw
                                this.setDirtyCanvas(true);
                                return true;
                            }
                        }
                    }
                }

                return false;
            };

        }
    },

    // Hook into global canvas rendering to draw tooltips on top of EVERYTHING
    async setup() {
        logger.verbose('setup() called - hooking app.canvas.onDrawForeground');

        const originalDrawForeground = app.canvas.onDrawForeground;

        app.canvas.onDrawForeground = function(ctx) {
            if (originalDrawForeground) {
                originalDrawForeground.call(this, ctx);
            }

            // Draw tooltips at graph level with SCREEN COORDINATES (proper z-order)
            // The context has graph-space transform applied, so we need to:
            // 1. Get current transform to convert icon bounds to screen space
            // 2. Reset transform to identity (screen space)
            // 3. Draw tooltip at screen coordinates
            // 4. Restore original transform

            if (!tooltipManager.activeTooltip) return;

            // Get current transform (graph to screen)
            const transform = ctx.getTransform();

            // Convert icon bounds from canvas-global to screen coordinates
            const bounds = tooltipManager.activeTooltip.bounds;
            const screenBounds = {
                x: bounds.x * transform.a + bounds.y * transform.c + transform.e,
                y: bounds.x * transform.b + bounds.y * transform.d + transform.f,
                width: bounds.width * transform.a,
                height: bounds.height * transform.d
            };


            // Get device pixel ratio for proper scaling
            const dpr = window.devicePixelRatio || 1;
            logger.verbose('Device pixel ratio:', dpr);

            // Save current state and reset to device-pixel-ratio transform
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // Calculate canvas bounds in CSS pixels
            const canvasBounds = {
                width: this.canvas ? this.canvas.width / dpr : 2000,
                height: this.canvas ? this.canvas.height / dpr : 2000
            };

            // Convert screen bounds from device pixels to CSS pixels
            const cssBounds = {
                x: screenBounds.x / dpr,
                y: screenBounds.y / dpr,
                width: screenBounds.width / dpr,
                height: screenBounds.height / dpr
            };


            // Draw tooltip in CSS pixel space (with DPR transform applied)
            tooltipManager.drawAtScreenCoords(ctx, cssBounds, canvasBounds);

            // Restore transform
            ctx.restore();
        };

        logger.verbose('app.canvas.onDrawForeground hook installed');
    }
});

console.log("[SmartResCalc] Compact widgets loaded (rgthree-style) - Debug:", logger.enabled);

})().catch(error => {
    console.error("[SmartResCalc] Failed to load extension:", error);
    console.error("[SmartResCalc] This may be due to incorrect import paths. Check browser console for details.");
});
