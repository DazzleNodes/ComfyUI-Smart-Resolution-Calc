/**
 * ScaleWidget -- custom scale multiplier slider with asymmetric layout
 *
 * Extracted from smart_resolution_calc.js (Phase 6 refactor).
 * Lines 234-1376 of the original file.
 *
 * Features:
 * - 1.0x visually centered (asymmetric: 30% for 0-1.0, 70% for 1.0-7.0)
 * - Variable steps (0.05 below 1.0, 0.1 above)
 * - Click numeric value to edit
 * - Muted appearance at 1.0 (neutral/inactive state)
 * - Image dimension cache for tooltip preview
 * - Settings panel for step size configuration
 *
 * Dependencies:
 * - InfoIcon from TooltipSystem.js
 * - DimensionSourceManager from dimension_source_manager.js
 * - logger, dimensionLogger from debug_logger.js
 * - app (ComfyUI global) -- accessed at runtime, not imported
 */

import { InfoIcon } from './TooltipSystem.js';
import { DimensionSourceManager } from '../managers/dimension_source_manager.js';
import { logger, dimensionLogger } from '../utils/debug_logger.js';
import { ImageDimensionUtils } from '../utils/ImageDimensionUtils.js';

class ScaleWidget {
    constructor(name, defaultValue = 1.0, config = {}) {
        this.name = name;
        this.type = "custom";
        this.value = defaultValue;
        this.min = 0.0;
        this.max = 7.0;

        // Visual layout: 0-1.0 takes 30% of slider, 1.0-7.0 takes 70%
        this.centerPoint = 1.0;
        this.leftPortion = 0.3;  // 30% for 0-1.0
        this.rightPortion = 0.7; // 70% for 1.0-7.0

        // Configurable step sizes
        this.leftStep = 0.05;   // Step size below 1.0x
        this.rightStep = 0.1;   // Step size at/above 1.0x
        this.showingSettings = false;

        // Mouse state
        this.mouseDowned = null;
        this.isDragging = false;
        this.isHovering = false;
        this.tooltipTimeout = null;

        // Double-click detection for reset to 1.0x
        this.lastClickTime = 0;
        this.doubleClickThreshold = 300; // milliseconds

        // Hit areas
        this.hitAreas = {
            slider: { x: 0, y: 0, width: 0, height: 0 },
            handle: { x: 0, y: 0, width: 0, height: 0 },
            valueEdit: { x: 0, y: 0, width: 0, height: 0 },
            settingsIcon: { x: 0, y: 0, width: 0, height: 0 },
            leftStepValue: { x: 0, y: 0, width: 0, height: 0 },
            leftStepDown: { x: 0, y: 0, width: 0, height: 0 },
            leftStepUp: { x: 0, y: 0, width: 0, height: 0 },
            rightStepValue: { x: 0, y: 0, width: 0, height: 0 },
            rightStepDown: { x: 0, y: 0, width: 0, height: 0 },
            rightStepUp: { x: 0, y: 0, width: 0, height: 0 }
        };

        // Image dimension cache for tooltip preview
        // Stores actual image dimensions when USE_IMAGE is enabled
        this.imageDimensionsCache = null;  // {width, height, timestamp, path}
        this.fetchingDimensions = false;   // Prevent concurrent fetches

        // Tooltip support - label-based tooltip trigger
        this.infoIcon = config.tooltipContent ? new InfoIcon(config.tooltipContent) : null;
    }

    /**
     * Get step size based on current value
     */
    getStepSize(value) {
        return value < 1.0 ? this.leftStep : this.rightStep;
    }

    /**
     * Convert value to slider position (asymmetric mapping)
     */
    valueToPosition(value, sliderWidth) {
        if (value <= this.centerPoint) {
            // Left side: 0 to 1.0 maps to 0% to 30% of slider
            const ratio = value / this.centerPoint;
            return ratio * this.leftPortion * sliderWidth;
        } else {
            // Right side: 1.0 to 7.0 maps to 30% to 100% of slider
            const ratio = (value - this.centerPoint) / (this.max - this.centerPoint);
            return (this.leftPortion + ratio * this.rightPortion) * sliderWidth;
        }
    }

    /**
     * Convert slider position to value (asymmetric mapping)
     */
    positionToValue(position, sliderWidth) {
        const ratio = position / sliderWidth;

        if (ratio <= this.leftPortion) {
            // Left side: 0% to 30% maps to 0 to 1.0
            return (ratio / this.leftPortion) * this.centerPoint;
        } else {
            // Right side: 30% to 100% maps to 1.0 to 7.0
            return this.centerPoint + ((ratio - this.leftPortion) / this.rightPortion) * (this.max - this.centerPoint);
        }
    }

    /**
     * Calculate preview dimensions for tooltip
     * Uses DimensionSourceManager for centralized dimension calculation (calls Python API)
     */
    async calculatePreview(node) {
        // Get dimension source from manager (handles all 6 priority levels)
        if (!node.dimensionSourceManager) {
            logger.warn('[ScaleWidget] DimensionSourceManager not initialized');
            return null;
        }

        // Pass runtime context including image dimensions cache
        // TEMPORARILY DISABLED: Debug logging (testing canvas corruption)
        if (dimensionLogger.debugEnabled) {
            dimensionLogger.debug('[CACHE] imageDimensionsCache:', this.imageDimensionsCache);
            dimensionLogger.debug('[CACHE] Passing to manager:', {imageDimensionsCache: this.imageDimensionsCache});
        }
        const dimSource = await node.dimensionSourceManager.getActiveDimensionSource(false, {
            imageDimensionsCache: this.imageDimensionsCache
        });
        if (!dimSource) {
            logger.warn('[ScaleWidget] DimensionSourceManager returned null');
            return null;
        }

        const baseW = dimSource.baseW;
        const baseH = dimSource.baseH;

        // Check for pending state (null dimensions from generator nodes)
        // When pending, return null values for all calculated fields
        if (baseW === null || baseH === null) {
            // Get divisor for return object (still needed for tooltip display)
            const divisibleWidget = node.widgets.find(w => w.name === "divisible_by");
            const divisor = divisibleWidget?.value === "Exact" ? 1 : parseInt(divisibleWidget?.value || 16);

            return {
                baseW: null,
                baseH: null,
                baseMp: null,
                scaledW: null,
                scaledH: null,
                finalW: null,
                finalH: null,
                finalMp: null,
                divisor: divisor,
                aspectW: dimSource.ar.aspectW,  // Will be null for pending
                aspectH: dimSource.ar.aspectH,  // Will be null for pending
                mode: dimSource.mode,
                priority: dimSource.priority,
                description: dimSource.description,
                conflicts: dimSource.conflicts
            };
        }

        // Normal calculation path (dimensions available)
        const baseMp = (baseW * baseH) / 1_000_000;

        // Apply scale
        const scaledW = Math.round(baseW * this.value);
        const scaledH = Math.round(baseH * this.value);

        // Get divisor from node's divisible_by widget
        const divisibleWidget = node.widgets.find(w => w.name === "divisible_by");
        let divisor = 16;
        if (divisibleWidget && divisibleWidget.value) {
            divisor = divisibleWidget.value === "Exact" ? 1 : parseInt(divisibleWidget.value);
        }

        // Apply divisibility using banker's rounding (matches Python behavior)
        // Banker's rounding: round .5 to nearest even number
        // This ensures JavaScript tooltip matches Python execution output
        const bankersRound = (n) => {
            const rounded = Math.round(n);
            const diff = Math.abs(n - Math.floor(n) - 0.5);
            // If exactly .5, round to even
            if (diff < 1e-10) {
                return (rounded % 2 === 0) ? rounded : rounded - Math.sign(n);
            }
            return rounded;
        };

        const finalW = bankersRound(scaledW / divisor) * divisor;
        const finalH = bankersRound(scaledH / divisor) * divisor;
        const finalMp = (finalW * finalH) / 1_000_000;

        return {
            baseW, baseH, baseMp,
            scaledW, scaledH,
            finalW, finalH, finalMp,
            divisor,
            aspectW: dimSource.ar.aspectW,
            aspectH: dimSource.ar.aspectH,
            // Include dimension source metadata for enhanced tooltip
            mode: dimSource.mode,
            priority: dimSource.priority,
            description: dimSource.description,
            conflicts: dimSource.conflicts
        };
    }

    /**
     * Refresh image dimensions cache using hybrid B+C strategy
     * Called when image connected/disconnected or USE_IMAGE toggled
     */
    async refreshImageDimensions(node) {
        dimensionLogger.debug('[REFRESH] refreshImageDimensions called');

        // Check if USE_IMAGE is enabled
        const imageModeWidget = node.widgets?.find(w => w.name === "image_mode");
        dimensionLogger.verbose('[REFRESH] imageModeWidget:', imageModeWidget);
        dimensionLogger.verbose('[REFRESH] imageModeWidget.value.on:', imageModeWidget?.value?.on);

        if (!imageModeWidget?.value?.on) {
            this.imageDimensionsCache = null;
            dimensionLogger.debug('[REFRESH] USE_IMAGE disabled, clearing cache');
            // Still update Mode(AR) to clear any stale source warnings (image may have reconnected)
            await node.updateModeWidget(true);
            return;
        }

        // Get connected image node
        const imageInput = node.inputs?.find(inp => inp.name === "image");
        const link = imageInput?.link;

        if (!link) {
            this.imageDimensionsCache = null;
            dimensionLogger.debug('[REFRESH] No image connected, clearing cache');
            return;
        }

        // Get source node from link
        const linkInfo = node.graph.links[link];
        const sourceNode = linkInfo ? node.graph.getNodeById(linkInfo.origin_id) : null;

        if (!sourceNode) {
            this.imageDimensionsCache = null;
            dimensionLogger.debug('[REFRESH] Source node not found, clearing cache');
            return;
        }

        // Check cache validity (same image path)
        const filePath = ImageDimensionUtils.getImageFilePath(sourceNode);

        if (this.imageDimensionsCache?.path === filePath && filePath) {
            dimensionLogger.debug(`[REFRESH] Using cached dimensions for ${filePath}`);
            return; // Cache still valid
        }

        // Prevent concurrent fetches
        if (this.fetchingDimensions) {
            dimensionLogger.debug('[REFRESH] Already fetching, skipping');
            return;
        }

        // Fetch using hybrid strategy
        dimensionLogger.debug('[REFRESH] Starting dimension fetch');
        this.fetchingDimensions = true;
        try {
            // Tier 1: Server endpoint (immediate for LoadImage nodes)
            if (filePath) {
                // dimensionLogger.debug('[REFRESH] Tier 1: Attempting server endpoint for:', filePath);
                logger.debug(`[ScaleWidget] Attempting server endpoint for: ${filePath}`);
                const dims = await ImageDimensionUtils.fetchDimensionsFromServer(filePath);
                // dimensionLogger.verbose('[REFRESH] Server response:', dims);
                logger.debug(`[ScaleWidget] Server response:`, dims);
                if (dims?.success) {
                    this.imageDimensionsCache = {
                        width: dims.width,
                        height: dims.height,
                        timestamp: Date.now(),
                        path: filePath
                    };
                    // dimensionLogger.debug('[REFRESH] ✓ Cached from server:', dims.width, 'x', dims.height);
                    logger.info(`✓ Cached image dimensions from server: ${dims.width}×${dims.height}`);

                    // Invalidate dimension source cache when image dimensions change
                    node.dimensionSourceManager?.invalidateCache();
                    // Update MODE widget after dimensions loaded (forceRefresh=true to bypass cache)
                    // This ensures runtime_context.image_info is populated when Python calculates
                    node.updateModeWidget?.(true);

                    node.setDirtyCanvas(true, true);
                    return;
                }
                // dimensionLogger.debug('[REFRESH] Server endpoint failed or returned no data');
                logger.debug('[ScaleWidget] Server endpoint returned no data or failed');
            } else {
                // dimensionLogger.debug('[REFRESH] No file path (not a LoadImage node?)');
                logger.debug('[ScaleWidget] No file path found (not a LoadImage node?)');
            }

            // Tier 2: Info parsing (cached execution output)
            // dimensionLogger.debug('[REFRESH] Tier 2: Attempting info parsing');
            logger.verbose('Attempting info parsing for cached dimensions');
            const cachedDims = ImageDimensionUtils.parseDimensionsFromInfo(node);
            // dimensionLogger.verbose('[REFRESH] Info parsing result:', cachedDims);
            if (cachedDims) {
                this.imageDimensionsCache = {
                    width: cachedDims.width,
                    height: cachedDims.height,
                    timestamp: Date.now(),
                    path: filePath
                };
                // dimensionLogger.debug('[REFRESH] ✓ Cached from info:', cachedDims.width, 'x', cachedDims.height);
                logger.debug(`✓ Cached image dimensions from info: ${cachedDims.width}×${cachedDims.height}`);

                // Invalidate dimension source cache when image dimensions change
                node.dimensionSourceManager?.invalidateCache();
                // Update MODE widget after dimensions loaded (forceRefresh=true to bypass cache)
                // This ensures runtime_context.image_info is populated when Python calculates
                node.updateModeWidget?.(true);

                node.setDirtyCanvas(true, true);
                return;
            }
            // dimensionLogger.debug('[REFRESH] Info parsing found no dimensions');
            logger.verbose('Info parsing found no dimensions');

            // Tier 3: Clear cache (will fallback to widget values in calculatePreview)
            // dimensionLogger.debug('[REFRESH] Tier 3: No dimensions available, clearing cache');
            logger.verbose('No dimensions available from any source, clearing cache');
            this.imageDimensionsCache = null;

            // Update MODE widget to show pending state (for generator nodes like KSampler)
            // When USE_IMAGE is enabled but no dimensions available yet, Python returns pending modes
            // This triggers display of "IMG Exact Dims (?:?)" or "WIDTH & IMG AR Only (?:?)"
            // See: Scenario 1 implementation - pending data display
            node.updateModeWidget?.(true);
            logger.debug('Called updateModeWidget for pending state (no dimensions available)');

        } finally {
            this.fetchingDimensions = false;
            // dimensionLogger.verbose('[REFRESH] Fetch complete, fetchingDimensions = false');
        }
    }

    /**
     * Draw the scale widget
     */
    draw(ctx, node, width, y, height) {
        const margin = 15;
        const innerMargin = 3;
        const midY = y + height / 2;

        ctx.save();

        // Background
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, height - 2, 4);
        ctx.fill();

        let posX = margin + innerMargin;

        // Label
        const isNeutral = Math.abs(this.value - 1.0) < 0.001;
        ctx.fillStyle = isNeutral ? "#666666" : "#ffffff";  // Muted at 1.0
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "13px sans-serif";
        const labelText = "SCALE";
        const labelTextWidth = ctx.measureText(labelText).width;
        ctx.fillText(labelText, posX, midY);

        // Set tooltip trigger area on label text
        this.infoIcon.setHitArea(posX, y, labelTextWidth, height);

        // Slider and value display area
        const sliderStartX = posX + 60;
        const valueWidth = 60;
        const sliderWidth = width - margin * 2 - sliderStartX - valueWidth - innerMargin * 3;

        // Draw slider track
        const trackY = midY - 2;
        const trackHeight = 4;

        ctx.fillStyle = "#333333";
        ctx.beginPath();
        ctx.roundRect(sliderStartX, trackY, sliderWidth, trackHeight, 2);
        ctx.fill();

        // Draw center mark at 1.0
        const centerX = sliderStartX + this.leftPortion * sliderWidth;
        ctx.strokeStyle = "#555555";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, trackY - 2);
        ctx.lineTo(centerX, trackY + trackHeight + 2);
        ctx.stroke();

        this.hitAreas.slider = { x: sliderStartX, y: y, width: sliderWidth, height: height };

        // Draw filled portion (only if not at 1.0)
        if (!isNeutral) {
            const handlePos = this.valueToPosition(this.value, sliderWidth);
            const fillWidth = handlePos;

            ctx.fillStyle = this.value < 1.0 ? "#d4af37" : "#4CAF50";  // Gold for <1.0, green for >1.0
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            if (this.value < 1.0) {
                // Fill from handle to center
                ctx.roundRect(sliderStartX + fillWidth, trackY, centerX - (sliderStartX + fillWidth), trackHeight, 2);
            } else {
                // Fill from center to handle
                ctx.roundRect(centerX, trackY, fillWidth - (centerX - sliderStartX), trackHeight, 2);
            }
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // Draw handle
        const handlePos = this.valueToPosition(this.value, sliderWidth);
        const handleX = sliderStartX + handlePos;
        const handleRadius = 7;

        this.hitAreas.handle = {
            x: handleX - handleRadius,
            y: midY - handleRadius,
            width: handleRadius * 2,
            height: handleRadius * 2
        };

        ctx.beginPath();
        ctx.arc(handleX, midY, handleRadius, 0, Math.PI * 2);
        ctx.fillStyle = isNeutral ? "#666666" : (this.value < 1.0 ? "#d4af37" : "#4CAF50");
        ctx.fill();

        ctx.strokeStyle = "#1e1e1e";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw value display (clickable to edit)
        const valueX = sliderStartX + sliderWidth + innerMargin * 2;
        this.hitAreas.valueEdit = { x: valueX, y: y, width: valueWidth, height: height };

        ctx.fillStyle = isNeutral ? "#2a2a2a" : "#333333";
        ctx.beginPath();
        ctx.roundRect(valueX, y + 2, valueWidth, height - 4, 3);
        ctx.fill();

        ctx.fillStyle = isNeutral ? "#666666" : "#ffffff";
        ctx.textAlign = "center";
        ctx.font = "12px monospace";
        ctx.fillText(this.value.toFixed(2) + "x", valueX + valueWidth / 2, midY);

        // Draw tooltip when hovering or dragging (and not at 1.0)
        if ((this.isHovering || this.isDragging) && !isNeutral) {
            // Start async calculation if not already in progress
            if (!this.calculatingPreview) {
                this.calculatingPreview = true;
                this.calculatePreview(node).then(preview => {
                    this.cachedPreview = preview;
                    this.calculatingPreview = false;
                    // Trigger redraw to show tooltip
                    node.setDirtyCanvas(true, false);
                }).catch(err => {
                    logger.error('[ScaleWidget] Preview calculation failed:', err);
                    this.calculatingPreview = false;
                });
            }
            // Draw cached preview if available
            if (this.cachedPreview) {
                this.drawTooltip(ctx, y + height, width, this.cachedPreview);
            }
        } else {
            // Clear cache when not hovering
            this.cachedPreview = null;
        }

        // Draw settings gear icon at far right
        const gearSize = 14;
        const gearX = width - margin - gearSize - 4;
        const gearY = y + height / 2 - gearSize / 2;

        ctx.font = `${gearSize}px Arial`;
        ctx.fillStyle = this.showingSettings ? "#4CAF50" : "#666";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⚙", gearX + gearSize / 2, gearY + gearSize / 2);

        this.hitAreas.settingsIcon = {
            x: gearX, y: gearY,
            width: gearSize, height: gearSize
        };

        // Draw settings panel if open
        if (this.showingSettings) {
            this.drawSettingsPanel(ctx, y + height, width);
        }

        ctx.restore();
    }

    /**
     * Get simplified mode label for tooltip (shows sources, not values)
     * Uses activeSources array from DimensionSourceManager for accurate widget detection (Bug 2 fix)
     * @param {Object} dimSource - Complete dimension source object from DimensionSourceManager
     * @param {string} dimSource.mode - Mode identifier (e.g., "height_ar", "mp_width_explicit")
     * @param {string} dimSource.description - Full description text
     * @param {string[]} [dimSource.activeSources] - Array of enabled dimension widgets (e.g., ['WIDTH', 'MEGAPIXEL'])
     * @returns {string} Simplified label (e.g., "WIDTH & MEGAPIXEL")
     */
    /**
     * Calculate Greatest Common Divisor for ratio simplification
     */
    _gcd(a, b) {
        a = Math.abs(Math.round(a));
        b = Math.abs(Math.round(b));
        while (b !== 0) {
            const temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    /**
     * Calculate simplified aspect ratio from width and height
     */
    _getSimplifiedRatio(width, height) {
        if (!width || !height || width <= 0 || height <= 0) {
            return null;
        }

        const gcd = this._gcd(width, height);
        const ratioW = width / gcd;
        const ratioH = height / gcd;

        // If ratio doesn't simplify nicely (e.g., 1000:999), show full values if reasonable
        if (gcd === 1 && (ratioW > 100 || ratioH > 100)) {
            return `${width}:${height}`;
        }

        return `${ratioW}:${ratioH}`;
    }

    /**
     * Get AR ratio string - prefers exact AR from Python API over calculated
     */
    _getARRatio(dimSource) {
        // Check for pending state (explicit null values from Python)
        // Pending states have ar.source === 'image_pending' with null aspectW/aspectH
        if (dimSource.ar && dimSource.ar.source === 'image_pending') {
            return '?:?';  // User wants image AR but data not yet available
        }

        // Prefer exact AR from Python API (avoids rounding errors)
        if (dimSource.ar && dimSource.ar.aspectW && dimSource.ar.aspectH) {
            return `${dimSource.ar.aspectW}:${dimSource.ar.aspectH}`;
        }

        // Fallback: Calculate from baseW/baseH
        if (dimSource.baseW && dimSource.baseH) {
            return this._getSimplifiedRatio(dimSource.baseW, dimSource.baseH);
        }

        return null;
    }

    getSimplifiedModeLabel(dimSource) {
        const { mode, description, activeSources, baseW, baseH } = dimSource;

        // Check for special modes first
        if (mode === 'exact_dims' || mode === 'exact_dims_pending' || description.includes('Exact Dims') || description.includes('exact image')) {
            // Add AR ratio for exact dims (will be "?:?" for pending states)
            const ratio = this._getARRatio(dimSource);
            return ratio ? `IMG Exact Dims (${ratio})` : 'IMG Exact Dims';
        }

        // Check for AR Only mode (Priority 4) - includes pending state
        if (mode === 'ar_only' || mode === 'ar_only_pending') {
            // Extract dimension source from description
            const dimensionSource = description.split(' & ')[0]; // "HEIGHT", "WIDTH", "MEGAPIXEL", or "defaults"
            const ratio = this._getARRatio(dimSource);
            return ratio ? `${dimensionSource} & IMG AR Only (${ratio})` : `${dimensionSource} & IMG AR Only`;
        }

        // Use activeSources array if available (Bug 2 fix - avoids string parsing issues)
        if (activeSources && activeSources.length > 0) {
            const sources = [...activeSources];

            // Check for AR sources (fallback to string parsing for AR since not in activeSources)
            if (description.includes('custom_ratio') || description.includes('Custom')) {
                sources.push('custom_ratio');
            } else if (description.includes('image_ar') || description.includes('image AR') || description.includes('Image AR')) {
                sources.push('image_ar');
            } else if (description.includes('dropdown') || description.includes('Dropdown')) {
                sources.push('aspect_ratio');
            }

            // Check for defaults
            if (description.includes('Default') || description.includes('default')) {
                sources.push('defaults');
            }

            let label = sources.join(' & ');

            // ALWAYS add AR ratio using exact AR from Python when available
            const ratio = this._getARRatio(dimSource);
            if (ratio) {
                label = `${label} (${ratio})`;
            }

            return label;
        }

        // Fallback: Extract active sources from description (backward compatibility)
        const sources = [];

        // Check for dimension widgets (removed 'H computed' check - Bug 2 fix)
        if (description.includes('WIDTH') || description.includes('W:') || description.includes('W+')) {
            sources.push('WIDTH');
        }
        if (description.includes('HEIGHT') || description.includes('H:') || description.includes('H+')) {
            sources.push('HEIGHT');
        }
        if (description.includes('MP') || description.includes('megapixel')) {
            sources.push('MEGAPIXEL');
        }

        // Check for AR sources
        if (description.includes('custom_ratio') || description.includes('Custom')) {
            sources.push('custom_ratio');
        } else if (description.includes('image_ar') || description.includes('image AR') || description.includes('Image AR')) {
            sources.push('image_ar');
        } else if (description.includes('dropdown') || description.includes('Dropdown')) {
            sources.push('aspect_ratio');
        }

        // Check for defaults
        if (description.includes('Default') || description.includes('default')) {
            sources.push('defaults');
        }

        // Build label
        if (sources.length === 0) {
            return null; // No clear sources identified
        }

        let label = sources.join(' & ');

        // ALWAYS add AR ratio using exact AR from Python when available
        const ratio = this._getARRatio(dimSource);
        if (ratio) {
            label = `${label} (${ratio})`;
        }

        return label;
    }

    /**
     * Draw preview tooltip below the widget
     * Shows dimension source mode, calculations, and conflicts
     */
    drawTooltip(ctx, startY, width, preview) {
        const margin = 15;
        const padding = 8;
        const lineHeight = 16;

        ctx.save();

        // Format values for display, handling pending states (null values)
        const formatDim = (value) => (value === null || value === undefined) ? '?' : value;
        const formatMp = (value) => (value === null || value === undefined) ? '?' : value.toFixed(2);

        // Format aspect ratio for display
        const arDisplay = (preview.aspectW === null || preview.aspectH === null)
            ? '?:?'  // Pending state - awaiting image data
            : (preview.aspectW && preview.aspectH)
                ? `${preview.aspectW}:${preview.aspectH}`
                : 'unknown';

        // Build tooltip content
        const lines = [
            `Scale: ${this.value.toFixed(2)}x`,
            `━━━━━━━━━━━━━━━━━━━━━━━━`
        ];

        // Note: Mode line removed - now shown in dedicated mode_status widget above aspect_ratio

        // Add dimension calculations (handle pending states with ?)
        lines.push(`Base: ${formatDim(preview.baseW)} × ${formatDim(preview.baseH)} (${formatMp(preview.baseMp)} MP, ${arDisplay} AR)`);
        lines.push(`  ↓`);
        lines.push(`Scaled: ${formatDim(preview.scaledW)} × ${formatDim(preview.scaledH)}`);
        lines.push(`After Div/${preview.divisor}: ${formatDim(preview.finalW)} × ${formatDim(preview.finalH)} (${formatMp(preview.finalMp)} MP)`);

        // Measure text width BEFORE adding conflicts to determine max tooltip width
        ctx.font = "bold 11px monospace"; // Use bold for measurement (widest case)
        let maxTooltipWidth = 0;
        lines.forEach(line => {
            const textWidth = ctx.measureText(line).width;
            if (textWidth > maxTooltipWidth) {
                maxTooltipWidth = textWidth;
            }
        });

        // Add conflict warnings with proper word wrapping
        if (preview.conflicts && preview.conflicts.length > 0) {
            lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━`);
            lines.push(`⚠️  Conflicts detected:`);

            preview.conflicts.forEach(conflict => {
                const msg = conflict.message || conflict;
                const indent = '    '; // 4 spaces for indentation
                const maxLineWidth = 500; // Maximum width in pixels for wrapped lines

                // Measure and wrap based on actual pixel width, not character count
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

        // Calculate tooltip dimensions with dynamic width (allow tooltip to extend beyond node)
        const tooltipWidth = maxTooltipWidth + padding * 2;
        const tooltipHeight = lines.length * lineHeight + padding * 2;

        // Draw tooltip background
        ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
        ctx.beginPath();
        ctx.roundRect(margin, startY + 4, tooltipWidth, tooltipHeight, 4);
        ctx.fill();

        // Draw tooltip border (change to orange if conflicts present)
        ctx.strokeStyle = (preview.conflicts && preview.conflicts.length > 0) ? "#ff9800" : "#4CAF50";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw tooltip text
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = "11px monospace";

        lines.forEach((line, index) => {
            const textY = startY + 4 + padding + index * lineHeight;
            if (index === 0) {
                // Highlight scale value
                ctx.fillStyle = this.value < 1.0 ? "#d4af37" : "#4CAF50";
                ctx.font = "bold 11px monospace";
                ctx.fillText(line, margin + padding, textY);
                ctx.font = "11px monospace";
                ctx.fillStyle = "#ffffff";
            } else if (line.startsWith('━')) {
                // Separator line
                ctx.fillStyle = "#666666";
                ctx.fillText(line, margin + padding, textY);
                ctx.fillStyle = "#ffffff";
            } else if (line.startsWith('⚠️')) {
                // Conflict header - highlight in orange
                ctx.fillStyle = "#ff9800";
                ctx.font = "bold 11px monospace";
                ctx.fillText(line, margin + padding, textY);
                ctx.font = "11px monospace";
                ctx.fillStyle = "#ffffff";
            } else if (line.startsWith('  ') && preview.conflicts && preview.conflicts.length > 0) {
                // Conflict message - show in lighter orange
                ctx.fillStyle = "#ffb74d";
                ctx.fillText(line, margin + padding, textY);
                ctx.fillStyle = "#ffffff";
            } else {
                ctx.fillText(line, margin + padding, textY);
            }
        });

        ctx.restore();
    }

    /**
     * Draw settings configuration panel
     */
    drawSettingsPanel(ctx, startY, width) {
        const panelHeight = 65;
        const margin = 15;
        const padding = 6;

        ctx.save();

        // Panel background
        ctx.fillStyle = "rgba(30, 30, 30, 0.95)";
        ctx.beginPath();
        ctx.roundRect(margin, startY, width - margin * 2, panelHeight, 4);
        ctx.fill();

        // Border
        ctx.strokeStyle = "#4CAF50";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Title
        ctx.fillStyle = "#4CAF50";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("Scale Step Sizes", margin + padding, startY + padding);

        // Button dimensions
        const btnW = 18, btnH = 16;
        const btnGap = 2;

        // Calculate button positions from right edge
        const rightEdge = width - margin - padding;
        const plusX = rightEdge - btnW;
        const minusX = plusX - btnGap - btnW;

        // Left step control (row 1)
        const row1Y = startY + 28;
        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("Below 1.0x:", margin + padding, row1Y);

        // Value positioned to left of buttons (clickable)
        const valueX = minusX - 6;
        const valueWidth = 35;
        const valueHeight = 16;
        const leftValueX = valueX - valueWidth;
        const leftValueY = row1Y - valueHeight / 2 + 3;

        // Draw clickable background for left step value
        ctx.fillStyle = "rgba(80, 80, 80, 0.3)";
        ctx.beginPath();
        ctx.roundRect(leftValueX, leftValueY, valueWidth, valueHeight, 2);
        ctx.fill();

        // Draw left step value (centered in box)
        ctx.fillStyle = "#fff";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const leftBoxCenterY = leftValueY + valueHeight / 2;
        ctx.fillText(this.leftStep.toFixed(3), valueX, leftBoxCenterY);

        // Store hit area for left step value
        this.hitAreas.leftStepValue = { x: leftValueX, y: leftValueY, width: valueWidth, height: valueHeight };

        // +/- buttons for left step (right-aligned)
        this.drawButton(ctx, minusX, row1Y - 4, btnW, btnH, "-");
        this.hitAreas.leftStepDown = { x: minusX, y: row1Y - 4, width: btnW, height: btnH };

        this.drawButton(ctx, plusX, row1Y - 4, btnW, btnH, "+");
        this.hitAreas.leftStepUp = { x: plusX, y: row1Y - 4, width: btnW, height: btnH };

        // Right step control (row 2)
        const row2Y = startY + 48;

        // Reset font/style after buttons (drawButton changes these)
        ctx.fillStyle = "#fff";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("At/above 1.0x:", margin + padding, row2Y);

        // Value positioned to left of buttons (clickable)
        const rightValueX = valueX - valueWidth;
        const rightValueY = row2Y - valueHeight / 2 + 3;

        // Draw clickable background for right step value
        ctx.fillStyle = "rgba(80, 80, 80, 0.3)";
        ctx.beginPath();
        ctx.roundRect(rightValueX, rightValueY, valueWidth, valueHeight, 2);
        ctx.fill();

        // Draw right step value (centered in box)
        ctx.fillStyle = "#fff";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const rightBoxCenterY = rightValueY + valueHeight / 2;
        ctx.fillText(this.rightStep.toFixed(3), valueX, rightBoxCenterY);

        // Store hit area for right step value
        this.hitAreas.rightStepValue = { x: rightValueX, y: rightValueY, width: valueWidth, height: valueHeight };

        // +/- buttons for right step (right-aligned)
        this.drawButton(ctx, minusX, row2Y - 4, btnW, btnH, "-");
        this.hitAreas.rightStepDown = { x: minusX, y: row2Y - 4, width: btnW, height: btnH };

        this.drawButton(ctx, plusX, row2Y - 4, btnW, btnH, "+");
        this.hitAreas.rightStepUp = { x: plusX, y: row2Y - 4, width: btnW, height: btnH };

        ctx.restore();
    }

    /**
     * Draw a button
     */
    drawButton(ctx, x, y, w, h, label) {
        ctx.fillStyle = "#555";
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 2);
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + w / 2, y + h / 2);
    }

    /**
     * Handle mouse events
     */
    mouse(event, pos, node) {
        const canvas = app.canvas;

        // Check info icon first (tooltip on label)
        const canvasBounds = { width: node.size[0], height: node.size[1] };
        if (this.infoIcon.mouse(event, pos, canvasBounds, node.pos)) {
            node.setDirtyCanvas(true);
            return true; // Tooltip handled the event
        }

        if (event.type === "pointerdown") {
            this.mouseDowned = [...pos];

            // Settings icon clicked - toggle panel
            if (this.isInBounds(pos, this.hitAreas.settingsIcon)) {
                this.showingSettings = !this.showingSettings;

                // Preserve width, adjust height by panel size (65px)
                const currentSize = node.size || [200, 24];
                const heightDelta = this.showingSettings ? 65 : -65;
                node.setSize([currentSize[0], currentSize[1] + heightDelta]);

                node.setDirtyCanvas(true);
                return true;
            }

            // Settings panel button clicks (when panel open)
            if (this.showingSettings) {
                if (this.isInBounds(pos, this.hitAreas.leftStepDown)) {
                    this.leftStep = Math.max(0.001, this.leftStep - 0.01);
                    node.setDirtyCanvas(true);
                    return true;
                }
                if (this.isInBounds(pos, this.hitAreas.leftStepUp)) {
                    this.leftStep = Math.min(1.0, this.leftStep + 0.01);
                    node.setDirtyCanvas(true);
                    return true;
                }
                if (this.isInBounds(pos, this.hitAreas.rightStepDown)) {
                    this.rightStep = Math.max(0.001, this.rightStep - 0.01);
                    node.setDirtyCanvas(true);
                    return true;
                }
                if (this.isInBounds(pos, this.hitAreas.rightStepUp)) {
                    this.rightStep = Math.min(10.0, this.rightStep + 0.01);
                    node.setDirtyCanvas(true);
                    return true;
                }

                // Check left step value edit click
                if (this.isInBounds(pos, this.hitAreas.leftStepValue)) {
                    canvas.prompt("Enter left step size (0.001 - 1.0)", String(this.leftStep.toFixed(3)), (newValue) => {
                        const parsed = parseFloat(newValue);
                        if (!isNaN(parsed) && parsed >= 0.001 && parsed <= 1.0) {
                            this.leftStep = parsed;
                            node.setDirtyCanvas(true);
                        }
                    }, event);
                    return true;
                }

                // Check right step value edit click
                if (this.isInBounds(pos, this.hitAreas.rightStepValue)) {
                    canvas.prompt("Enter right step size (0.001 - 10.0)", String(this.rightStep.toFixed(3)), (newValue) => {
                        const parsed = parseFloat(newValue);
                        if (!isNaN(parsed) && parsed >= 0.001 && parsed <= 10.0) {
                            this.rightStep = parsed;
                            node.setDirtyCanvas(true);
                        }
                    }, event);
                    return true;
                }
            }

            // Check value edit click
            if (this.isInBounds(pos, this.hitAreas.valueEdit)) {
                canvas.prompt("Enter scale value (0.0 - 10.0+)", String(this.value.toFixed(2)), (newValue) => {
                    const parsed = parseFloat(newValue);
                    if (!isNaN(parsed) && parsed >= 0.0) {
                        this.value = Math.max(0.0, parsed);
                        node.setDirtyCanvas(true);
                    }
                }, event);
                return true;
            }

            // Check slider/handle click
            if (this.isInBounds(pos, this.hitAreas.slider) || this.isInBounds(pos, this.hitAreas.handle)) {
                // Double-click detection - reset to 1.0x
                const currentTime = Date.now();
                const timeSinceLastClick = currentTime - this.lastClickTime;

                if (timeSinceLastClick < this.doubleClickThreshold) {
                    // Double-click detected - reset to 1.0x
                    this.value = 1.0;
                    this.lastClickTime = 0; // Reset to prevent triple-click
                    node.setDirtyCanvas(true);
                    logger.info(`[ScaleWidget] Double-click detected - reset to 1.0x`);
                    return true;
                } else {
                    // Single click - start dragging
                    this.lastClickTime = currentTime;
                    this.isDragging = true;
                    this.updateValueFromMouse(pos);
                    node.setDirtyCanvas(true);
                    return true;
                }
            }
        }

        if (event.type === "pointermove") {
            // Update hover state based on mouse position
            // Only show tooltip when hovering over the handle (green knob), not the entire slider track
            const wasHovering = this.isHovering;
            this.isHovering = this.isInBounds(pos, this.hitAreas.handle);

            // Handle dragging
            if (this.isDragging && this.mouseDowned) {
                this.updateValueFromMouse(pos);
                node.setDirtyCanvas(true);
                return true;
            }

            // Handle hover state changes
            if (wasHovering !== this.isHovering) {
                // Clear any existing timeout when hover state changes
                if (this.tooltipTimeout) {
                    clearTimeout(this.tooltipTimeout);
                    this.tooltipTimeout = null;
                }

                // If transitioning from hovering to not hovering, start timeout
                if (wasHovering && !this.isHovering) {
                    // Mouse left hover area - start 2-second timeout to hide tooltip
                    this.tooltipTimeout = setTimeout(() => {
                        this.isHovering = false;
                        node.setDirtyCanvas(true);
                    }, 2000);
                }

                node.setDirtyCanvas(true);
            } else if (this.isHovering) {
                // Mouse is hovering and moving - clear any pending timeout
                // This keeps tooltip visible as long as mouse is in hover area
                if (this.tooltipTimeout) {
                    clearTimeout(this.tooltipTimeout);
                    this.tooltipTimeout = null;
                }
            }
        }

        if (event.type === "pointerup") {
            this.isDragging = false;
            this.mouseDowned = null;
            // Clear any pending timeout - tooltip will stay visible while hovering
            // Only hide when mouse actually leaves hover area (handled by pointermove transition)
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
        }

        // Handle mouse leaving widget area - immediately hide tooltip
        if (event.type === "pointerleave" || event.type === "pointerout") {
            if (this.tooltipTimeout) {
                clearTimeout(this.tooltipTimeout);
                this.tooltipTimeout = null;
            }
            if (this.isHovering) {
                this.isHovering = false;
                node.setDirtyCanvas(true);
            }
        }

        return false;
    }

    /**
     * Update value from mouse position
     */
    updateValueFromMouse(pos) {
        const slider = this.hitAreas.slider;
        const relativeX = Math.max(0, Math.min(slider.width, pos[0] - slider.x));
        let newValue = this.positionToValue(relativeX, slider.width);

        // Snap to step
        const step = this.getStepSize(newValue);
        newValue = Math.round(newValue / step) * step;

        // Clamp to range
        this.value = Math.max(this.min, Math.min(this.max, newValue));
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
        // Base height: 24px slider
        // Settings panel: 65px when open
        return [width, this.showingSettings ? 89 : 24];
    }

    /**
     * Serialize value for workflow JSON
     * Returns ONLY the float value - this is what Python receives
     * Step configuration is stored separately in node.serialize()
     */
    serializeValue(node, index) {
        logger.debug(`serializeValue called: ${this.name} (index ${index}) = ${this.value}, steps: ${this.leftStep}/${this.rightStep}`);
        return this.value;  // Return float for Python, config stored elsewhere
    }
}

/**
 * Mode Status Widget - Read-only display showing current dimension calculation mode
 * Positioned above aspect_ratio to provide at-a-glance mode visibility
 *
 * Performance optimizations:
 * - Caches text truncation to avoid ctx.measureText() loops at 60fps
 * - Uses ctx.roundRect() when available for simpler drawing
 * - Only recalculates displayText when value changes
 */

export { ScaleWidget };
