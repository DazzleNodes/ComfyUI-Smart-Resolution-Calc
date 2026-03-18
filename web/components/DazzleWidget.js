/**
 * DazzleWidget -- base class for custom ComfyUI canvas widgets
 *
 * Provides shared functionality for all DazzleNodes custom widgets:
 * - Hit testing (isInBounds)
 * - Toggle switch drawing (drawToggle)
 * - Number input with +/- buttons (drawNumberWidget)
 * - Tooltip mouse handling (handleTooltipMouse)
 * - Compact layout defaults (computeSize)
 * - Standard constructor boilerplate (name, type, value, hitAreas, infoIcon)
 *
 * Subclasses MUST override: draw()
 * Subclasses MAY override: mouse(), serializeValue(), computeSize()
 */

import { InfoIcon } from './TooltipSystem.js';

// =========================================================================
// Shared draw constants — identical across all toggle-based widgets
// =========================================================================
const WIDGET_MARGIN = 15;           // Left/right margin from node edge
const WIDGET_INNER_MARGIN = 3;      // Spacing between toggle, label, and controls
const WIDGET_BG_COLOR = "#1e1e1e";  // Widget background color
const WIDGET_BG_RADIUS = 4;         // Background corner radius
const WIDGET_LABEL_FONT = "13px sans-serif";  // Label font (slightly smaller for compact layout)
const WIDGET_LABEL_COLOR_ON = "#ffffff";       // Label color when toggle ON
const WIDGET_LABEL_COLOR_OFF = "#888888";      // Label color when toggle OFF
const WIDGET_TOGGLE_COLOR_ON = "#4CAF50";      // Toggle circle color when ON (green)
const WIDGET_TOGGLE_COLOR_OFF = "#888888";     // Toggle circle color when OFF (gray)

class DazzleWidget {
    constructor(name, defaultValue, config = {}) {
        this.name = name;
        this.type = "custom";
        this.value = defaultValue;

        // Mouse state (shared by all interactive widgets)
        this.mouseDowned = null;
        this.isMouseDownedAndOver = false;

        // Hit areas — subclasses define their own keys
        this.hitAreas = {};

        // Optional tooltip support (passed via config, not hardcoded)
        this.infoIcon = config.tooltipContent
            ? new InfoIcon(config.tooltipContent) : null;

        // Compact height default (overridable via config or computeSize override)
        this._height = config.height ?? 24;
    }

    // =========================================================================
    // SHARED METHODS — identical across multiple widgets
    // =========================================================================

    /**
     * Check if a position is within a rectangular bounds
     * Used by all widgets for mouse hit testing
     */
    isInBounds(pos, bounds) {
        if (!bounds) return false;
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

    /**
     * Draw an ON/OFF toggle switch (rgthree-style pill)
     * Used by DimensionWidget, SeedWidget, ImageModeWidget
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x - Left edge
     * @param {number} y - Top edge
     * @param {number} height - Row height
     * @param {boolean} state - ON (true) or OFF (false)
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
        ctx.fillStyle = state ? WIDGET_TOGGLE_COLOR_ON : WIDGET_TOGGLE_COLOR_OFF;
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draw the shared frame for toggle-based widgets
     * Used by DimensionWidget, SeedWidget, ImageModeWidget
     *
     * Draws: ctx.save → background rect → toggle switch → sets hitAreas.toggle → advances posX
     * Returns { posX, midY, margin, innerMargin } for the subclass to continue drawing
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} node - LiteGraph node
     * @param {number} width - Widget width
     * @param {number} y - Top edge Y
     * @param {number} height - Row height
     * @param {boolean} toggleState - ON (true) or OFF (false)
     * @returns {{ posX: number, midY: number, margin: number, innerMargin: number }}
     */
    drawWidgetFrame(ctx, node, width, y, height, toggleState) {
        const margin = WIDGET_MARGIN;
        const innerMargin = WIDGET_INNER_MARGIN;
        const midY = y + height / 2;

        ctx.save();

        // Draw background (rounded)
        ctx.fillStyle = WIDGET_BG_COLOR;
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, height - 2, WIDGET_BG_RADIUS);
        ctx.fill();

        let posX = margin + innerMargin;

        // Draw toggle switch (LEFT side)
        const toggleWidth = height * 1.5;
        this.drawToggle(ctx, posX, y, height, toggleState);
        this.hitAreas.toggle = { x: posX, y: y, width: toggleWidth, height: height };
        posX += toggleWidth + innerMargin * 2;

        return { posX, midY, margin, innerMargin };
    }

    /**
     * Draw a number input widget with +/- buttons
     * Used by DimensionWidget, SeedWidget
     *
     * Sets this.hitAreas.valueDec, this.hitAreas.valueEdit, this.hitAreas.valueInc
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x - Left edge
     * @param {number} y - Top edge
     * @param {number} width - Total width
     * @param {number} height - Row height
     * @param {boolean} isActive - Whether the widget is active/ON
     * @param {object} options - Optional overrides
     * @param {string} options.displayValue - Formatted value string to display
     * @param {string} options.backgroundColor - Override background color
     */
    drawNumberWidget(ctx, x, y, width, height, isActive, options = {}) {
        const buttonWidth = 18;
        const midY = y + height / 2;

        ctx.save();

        // Value background (with optional override for e.g. SeedWidget green tint)
        if (options.backgroundColor) {
            ctx.fillStyle = options.backgroundColor;
        } else {
            ctx.fillStyle = isActive ? "#2a2a2a" : "#1a1a1a";
        }
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
        const displayValue = options.displayValue ?? String(this.value);
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
     * Check tooltip interaction and handle if hit
     * Common pattern: every widget with an infoIcon checks this at the start of mouse()
     *
     * @returns {boolean} true if tooltip handled the event
     */
    handleTooltipMouse(event, pos, node) {
        if (!this.infoIcon) return false;
        const canvasBounds = { width: node.size[0], height: node.size[1] };
        if (this.infoIcon.mouse(event, pos, canvasBounds, node.pos)) {
            node.setDirtyCanvas(true);
            return true;
        }
        return false;
    }

    // =========================================================================
    // OVERRIDABLE DEFAULTS — subclasses override as needed
    // =========================================================================

    /**
     * Compute widget size for layout
     * Default: [width, 24] (compact). Override for different heights.
     */
    computeSize(width) {
        return [width, this._height];
    }

    /**
     * Draw the widget on the canvas
     * MUST be overridden by subclasses
     */
    draw(ctx, node, width, y, height) {
        throw new Error(`${this.constructor.name}.draw() not implemented`);
    }

    /**
     * Handle mouse events
     * Default: no interaction. Override for interactive widgets.
     */
    mouse(event, pos, node) {
        return false;
    }

    /**
     * Serialize value for workflow JSON
     * Default: return this.value as-is. Override for complex serialization (SeedWidget)
     * or to return undefined (buttons that don't serialize).
     */
    serializeValue(node, index) {
        return this.value;
    }
}

// =========================================================================
// Widget Visibility Utilities
// Hide/show widgets by overriding draw/computeSize/mouse instead of
// array splice. Widgets stay in the array — no index drift, no state
// corruption, no type property mutation.
// See: 2025-11-11__10-47-00__canvas-corruption-fix-learnings.md
// =========================================================================

/**
 * Hide a widget — suppress rendering while keeping it in the widgets array.
 * Preserves original methods for restoration via showWidget().
 */
function hideWidget(widget) {
    if (widget._hidden) return;
    widget._hidden = true;
    widget._origDraw = widget.draw;
    widget._origComputeSize = widget.computeSize;
    widget._origMouse = widget.mouse;
    widget.draw = function() {};
    widget.computeSize = function() { return [0, -4]; };
    widget.mouse = function() { return false; };
}

/**
 * Show a previously hidden widget — restore original methods.
 */
function showWidget(widget) {
    if (!widget._hidden) return;
    widget._hidden = false;
    if (widget._origDraw) widget.draw = widget._origDraw;
    if (widget._origComputeSize) widget.computeSize = widget._origComputeSize;
    if (widget._origMouse) widget.mouse = widget._origMouse;
}

export {
    DazzleWidget,
    hideWidget,
    showWidget,
    WIDGET_MARGIN,
    WIDGET_INNER_MARGIN,
    WIDGET_BG_COLOR,
    WIDGET_BG_RADIUS,
    WIDGET_LABEL_FONT,
    WIDGET_LABEL_COLOR_ON,
    WIDGET_LABEL_COLOR_OFF,
    WIDGET_TOGGLE_COLOR_ON,
    WIDGET_TOGGLE_COLOR_OFF
};
