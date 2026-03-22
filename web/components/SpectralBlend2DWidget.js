/**
 * SpectralBlend2DWidget — 2D XY pad for controlling blend_strength + cutoff
 *
 * Renders an interactive 2D plot where:
 * - X axis = cutoff (0.05 - 0.5, fraction of Nyquist)
 * - Y axis = blend_strength (0.0 - 1.0)
 * - Draggable point at current position
 * - Background gradient showing influence zones (green=safe, yellow=boundary, red=abstract)
 *
 * Augments native blend_strength and cutoff widgets (reads/writes their values).
 * The native widgets stay for value storage and potential noodle input compatibility.
 */

import { DazzleWidget, WIDGET_MARGIN } from './DazzleWidget.js';

// Zone colors
const ZONE_SAFE = { r: 30, g: 120, b: 50 };      // Green — coherent
const ZONE_BOUNDARY = { r: 180, g: 160, b: 30 };  // Yellow — transitional
const ZONE_ABSTRACT = { r: 160, g: 40, b: 30 };   // Red — abstract/artifacts

// Parameter ranges
const CUTOFF_MIN = 0.05;
const CUTOFF_MAX = 0.50;
const BLEND_MIN = 0.0;
const BLEND_MAX = 1.0;

// Layout
const PAD_HEIGHT = 80;
const AXIS_LABEL_FONT = "10px sans-serif";
const VALUE_FONT = "11px sans-serif";
const POINT_RADIUS = 6;

class SpectralBlend2DWidget extends DazzleWidget {
    constructor(name = "spectral_blend_2d", blendWidget = null, cutoffWidget = null, config = {}) {
        super(name, { blend: 0.0, cutoff: 0.2 }, config);
        this.blendWidget = blendWidget;   // Reference to native blend_strength widget
        this.cutoffWidget = cutoffWidget; // Reference to native cutoff widget
        this.expanded = false;            // Collapsed by default — click to expand
        this._height = 23;               // Collapsed height (extra px for spacing below)
        this.isDragging = false;
        this.hoverValues = null;          // {blend, cutoff} when hovering over pad (preview only)
        this.axisTooltip = null;          // "blend" or "cutoff" when hovering axis label
    }

    /**
     * Compute the influence score for a given (blend, cutoff) pair.
     * Returns 0.0 (pure Gaussian) to 1.0 (maximum pattern influence).
     * Used for the background heatmap coloring.
     */
    _influenceScore(blend, cutoff) {
        // Influence grows with both blend and cutoff
        // cutoff=0.2 is the baseline — normalize relative to it
        const cutoffFactor = cutoff / 0.2;
        // Combined influence: blend * sqrt(cutoffFactor) gives a reasonable approximation
        // of how much total spectral energy is injected
        return Math.min(1.0, blend * Math.sqrt(cutoffFactor));
    }

    /**
     * Map influence score to a zone color
     */
    _scoreToColor(score, alpha = 0.35) {
        let r, g, b;
        if (score < 0.3) {
            // Safe zone — green
            const t = score / 0.3;
            r = ZONE_SAFE.r + (ZONE_BOUNDARY.r - ZONE_SAFE.r) * t;
            g = ZONE_SAFE.g + (ZONE_BOUNDARY.g - ZONE_SAFE.g) * t;
            b = ZONE_SAFE.b + (ZONE_BOUNDARY.b - ZONE_SAFE.b) * t;
        } else if (score < 0.6) {
            // Boundary zone — yellow
            const t = (score - 0.3) / 0.3;
            r = ZONE_BOUNDARY.r + (ZONE_ABSTRACT.r - ZONE_BOUNDARY.r) * t;
            g = ZONE_BOUNDARY.g + (ZONE_ABSTRACT.g - ZONE_BOUNDARY.g) * t;
            b = ZONE_BOUNDARY.b + (ZONE_ABSTRACT.b - ZONE_BOUNDARY.b) * t;
        } else {
            // Abstract zone — red
            r = ZONE_ABSTRACT.r;
            g = ZONE_ABSTRACT.g;
            b = ZONE_ABSTRACT.b;
        }
        return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    }

    /**
     * Convert parameter values to pixel coordinates within the pad area
     */
    _valuesToPixel(blend, cutoff, padX, padY, padW, padH) {
        const nx = (cutoff - CUTOFF_MIN) / (CUTOFF_MAX - CUTOFF_MIN);
        const ny = 1.0 - (blend - BLEND_MIN) / (BLEND_MAX - BLEND_MIN); // Y inverted (0 at bottom)
        return {
            x: padX + nx * padW,
            y: padY + ny * padH
        };
    }

    /**
     * Convert pixel coordinates to parameter values
     */
    _pixelToValues(px, py, padX, padY, padW, padH) {
        const nx = Math.max(0, Math.min(1, (px - padX) / padW));
        const ny = Math.max(0, Math.min(1, (py - padY) / padH));
        return {
            cutoff: CUTOFF_MIN + nx * (CUTOFF_MAX - CUTOFF_MIN),
            blend: BLEND_MAX - ny * (BLEND_MAX - BLEND_MIN) // Y inverted
        };
    }

    /**
     * Read current values from the native widgets
     */
    _readValues() {
        const blend = Number(this.blendWidget ? (this.blendWidget.value ?? 0.0) : this.value.blend) || 0.0;
        const cutoff = Number(this.cutoffWidget ? (this.cutoffWidget.value ?? 0.2) : this.value.cutoff) || 0.2;
        return { blend, cutoff };
    }

    /**
     * Write values to the native widgets
     */
    _writeValues(blend, cutoff) {
        // Round to reasonable precision
        blend = Math.round(blend * 1000) / 1000;
        cutoff = Math.round(cutoff * 1000) / 1000;

        // Clamp blend to 0-1 range
        blend = Math.max(BLEND_MIN, Math.min(BLEND_MAX, blend));
        // Cutoff: clamp to Nyquist range (0.01-0.50) OR allow pixel mode (>1.0)
        if (cutoff <= 1.0) {
            cutoff = Math.max(CUTOFF_MIN, Math.min(CUTOFF_MAX, cutoff));
        } else {
            cutoff = Math.max(1.0, Math.min(500.0, cutoff)); // Pixel mode
        }

        if (this.blendWidget) {
            this.blendWidget.value = blend;
            if (this.blendWidget.callback) this.blendWidget.callback(blend);
        }
        if (this.cutoffWidget) {
            this.cutoffWidget.value = cutoff;
            if (this.cutoffWidget.callback) this.cutoffWidget.callback(cutoff);
        }
        this.value = { blend, cutoff };
    }

    computeSize(width) {
        return [width, this.expanded ? PAD_HEIGHT + 20 : 23];
    }

    /**
     * Draw collapsed view — compact single line with values + zone indicator
     */
    _drawCollapsed(ctx, node, width, y, height) {
        const { blend, cutoff } = this._readValues();
        const score = this._influenceScore(blend, cutoff);
        const margin = WIDGET_MARGIN;

        // Store header bounds for click detection
        this.hitAreas.header = { x: margin, y: y + 1, width: width - margin * 2, height: 22 };

        // Background
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, 22, 4);
        ctx.fill();

        // Zone indicator dot
        ctx.beginPath();
        ctx.arc(margin + 12, y + 12, 5, 0, Math.PI * 2);
        ctx.fillStyle = this._scoreToColor(score, 1.0);
        ctx.fill();
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Label
        ctx.fillStyle = "#aaa";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("SPECTRAL", margin + 22, y + 16);

        // Set tooltip hit area on the "SPECTRAL" label
        if (this.infoIcon) {
            const spectralW = ctx.measureText("SPECTRAL").width;
            this.infoIcon.setHitArea(margin + 22, y + 2, spectralW, 18);
        }

        // Blend value (clickable)
        const blendText = `blend: ${blend.toFixed(3)}`;
        const blendLabelWidth = ctx.measureText("blend: ").width;
        ctx.fillStyle = "#ddd";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "left";
        const blendX = margin + 85;
        ctx.fillText(blendText, blendX, y + 16);
        const blendTextWidth = ctx.measureText(blendText).width;
        const blendNumX = blendX + blendLabelWidth;
        const blendNumW = blendTextWidth - blendLabelWidth;
        this.hitAreas.blendValue = { x: blendX, y: y + 2, width: blendTextWidth, height: 18,
                                     numX: blendNumX, numW: blendNumW };

        // Separator
        ctx.fillStyle = "#666";
        ctx.fillText("|", blendX + blendTextWidth + 6, y + 16);

        // Cutoff value (clickable) — show "px" suffix when in pixel mode (>1.0)
        const isPixelMode = cutoff > 1.0;
        const cutoffText = isPixelMode
            ? `cutoff: ${cutoff.toFixed(0)}px`
            : `cutoff: ${cutoff.toFixed(3)}`;
        const cutoffLabelWidth = ctx.measureText("cutoff: ").width;
        ctx.fillStyle = "#ddd";
        const cutoffX = blendX + blendTextWidth + 18;
        ctx.fillText(cutoffText, cutoffX, y + 16);
        const cutoffTextWidth = ctx.measureText(cutoffText).width;
        const cutoffNumX = cutoffX + cutoffLabelWidth;
        const cutoffNumW = cutoffTextWidth - cutoffLabelWidth;
        this.hitAreas.cutoffValue = { x: cutoffX, y: y + 2, width: cutoffTextWidth, height: 18,
                                      numX: cutoffNumX, numW: cutoffNumW };

        // Reset button for cutoff (shown when cutoff != 0.200)
        const resetX = cutoffX + cutoffTextWidth + 4;
        if (Math.abs(cutoff - 0.2) > 0.0005) {
            ctx.fillStyle = "#888";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText("\u21BA", resetX, y + 16);  // ↺ reset arrow
            this.hitAreas.resetCutoff = { x: resetX - 2, y: y + 2, width: 14, height: 18 };
        } else {
            this.hitAreas.resetCutoff = null;
        }

        // Expand arrow (right side)
        ctx.fillStyle = "#888";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(this.expanded ? "\u25B2" : "\u25BC", width - margin - 5, y + 16);
    }

    draw(ctx, node, width, y, height) {
        // Always draw collapsed header
        this._drawCollapsed(ctx, node, width, y, height);

        if (!this.expanded) return;
        const { blend, cutoff } = this._readValues();

        // Pad area dimensions (offset below the collapsed header)
        const margin = WIDGET_MARGIN;
        const headerHeight = 26;
        const padX = margin + 30;  // Space for Y axis label
        const padY = y + headerHeight;
        const padW = width - margin - padX - 10;
        const padH = PAD_HEIGHT - headerHeight + 4;

        // Store pad bounds for mouse hit testing
        this.hitAreas.pad = { x: padX, y: padY, width: padW, height: padH };

        // === Background heatmap ===
        const cellsX = 20;
        const cellsY = 16;
        const cellW = padW / cellsX;
        const cellH = padH / cellsY;

        for (let cx = 0; cx < cellsX; cx++) {
            for (let cy = 0; cy < cellsY; cy++) {
                const cellCutoff = CUTOFF_MIN + (cx / cellsX) * (CUTOFF_MAX - CUTOFF_MIN);
                const cellBlend = BLEND_MAX - (cy / cellsY) * (BLEND_MAX - BLEND_MIN);
                const score = this._influenceScore(cellBlend, cellCutoff);
                ctx.fillStyle = this._scoreToColor(score, 0.4);
                ctx.fillRect(padX + cx * cellW, padY + cy * cellH, cellW + 0.5, cellH + 0.5);
            }
        }

        // === Border ===
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 1;
        ctx.strokeRect(padX, padY, padW, padH);

        // === Grid lines ===
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.lineWidth = 0.5;
        // Vertical: cutoff ticks at 0.1, 0.2, 0.3, 0.4
        for (let c = 0.1; c <= 0.45; c += 0.1) {
            const gx = padX + ((c - CUTOFF_MIN) / (CUTOFF_MAX - CUTOFF_MIN)) * padW;
            ctx.beginPath();
            ctx.moveTo(gx, padY);
            ctx.lineTo(gx, padY + padH);
            ctx.stroke();
        }
        // Horizontal: blend ticks at 0.25, 0.5, 0.75
        for (const b of [0.25, 0.5, 0.75]) {
            const gy = padY + (1 - b) * padH;
            ctx.beginPath();
            ctx.moveTo(padX, gy);
            ctx.lineTo(padX + padW, gy);
            ctx.stroke();
        }

        // === Current position point ===
        const pos = this._valuesToPixel(blend, cutoff, padX, padY, padW, padH);
        // Outer ring
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, POINT_RADIUS + 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fill();
        // Inner point — color matches zone
        const score = this._influenceScore(blend, cutoff);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, POINT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = this._scoreToColor(score, 1.0);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // === Crosshairs from point to axes ===
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(pos.x, padY + padH);
        ctx.lineTo(pos.x, pos.y);
        ctx.moveTo(padX, pos.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // === Axis labels (show hover values when hovering) ===
        ctx.font = AXIS_LABEL_FONT;

        // Helper: draw text with dark outline for readability on colored backgrounds
        const drawOutlinedText = (text, x, y, fillColor, align, score) => {
            ctx.textAlign = align || "center";
            ctx.lineJoin = "round";
            ctx.letterSpacing = "0.3px";
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            ctx.lineWidth = 1.2;
            ctx.strokeText(text, x, y);
            // Fill: zone color
            ctx.fillStyle = fillColor;
            ctx.fillText(text, x, y);
            ctx.letterSpacing = "0px";
        };

        if (this.hoverValues) {
            const hv = this.hoverValues;
            const hoverScore = this._influenceScore(hv.blend, hv.cutoff);
            const hoverColor = this._scoreToColor(hoverScore, 1.0);

            // Y axis: "blend" label colored to match hover zone
            ctx.save();
            ctx.translate(padX - 18, padY + padH / 2);
            ctx.rotate(-Math.PI / 2);
            drawOutlinedText("blend", 0, 0, hoverColor, "center", hoverScore);
            ctx.restore();

            // X axis: "cutoff=" in zone color, value in default readable color
            const cutoffLabel = "cutoff=";
            const cutoffVal = hv.cutoff.toFixed(3);
            const cutoffLabelW = ctx.measureText(cutoffLabel).width;
            const cutoffFullW = ctx.measureText(cutoffLabel + cutoffVal).width;
            const cutoffStartX = padX + padW / 2 - cutoffFullW / 2;
            drawOutlinedText(cutoffLabel, cutoffStartX, padY + padH + 14, hoverColor, "left", hoverScore);
            drawOutlinedText(cutoffVal, cutoffStartX + cutoffLabelW, padY + padH + 14, "#ddd", "left", hoverScore);

            // Blend hover: "=" in zone color, value in default readable color
            drawOutlinedText("= ", padX - 25, padY + padH + 14, hoverColor, "left", hoverScore);
            const eqW = ctx.measureText("= ").width;
            drawOutlinedText(hv.blend.toFixed(3), padX - 25 + eqW, padY + padH + 14, "#ddd", "left", hoverScore);
        } else {
            // Static labels when not hovering (match letter spacing of outlined text)
            ctx.letterSpacing = "0.3px";

            ctx.save();
            ctx.translate(padX - 18, padY + padH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = "#aaa";
            ctx.textAlign = "center";
            ctx.fillText("blend", 0, 0);
            ctx.restore();

            ctx.fillStyle = "#aaa";
            ctx.textAlign = "center";
            ctx.fillText("cutoff", padX + padW / 2, padY + padH + 14);

            ctx.letterSpacing = "0px";
        }

        // Store tight hit areas for axis label tooltips (only in expanded, non-hover state)
        const blendLabelW = ctx.measureText("blend").width;
        this.hitAreas.axisBlend = {
            x: padX - 25, y: padY + padH / 2 - 8,
            width: 14, height: blendLabelW + 4
        };
        const cutoffLabelW2 = ctx.measureText("cutoff").width;
        this.hitAreas.axisCutoff = {
            x: padX + padW / 2 - cutoffLabelW2 / 2, y: padY + padH + 4,
            width: cutoffLabelW2, height: 14
        };

        // === Axis tooltip (lightweight, drawn on canvas) ===
        if (this.axisTooltip) {
            const tipText = this.axisTooltip === "blend"
                ? "How much pattern influence (0=none, 1=max)"
                : this.axisTooltip === "cutoff"
                ? "Soft rolloff center (low=big blobs only, high=blobs+detail)"
                : "Feature size in pixels at current res. Click to set (cutoff adjusts automatically). -1 resets to default.";
            const tipFont = "10px sans-serif";
            ctx.font = tipFont;
            const tipW = ctx.measureText(tipText).width + 12;
            const tipH = 18;
            let tipX, tipY;
            if (this.axisTooltip === "blend") {
                tipX = padX + 4;
                tipY = padY + padH / 2 - tipH / 2;
            } else if (this.axisTooltip === "cutoff") {
                tipX = padX + padW / 2 - tipW / 2;
                tipY = padY + padH - 4 - tipH;
            } else {
                // feature — position above the ~NNNpx text (bottom-right)
                tipX = padX + padW - tipW;
                tipY = padY + padH - 4 - tipH;
            }
            // Background
            ctx.fillStyle = "rgba(20,20,30,0.9)";
            ctx.beginPath();
            ctx.roundRect(tipX, tipY, tipW, tipH, 3);
            ctx.fill();
            ctx.strokeStyle = "#555";
            ctx.lineWidth = 0.5;
            ctx.stroke();
            // Text
            ctx.fillStyle = "#ddd";
            ctx.textAlign = "left";
            ctx.fillText(tipText, tipX + 6, tipY + 13);
        }

        // === Zone legend (compact) ===
        ctx.textAlign = "right";
        ctx.font = "9px sans-serif";
        const legendY = padY - 2;
        ctx.fillStyle = this._scoreToColor(0.1, 1.0);
        ctx.fillText("safe", padX + padW * 0.3, legendY);
        ctx.fillStyle = this._scoreToColor(0.45, 1.0);
        ctx.fillText("boundary", padX + padW * 0.65, legendY);
        ctx.fillStyle = this._scoreToColor(0.8, 1.0);
        ctx.fillText("abstract", padX + padW, legendY);

        // === Feature size (computed from cutoff * latent_size) ===
        // Shows what the current cutoff means in pixel-space at current resolution
        // Displayed bottom-right of the graph, clickable to override
        const widthWidget = node.widgets?.find(w => w.name === "dimension_width");
        const heightWidget = node.widgets?.find(w => w.name === "dimension_height");
        if (widthWidget || heightWidget) {
            // Get current dimensions (from widget values or node defaults)
            const imgW = widthWidget?.value?.value || 1024;
            const imgH = heightWidget?.value?.value || 1024;
            const spatialDiv = 8; // Default spatial divisor
            const latentSize = Math.max(imgW / spatialDiv, imgH / spatialDiv);
            const featureLatentPx = Math.round(cutoff * latentSize);
            const featurePixelPx = featureLatentPx * spatialDiv;

            const featureText = `~${featurePixelPx}px`;
            ctx.font = "9px sans-serif";
            ctx.textAlign = "right";
            ctx.fillStyle = "#999";
            ctx.fillText(featureText, padX + padW, padY + padH + 14);

            // Store hit area for click-to-edit
            // Use ~prefix width to position input on the number only
            const tildeW = ctx.measureText("~").width;
            const pxSuffixW = ctx.measureText("px").width;
            const fullFeatureW = ctx.measureText(featureText).width;
            const numOnlyW = fullFeatureW - tildeW - pxSuffixW;
            this.hitAreas.featureSize = {
                x: padX + padW - fullFeatureW, y: padY + padH + 4,
                width: fullFeatureW, height: 14,
                numX: padX + padW - fullFeatureW + tildeW,
                numW: numOnlyW,
                currentValue: featurePixelPx,
                latentSize: latentSize
            };
        }
    }

    mouse(event, pos, node) {
        // Check tooltip first
        if (this.handleTooltipMouse(event, pos, node)) return true;

        if (event.type === "pointerdown") {
            // Check if click is on feature_size in expanded graph — back-calculate cutoff
            if (this.expanded && this.hitAreas.featureSize && this.isInBounds(pos, this.hitAreas.featureSize)) {
                const fs = this.hitAreas.featureSize;
                const { blend } = this._readValues();
                this._showInlineEdit(node, fs, String(fs.currentValue), "-1=default",
                    (val) => {
                        const parsed = parseInt(val);
                        if (parsed === -1) {
                            // Reset to default cutoff (0.2) — no feature_size override
                            this._writeValues(blend, 0.2);
                            node.setDirtyCanvas(true);
                        } else if (!isNaN(parsed) && parsed > 0 && fs.latentSize > 0) {
                            const newCutoff = (parsed / 8) / fs.latentSize;
                            this._writeValues(blend, Math.max(0.01, Math.min(0.5, newCutoff)));
                            node.setDirtyCanvas(true);
                        }
                    },
                    { fontSize: 9, widthScale: 1.2, minWidth: 30 }
                );
                return true;
            }

            // Check if click is on blend value text — inline edit
            if (this.hitAreas.blendValue && this.isInBounds(pos, this.hitAreas.blendValue)) {
                const { blend, cutoff } = this._readValues();
                this._showInlineEdit(node, this.hitAreas.blendValue, blend.toFixed(3), "0.0-1.0", (val) => {
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) { this._writeValues(parsed, cutoff); node.setDirtyCanvas(true); }
                });
                return true;
            }

            // Check if click is on cutoff value text — inline edit
            if (this.hitAreas.cutoffValue && this.isInBounds(pos, this.hitAreas.cutoffValue)) {
                const { blend, cutoff } = this._readValues();
                this._showInlineEdit(node, this.hitAreas.cutoffValue, cutoff.toFixed(3), "0.01-0.50", (val) => {
                    const parsed = parseFloat(val);
                    if (!isNaN(parsed)) { this._writeValues(blend, parsed); node.setDirtyCanvas(true); }
                }, { minWidth: 47 });
                return true;
            }

            // Check if click is on cutoff reset button
            if (this.hitAreas.resetCutoff && this.isInBounds(pos, this.hitAreas.resetCutoff)) {
                const { blend } = this._readValues();
                this._writeValues(blend, 0.2);
                node.setDirtyCanvas(true);
                return true;
            }

            // Check if click is in the header area (collapsed bar) — toggle expand/collapse
            const header = this.hitAreas.header;
            if (header && this.isInBounds(pos, header)) {
                this.expanded = !this.expanded;
                // Resize node to accommodate expanded/collapsed state
                node.setSize(node.computeSize());
                node.setDirtyCanvas(true, true);
                return true;
            }

            // If expanded, check pad area for drag
            if (this.expanded) {
                const pad = this.hitAreas.pad;
                if (pad && this.isInBounds(pos, pad)) {
                    this.isDragging = true;
                    const values = this._pixelToValues(pos[0], pos[1], pad.x, pad.y, pad.width, pad.height);
                    this._writeValues(values.blend, values.cutoff);
                    node.setDirtyCanvas(true);
                    return true;
                }
            }
        }

        if (event.type === "pointermove") {
            if (this.isDragging) {
                const pad = this.hitAreas.pad;
                if (pad) {
                    const values = this._pixelToValues(pos[0], pos[1], pad.x, pad.y, pad.width, pad.height);
                    this._writeValues(values.blend, values.cutoff);
                    this.hoverValues = null; // Clear hover during drag (committed values shown in header)
                    node.setDirtyCanvas(true);
                }
                return true;
            }

            // Hover preview — show values at cursor position without committing
            if (this.expanded) {
                const pad = this.hitAreas.pad;
                if (pad && this.isInBounds(pos, pad)) {
                    const values = this._pixelToValues(pos[0], pos[1], pad.x, pad.y, pad.width, pad.height);
                    this.hoverValues = {
                        blend: Math.max(BLEND_MIN, Math.min(BLEND_MAX, values.blend)),
                        cutoff: Math.max(CUTOFF_MIN, Math.min(CUTOFF_MAX, values.cutoff))
                    };
                    this.axisTooltip = null; // Clear axis tooltip when over pad
                    node.setDirtyCanvas(true);
                    return true;
                } else {
                    // Not over pad — check axis label tooltips
                    if (this.hoverValues) {
                        this.hoverValues = null;
                        node.setDirtyCanvas(true);
                    }
                    const overBlend = this.hitAreas.axisBlend && this.isInBounds(pos, this.hitAreas.axisBlend);
                    const overCutoff = this.hitAreas.axisCutoff && this.isInBounds(pos, this.hitAreas.axisCutoff);
                    const overFeature = this.hitAreas.featureSize && this.isInBounds(pos, this.hitAreas.featureSize);
                    const newTip = overBlend ? "blend" : overCutoff ? "cutoff" : overFeature ? "feature" : null;
                    if (newTip !== this.axisTooltip) {
                        this.axisTooltip = newTip;
                        node.setDirtyCanvas(true);
                    }
                }
            }
        }

        if (event.type === "pointerup") {
            if (this.isDragging) {
                this.isDragging = false;
                node.setDirtyCanvas(true);
                return true;
            }
        }

        return false;
    }

    /**
     * Show an inline text input at the mouse click position.
     * Uses the pointer event's screen coordinates directly — no canvas transform math needed.
     */
    _showInlineEdit(node, hitArea, currentValue, placeholder, onCommit, options) {
        // Position the input over the hit area using canvas transform
        const canvasEl = document.getElementById("graph-canvas")
            || document.querySelector("canvas.lgraphcanvas")
            || document.querySelector("canvas");
        if (!canvasEl) return;

        const rect = canvasEl.getBoundingClientRect();
        const gc = (typeof LGraphCanvas !== 'undefined' && LGraphCanvas.active_canvas)
            ? LGraphCanvas.active_canvas
            : (typeof app !== 'undefined' ? app.canvas : null);

        // Use the precise number start position if available (measured during draw)
        const numX = hitArea.numX || hitArea.x;
        const numW = hitArea.numW || hitArea.width;

        let screenX, screenY, screenW;
        if (gc && gc.ds) {
            const scale = gc.ds.scale || 1;
            const offsetX = gc.ds.offset?.[0] || 0;
            const offsetY = gc.ds.offset?.[1] || 0;
            screenX = (node.pos[0] + numX + offsetX) * scale + rect.left;
            screenY = (node.pos[1] + hitArea.y + offsetY) * scale + rect.top;
            screenW = numW * scale;
        } else {
            screenX = rect.left + rect.width / 2 - 40;
            screenY = rect.top + rect.height / 2;
            screenW = 80;
        }

        const input = document.createElement("input");
        input.type = "text";
        input.value = currentValue;
        input.placeholder = placeholder;
        const scale = gc?.ds?.scale || 1;
        const opts = options || {};
        const baseFontSize = opts.fontSize || 12;
        const scaledFont = Math.max(Math.round(baseFontSize * scale), 8);
        const scaledHeight = Math.max(Math.round((baseFontSize + 6) * scale), 12);

        input.style.cssText = `
            position: fixed;
            left: ${screenX}px;
            top: ${screenY}px;
            width: ${Math.max(screenW * (opts.widthScale || 1) + 4 * scale, opts.minWidth || 45)}px;
            height: ${scaledHeight}px;
            font: ${scaledFont}px sans-serif;
            padding: 0 4px;
            border: 1px solid #4a7a9a;
            border-radius: 3px;
            background: #1a1a2e;
            color: #fff;
            outline: none;
            z-index: 10000;
            box-sizing: border-box;
        `;

        let done = false;
        const cleanup = () => {
            if (done) return;
            done = true;
            canvasEl.removeEventListener("wheel", onWheel);
            if (input.parentNode) input.parentNode.removeChild(input);
        };
        const commit = () => {
            if (done) return;
            onCommit(input.value);
            cleanup();
        };

        // Close on zoom/pan — input position would be wrong after zoom
        const onWheel = () => { cleanup(); };
        canvasEl.addEventListener("wheel", onWheel);

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { commit(); e.preventDefault(); e.stopPropagation(); }
            else if (e.key === "Escape") { cleanup(); e.preventDefault(); e.stopPropagation(); }
        });
        input.addEventListener("blur", commit);

        document.body.appendChild(input);
        requestAnimationFrame(() => { input.focus(); input.select(); });
    }

    serializeValue(node, index) {
        // The native widgets are the source of truth — this widget just visualizes them
        // Return undefined so this widget doesn't add duplicate data to the workflow
        return undefined;
    }
}

export { SpectralBlend2DWidget, CUTOFF_MIN, CUTOFF_MAX };
