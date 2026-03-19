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
// Toggle color constants moved to DazzleToggleWidget.js

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

        // Services — injectable dependencies for testability.
        // Defaults to ComfyUI globals. Tests inject mocks via config.services.
        // This avoids hard dependency on `app` global in widget code.
        this.services = config.services || {
            prompt: (...args) => app.canvas.prompt(...args),
        };
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

    // drawToggle(), drawWidgetFrame(), drawNumberWidget() — moved to DazzleToggleWidget.js

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
    WIDGET_LABEL_COLOR_OFF
};
