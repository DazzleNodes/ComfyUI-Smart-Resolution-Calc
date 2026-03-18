/**
 * ModeStatusWidget -- read-only display showing current dimension calculation mode
 *
 * Extracted from smart_resolution_calc.js (Phase 7 refactor).
 *
 * Note: This widget accesses DimensionWidget/SeedWidget instances through
 *       node.widgets at runtime for display logic. No direct imports needed.
 */

import { logger } from '../utils/debug_logger.js';

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

export { ModeStatusWidget };
