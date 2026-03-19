/**
 * DazzleToggleWidget -- intermediate base class for toggle-based widgets
 *
 * Extends DazzleWidget with toggle-specific functionality:
 * - Value shape enforcement: { on: boolean, value: any }
 * - Toggle switch drawing (drawToggle)
 * - Widget frame with toggle (drawWidgetFrame template method)
 * - Number input with +/- buttons (drawNumberWidget)
 * - Toggle click handling (handleToggleClick)
 *
 * Used by: DimensionWidget, SeedWidget, ImageModeWidget
 * NOT used by: ScaleWidget (slider), ColorPickerButton, CopyImageButton, ModeStatusWidget
 *
 * Subclasses MUST override: draw()
 * Subclasses MAY override: mouse() (can use handleToggleClick() helper)
 */

import {
    DazzleWidget,
    WIDGET_MARGIN,
    WIDGET_INNER_MARGIN,
    WIDGET_BG_COLOR,
    WIDGET_BG_RADIUS
} from './DazzleWidget.js';

// =========================================================================
// Toggle Behavior Constants
// Moved from WidgetValidation.js — these are UI interaction contracts,
// not data validation schemas.
// =========================================================================

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

// Toggle-specific color constants
const WIDGET_TOGGLE_COLOR_ON = "#4CAF50";   // Toggle circle color when ON (green)
const WIDGET_TOGGLE_COLOR_OFF = "#888888";  // Toggle circle color when OFF (gray)

class DazzleToggleWidget extends DazzleWidget {
    constructor(name, defaultValue, config = {}) {
        // Enforce the value shape contract: { on: boolean, value: any }
        const initialValue = {
            on: defaultValue?.on ?? false,
            value: defaultValue?.value ?? null,
        };
        super(name, initialValue, config);
    }

    // =========================================================================
    // TOGGLE-SPECIFIC DRAWING METHODS
    // =========================================================================

    /**
     * Draw an ON/OFF toggle switch (rgthree-style pill)
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
     * Used by DimensionWidget, SeedWidget (not ImageModeWidget)
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

    // =========================================================================
    // TOGGLE INTERACTION HELPER
    // =========================================================================

    /**
     * Handle a mouse click on the toggle area.
     * Returns true if the toggle was clicked and its state was flipped.
     * The calling mouse() method is responsible for side effects and redrawing.
     *
     * @param {MouseEvent} event
     * @param {Array<number>} pos
     * @returns {boolean}
     */
    handleToggleClick(event, pos) {
        if (event.type === "pointerdown" && this.isInBounds(pos, this.hitAreas.toggle)) {
            this.value.on = !this.value.on;
            return true;
        }
        return false;
    }
}

export {
    DazzleToggleWidget,
    ToggleBehavior,
    ValueBehavior,
    WIDGET_TOGGLE_COLOR_ON,
    WIDGET_TOGGLE_COLOR_OFF
};
