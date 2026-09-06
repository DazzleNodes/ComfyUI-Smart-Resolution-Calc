/**
 * SeedWidget — toggle-based seed input with randomize/fix/recall buttons
 *
 * Extracted from smart_resolution_calc.js (Phase 5 refactor).
 * Lines 1720-2181 of the original file.
 *
 * Layout: [SEED] [toggle] ......... [dice][lock][recycle] [-][VALUE][+]
 *
 * Toggle semantics:
 *   ON  = Active. Special values (-1/-2/-3) interpreted. Noise RNG seeded. Tracks lastSeed.
 *   OFF = Passthrough. Value is literal. No RNG seeding. Buttons still work.
 *
 * Buttons (always clickable):
 *   dice    = "Randomize Each Time" -- sets value to -1
 *   lock    = "New Fixed Random" -- generates random >= 0, sets as value
 *   recycle = "Recall Last Seed" -- sets value to lastSeed (grayed when none)
 *
 * Data: { on: boolean, value: number } (same structure as DimensionWidget)
 */

import { WIDGET_MARGIN, WIDGET_INNER_MARGIN, WIDGET_LABEL_FONT, WIDGET_LABEL_COLOR_ON, WIDGET_LABEL_COLOR_OFF } from './DazzleWidget.js';
import { DazzleToggleWidget } from './DazzleToggleWidget.js';
import { logger } from '../utils/debug_logger.js';

// ===== Seed Widget Special Values (matching rgthree convention) =====
const SPECIAL_SEED_RANDOM = -1;
const SPECIAL_SEED_INCREMENT = -2;
const SPECIAL_SEED_DECREMENT = -3;
const SPECIAL_SEEDS = [SPECIAL_SEED_RANDOM, SPECIAL_SEED_INCREMENT, SPECIAL_SEED_DECREMENT];
const SEED_MAX = 1125899906842624;  // Match rgthree's max
// Text colour for the informational last-seed readout shown in random mode
// (dimmed green-grey on the random-mode tint, so it reads as "for information").
const SEED_DISPLAY_DIM_COLOR = "#9bb59b";

class SeedWidget extends DazzleToggleWidget {
    constructor(name, defaultValue = -1, config = {}) {
        super(name, { on: true, value: defaultValue }, config);

        // Last seed tracking (for recall button)
        this.lastSeed = null;

        // Randomize mode: when true, each queue generates a new random seed.
        // Set by dice button, cleared by lock/recycle/manual entry.
        // The value gets updated to the actual seed on each queue (for workflow saving)
        // but resets to -1 before the NEXT queue to trigger a new random.
        // Default to true when starting with -1 (random) so the green tint shows.
        this.randomizeMode = (defaultValue === SPECIAL_SEED_RANDOM);

        // Hit areas for mouse interaction (updated during draw)
        this.hitAreas = {
            toggle: { x: 0, y: 0, width: 0, height: 0 },
            btnRandomize: { x: 0, y: 0, width: 0, height: 0 },
            btnFixRandom: { x: 0, y: 0, width: 0, height: 0 },
            btnRecallLast: { x: 0, y: 0, width: 0, height: 0 },
            valueDec: { x: 0, y: 0, width: 0, height: 0 },
            valueInc: { x: 0, y: 0, width: 0, height: 0 },
            valueEdit: { x: 0, y: 0, width: 0, height: 0 }
        };

        // Tooltip state for hovering over buttons
        this._hoveredButton = null;
    }

    /**
     * Generate a random seed value in [0, SEED_MAX]
     */
    generateRandomSeed() {
        let seed = Math.floor(Math.random() * SEED_MAX);
        // Avoid special values
        if (SPECIAL_SEEDS.includes(seed)) {
            seed = 0;
        }
        return seed;
    }

    /**
     * Set random mode on or off. Single call site for all random mode state
     * transitions — controls green background tint and dice button highlight.
     */
    setRandomMode(active) {
        this.randomizeMode = active;
    }

    /**
     * Hydrate lastSeed from the node's persisted mirror property.
     *
     * Runtime widget props are wiped by every graph load (loadGraphData
     * recreates node objects), while node.properties ride the workflow JSON
     * and the image metadata. Called from the configure hook so the recycle
     * button (and -2/-3 increment/decrement) work immediately after a
     * workflow reload or an image drag-in, and from the queue-time intercept
     * as a fallback. Never overwrites a live lastSeed.
     *
     * @param {object} node - LiteGraph node owning this widget
     * @returns {boolean} true if lastSeed was populated from the property
     */
    hydrateLastSeedFromNode(node) {
        if (this.lastSeed != null) return false;
        const saved = node?.properties?.dazzle_last_seed;
        if (typeof saved !== "number" || SPECIAL_SEEDS.includes(saved)) return false;
        this.lastSeed = saved;
        return true;
    }

    /**
     * Resolve the actual seed to use (handles special values when ON)
     * Called before queue to determine the real seed for RNG seeding.
     * Returns the value as-is when toggle is OFF.
     */
    resolveActualSeed() {
        if (!this.value.on) {
            // OFF mode: passthrough, no interpretation
            return this.value.value;
        }

        const inputSeed = Number(this.value.value);

        if (!SPECIAL_SEEDS.includes(inputSeed)) {
            // Fixed seed (>= 0 or < -3): use as-is
            return inputSeed;
        }

        // Special value interpretation (ON mode only)
        let resolved = null;

        if (typeof this.lastSeed === "number" && !SPECIAL_SEEDS.includes(this.lastSeed)) {
            if (inputSeed === SPECIAL_SEED_INCREMENT) {
                resolved = this.lastSeed + 1;
            } else if (inputSeed === SPECIAL_SEED_DECREMENT) {
                resolved = this.lastSeed - 1;
            }
        }

        // If still null or resolved to a special value, generate random
        if (resolved == null || SPECIAL_SEEDS.includes(resolved)) {
            resolved = this.generateRandomSeed();
        }

        return resolved;
    }

    /**
     * Draw the seed widget
     */
    draw(ctx, node, width, y, height) {
        const isActive = this.value.on;

        // Draw shared frame: background, toggle, set hitAreas.toggle
        const { posX: labelX, midY, margin, innerMargin } = this.drawWidgetFrame(ctx, node, width, y, height, isActive);
        let posX = labelX;

        // Draw label
        ctx.fillStyle = isActive ? WIDGET_LABEL_COLOR_ON : WIDGET_LABEL_COLOR_OFF;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = WIDGET_LABEL_FONT;
        const labelText = "SEED";
        const labelTextWidth = ctx.measureText(labelText).width;
        ctx.fillText(labelText, posX, midY);

        // Set tooltip trigger area on label
        if (this.infoIcon) {
            this.infoIcon.setHitArea(posX, y, labelTextWidth, height);
        }

        // ===== RIGHT SIDE: Buttons + Value =====
        // Layout from right: [margin][+][VALUE][-][btnRecall][btnFix][btnRandom]
        const numberWidth = 160;  // Wider than DimensionWidget to fit 16-digit seed values
        const btnSize = 18;
        const btnGap = 2;
        const totalBtnWidth = btnSize * 3 + btnGap * 2;
        const numberX = width - margin - numberWidth - innerMargin;
        const btnStartX = numberX - totalBtnWidth - innerMargin;

        // Draw three icon buttons
        const btnAlpha = isActive ? 1.0 : 0.5;  // Dim when OFF
        ctx.globalAlpha = btnAlpha;

        // Button 1: Randomize Each Time (dice) — highlighted when randomize mode active
        this._drawIconButton(ctx, btnStartX, y, btnSize, height, "\uD83C\uDFB2", "btnRandomize",
            this.randomizeMode && isActive);

        // Button 2: New Fixed Random (lock)
        this._drawIconButton(ctx, btnStartX + btnSize + btnGap, y, btnSize, height, "\uD83D\uDD12", "btnFixRandom", false);

        // Button 3: Recall Last Seed (recycle)
        const hasLastSeed = this.lastSeed != null;
        this._drawIconButton(ctx, btnStartX + (btnSize + btnGap) * 2, y, btnSize, height, "\u267B\uFE0F", "btnRecallLast",
            false, !hasLastSeed);

        ctx.globalAlpha = 1.0;

        // Draw number controls (RIGHT side)
        if (isActive) {
            // Green tint when randomizeMode active — visual cue that seed changes each queue
            const backgroundColor = (this.randomizeMode && isActive) ? "#1a2a1a" : undefined;
            const { text: displayValue, color: textColor } = this.getDisplayState();
            this.drawNumberWidget(ctx, numberX, y, numberWidth, height, true, {
                displayValue,
                backgroundColor,
                textColor
            });
        } else {
            // Grayed out value (still clickable)
            ctx.fillStyle = "#555555";
            ctx.textAlign = "center";
            ctx.font = "12px monospace";
            const displayValue = this._formatSeedValue(this.value.value);
            ctx.fillText(displayValue, numberX + numberWidth / 2, midY);
            this.hitAreas.valueEdit = { x: numberX, y: y, width: numberWidth, height: height };
            this.hitAreas.valueDec = { x: 0, y: 0, width: 0, height: 0 };
            this.hitAreas.valueInc = { x: 0, y: 0, width: 0, height: 0 };
        }

        ctx.restore();
    }

    /**
     * Draw a small icon button and set its hit area
     */
    _drawIconButton(ctx, x, y, size, rowHeight, icon, hitAreaKey, isHighlighted, isDisabled = false) {
        const midY = y + rowHeight / 2;
        const btnY = y + (rowHeight - size) / 2;

        ctx.save();

        // Button background
        if (isDisabled) {
            ctx.fillStyle = "#2a2a2a";
        } else if (isHighlighted) {
            ctx.fillStyle = "#3a5a3a";  // Green-ish highlight for active state
        } else {
            ctx.fillStyle = "#3a3a3a";
        }
        ctx.beginPath();
        ctx.roundRect(x, btnY, size, size, 3);
        ctx.fill();

        // Icon text
        ctx.fillStyle = isDisabled ? "#555555" : "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "11px sans-serif";
        ctx.fillText(icon, x + size / 2, midY);

        ctx.restore();

        // Set hit area
        this.hitAreas[hitAreaKey] = { x: x, y: y, width: size, height: rowHeight };
    }

    /**
     * Format seed value for display — show label + literal value
     * so users know both what it means and what gets passed through
     */
    _formatSeedValue(value) {
        const v = Math.round(value);
        if (v === SPECIAL_SEED_RANDOM) return "Rnd: -1";
        if (v === SPECIAL_SEED_INCREMENT) return "Inc: -2";
        if (v === SPECIAL_SEED_DECREMENT) return "Dec: -3";
        return String(v);
    }

    /**
     * What the value box shows.
     *
     * In random mode with a known last seed, show that seed dimmed: the
     * stored value is still -1 (it re-rolls on the next queue; the green
     * tint and lit dice say so), but the user can read the seed that made
     * the current image, or the one carried by a reloaded workflow / dragged-
     * in image, without pressing recycle. Everywhere else the box shows the
     * stored value via _formatSeedValue (label + literal for -1/-2/-3).
     *
     * @returns {{text: string, color: (string|undefined), informational: boolean}}
     */
    getDisplayState() {
        const stored = Math.round(this.value.value);
        if (this.value.on && this.randomizeMode && stored === SPECIAL_SEED_RANDOM && this.lastSeed != null) {
            return { text: String(this.lastSeed), color: SEED_DISPLAY_DIM_COLOR, informational: true };
        }
        return { text: this._formatSeedValue(this.value.value), color: undefined, informational: false };
    }

    // drawToggle() — inherited from DazzleWidget (same as DimensionWidget)
    // drawNumberWidget() — inherited from DazzleWidget; called with { displayValue, backgroundColor } options

    /**
     * Handle mouse events
     */
    /**
     * Mark that the USER explicitly touched the seed controls. DazzleCommand's
     * "reuse last seed" honors this once (next queue resolves from the widget
     * instead of lastSeed, then re-locks on the new seed). Programmatic value
     * writes (e.g. the transient one-run reset) must NOT call this.
     * Mirrored to node.properties so intent survives a tab switch pre-queue.
     */
    _markUserSeedIntent(node) {
        this.userSeedIntent = true;
        if (node?.properties) node.properties.dazzle_seed_intent_pending = true;
        logger.debug(`SeedWidget: user seed intent marked (overrides 'reuse last seed' for next queue)`);
    }

    mouse(event, pos, node) {
        // Check info icon first (tooltip on label)
        if (this.handleTooltipMouse(event, pos, node)) return true;

        if (event.type === "pointerdown") {
            this.mouseDowned = [...pos];
            this.isMouseDownedAndOver = true;

            // Toggle click
            if (this.isInBounds(pos, this.hitAreas.toggle)) {
                this.value.on = !this.value.on;
                logger.debug(`SeedWidget toggle: ${this.value.on}`);
                node.setDirtyCanvas(true);
                return true;
            }

            // Randomize Each Time button — enables persistent random mode
            if (this.isInBounds(pos, this.hitAreas.btnRandomize)) {
                this.setRandomMode(true);
                this.value.value = SPECIAL_SEED_RANDOM;
                this._markUserSeedIntent(node);
                logger.debug(`SeedWidget: Randomize Each Time (randomizeMode=true)`);
                node.setDirtyCanvas(true);
                return true;
            }

            // New Fixed Random button — clears random mode
            if (this.isInBounds(pos, this.hitAreas.btnFixRandom)) {
                // Save current seed before overwriting so recycle can recover it
                const previousValue = this.value.value;
                if (previousValue >= 0) {
                    this.lastSeed = previousValue;
                }
                this.setRandomMode(false);
                this.value.value = this.generateRandomSeed();
                this._markUserSeedIntent(node);
                logger.debug(`SeedWidget: New Fixed Random (value = ${this.value.value}, lastSeed = ${this.lastSeed})`);
                node.setDirtyCanvas(true);
                return true;
            }

            // Recall Last Seed button — clears random mode, locks seed
            if (this.isInBounds(pos, this.hitAreas.btnRecallLast)) {
                logger.debug(`SeedWidget: Recycle button (lastSeed=${this.lastSeed}, currentValue=${this.value.value})`);
                if (this.lastSeed != null) {
                    this.setRandomMode(false);
                    this.value.value = this.lastSeed;
                    this._markUserSeedIntent(node);
                    logger.debug(`SeedWidget: Recall Last Seed (value = ${this.lastSeed})`);
                    node.setDirtyCanvas(true);
                } else {
                    logger.debug(`SeedWidget: Recycle - no lastSeed available`);
                }
                return true;
            }

            // Value editing (always allowed, matching DimensionWidget ALWAYS behavior)
            // Decrement
            if (this.isInBounds(pos, this.hitAreas.valueDec)) {
                this.value.value = Math.round(this.value.value) - 1;
                this.setRandomMode(this.value.value === SPECIAL_SEED_RANDOM);
                this._markUserSeedIntent(node);
                node.setDirtyCanvas(true);
                return true;
            }

            // Increment
            if (this.isInBounds(pos, this.hitAreas.valueInc)) {
                this.value.value = Math.round(this.value.value) + 1;
                this.setRandomMode(this.value.value === SPECIAL_SEED_RANDOM);
                this._markUserSeedIntent(node);
                node.setDirtyCanvas(true);
                return true;
            }

            // Value edit (click to type)
            if (this.isInBounds(pos, this.hitAreas.valueEdit)) {
                const currentValue = Math.round(this.value.value);
                this.services.prompt("Seed (-1=rnd, -2=inc, -3=dec)", String(currentValue), (newValue) => {
                    const parsed = parseInt(newValue);
                    if (!isNaN(parsed)) {
                        this.value.value = parsed;
                        // Activate random mode if user typed -1, clear otherwise
                        this.setRandomMode(parsed === SPECIAL_SEED_RANDOM);
                        this._markUserSeedIntent(node);
                        node.setDirtyCanvas(true);
                    }
                }, event);
                return true;
            }
        }

        return false;
    }

    // isInBounds() — inherited from DazzleWidget
    // computeSize() — inherited from DazzleWidget (24px compact height)

    /**
     * Serialize value for workflow JSON.
     *
     * Key behavior: when randomizeMode is active, generate a new random seed,
     * update this.value.value to the actual seed used (so it's saved in the
     * workflow JSON for reproducibility), and send the resolved value to Python.
     * The randomizeMode flag persists so the NEXT queue generates a new random.
     *
     * This matches rgthree's approach: the workflow saved with a generated image
     * always contains the actual seed used, even when "randomize each time" is on.
     */
    /**
     * Serialize value for workflow JSON.
     *
     * This is a PURE PASSTHROUGH — no seed resolution happens here.
     * Seed resolution is handled by the prompt interception hook in
     * setup() which patches the prompt data right before it's sent
     * to the server. This avoids the problem where auto-save/serialize
     * cycles would call serializeValue repeatedly, generating new
     * random seeds and overwriting lastSeed with values that were
     * never actually sent to Python.
     *
     * The widget value stays at -1 during randomize mode. The actual
     * resolved seed is only in the prompt data and lastSeed.
     */
    serializeValue(node, index) {
        return this.value;
    }
}

export {
    SeedWidget,
    SPECIAL_SEED_RANDOM,
    SPECIAL_SEED_INCREMENT,
    SPECIAL_SEED_DECREMENT,
    SPECIAL_SEEDS,
    SEED_MAX
};
