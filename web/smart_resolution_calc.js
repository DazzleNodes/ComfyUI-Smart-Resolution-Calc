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

// Widget validation schemas - defines valid values and defaults
const WIDGET_SCHEMAS = {
    output_image_mode: {
        validValues: ["auto", "empty", "transform (distort)", "transform (crop/pad)",
                     "transform (scale/crop)", "transform (scale/pad)"],
        default: "auto",
        description: "Image output mode"
    },
    fill_type: {
        validValues: ["black", "white", "custom_color", "noise", "random"],
        default: "black",
        description: "Fill type for image transformations"
    },
    fill_color: {
        default: "#522525",
        validator: (v) => /^#?[0-9A-Fa-f]{6}$/.test(v),
        description: "Custom fill color (hex format)"
    },
    batch_size: {
        default: 1,
        validator: (v) => typeof v === 'number' && !isNaN(v) && v >= 1 && Number.isInteger(v),
        description: "Batch size (positive integer)"
    },
    scale: {
        default: 1,
        validator: (v) => typeof v === 'number' && !isNaN(v) && v > 0,
        description: "Scale factor (positive number)"
    },
    divisible_by: {
        validValues: ["8", "16", "32", "64"],
        default: "16",
        description: "Dimension divisibility constraint"
    },
    custom_ratio: {
        default: false,
        validator: (v) => typeof v === 'boolean',
        description: "Whether to use custom aspect ratio"
    },
    dimension_megapixel: {
        default: {on: false, value: 1},
        validator: (v) => {
            if (typeof v !== 'object' || v === null) return false;
            if (typeof v.on !== 'boolean') return false;
            if (typeof v.value !== 'number' || isNaN(v.value)) return false;
            return v.value >= 0.1 && v.value <= 100; // Reasonable megapixel range
        },
        description: "Dimension megapixel control (object with on/value)"
    },
    dimension_width: {
        default: {on: false, value: 1024},
        validator: (v) => {
            if (typeof v !== 'object' || v === null) return false;
            if (typeof v.on !== 'boolean') return false;
            if (typeof v.value !== 'number' || isNaN(v.value)) return false;
            return v.value >= 64 && v.value <= 16384; // Reasonable pixel range
        },
        description: "Dimension width control (object with on/value)"
    },
    dimension_height: {
        default: {on: false, value: 1024},
        validator: (v) => {
            if (typeof v !== 'object' || v === null) return false;
            if (typeof v.on !== 'boolean') return false;
            if (typeof v.value !== 'number' || isNaN(v.value)) return false;
            return v.value >= 64 && v.value <= 16384; // Reasonable pixel range
        },
        description: "Dimension height control (object with on/value)"
    }
};

/**
 * Validates a widget value against its schema
 *
 * @param {string} widgetName - Name of widget to validate
 * @param {*} value - Value to validate
 * @param {string} context - Context string for logging (e.g., "save" or "restore")
 * @returns {{valid: boolean, correctedValue: *, warnings: string[]}} Validation result
 */
function validateWidgetValue(widgetName, value, context = "unknown") {
    const schema = WIDGET_SCHEMAS[widgetName];
    const warnings = [];

    // No schema = no validation (allow value as-is)
    if (!schema) {
        return { valid: true, correctedValue: value, warnings };
    }

    // Check for object values (corruption pattern for widgets that should have primitives)
    // BUT: Some widgets (like DimensionWidgets) legitimately have object values
    const schemaExpectsObject = typeof schema.default === 'object' && schema.default !== null;

    if (typeof value === 'object' && value !== null && !schemaExpectsObject) {
        // Object value for a widget that should have primitive value = corruption
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} has object value (should be primitive)`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value type: ${typeof value}`);
        warnings.push(`   Value: ${JSON.stringify(value)}`);
        warnings.push(`   🔧 Self-healing: Using default value "${schema.default}"`);
        visibilityLogger.error(`[Validation-${context}] Object corruption in ${widgetName}:`, value);
        return { valid: false, correctedValue: schema.default, warnings };
    }

    // Check for index confusion (number when should be string)
    if (schema.validValues && typeof value === 'number') {
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} has numeric value (index confusion?)`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value: ${value} (type: ${typeof value})`);
        warnings.push(`   Expected type: string`);
        warnings.push(`   Valid values: [${schema.validValues.join(', ')}]`);

        // Attempt recovery: if value is valid index, use that array element
        if (value >= 0 && value < schema.validValues.length) {
            const corrected = schema.validValues[value];
            warnings.push(`   🔧 Self-healing: Interpreting ${value} as index → "${corrected}"`);
            visibilityLogger.error(`[Validation-${context}] Index confusion in ${widgetName}: ${value} → ${corrected}`);
            return { valid: false, correctedValue: corrected, warnings };
        } else {
            warnings.push(`   🔧 Self-healing: Index ${value} out of range, using default "${schema.default}"`);
            visibilityLogger.error(`[Validation-${context}] Invalid index in ${widgetName}: ${value}`);
            return { valid: false, correctedValue: schema.default, warnings };
        }
    }

    // Check if value in valid set (for enum-like widgets)
    if (schema.validValues && !schema.validValues.includes(value)) {
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} has invalid value`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value: "${value}"`);
        warnings.push(`   Valid values: [${schema.validValues.join(', ')}]`);
        warnings.push(`   🔧 Self-healing: Using default value "${schema.default}"`);
        visibilityLogger.error(`[Validation-${context}] Invalid value in ${widgetName}: "${value}"`);
        return { valid: false, correctedValue: schema.default, warnings };
    }

    // Check custom validator (for non-enum values like fill_color)
    if (schema.validator && !schema.validator(value)) {
        warnings.push(`⚠️ CORRUPTION DETECTED [${context}]: ${widgetName} failed validation`);
        warnings.push(`   Context: ${context}`);
        warnings.push(`   Value: "${value}"`);
        warnings.push(`   🔧 Self-healing: Using default value "${schema.default}"`);
        visibilityLogger.error(`[Validation-${context}] Validation failed for ${widgetName}: "${value}"`);
        return { valid: false, correctedValue: schema.default, warnings };
    }

    // Value is valid
    return { valid: true, correctedValue: value, warnings };
}

/**
 * Logs corruption diagnostics to console (visible to users and developers)
 *
 * @param {string[]} warnings - Array of warning messages
 * @param {object} context - Additional context for debugging
 */
function logCorruptionDiagnostics(warnings, context = {}) {
    if (warnings.length === 0) return;

    console.group('🚨 WIDGET CORRUPTION DETECTED - Smart Resolution Calculator');
    console.error('═'.repeat(80));
    warnings.forEach(msg => console.error(msg));

    if (Object.keys(context).length > 0) {
        console.error('');
        console.error('Additional Context:');
        Object.keys(context).forEach(key => {
            console.error(`   ${key}: ${JSON.stringify(context[key])}`);
        });
    }

    console.error('═'.repeat(80));
    console.error('Stack trace for debugging:');
    console.trace();
    console.error('═'.repeat(80));
    console.error('');
    console.error('💡 This self-healed automatically with default values.');
    console.error('💡 Please report this to the developer with the above information.');
    console.error('💡 GitHub: https://github.com/djdarcy/ComfyUI-Smart-Resolution-Calc/issues/8');
    console.groupEnd();
}

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

/**
 * Tooltip Manager - Singleton for tooltip rendering and state management
 *
 * Manages tooltip display on canvas with three-level help system:
 * - Quick (hover): Shows after hoverDelay (default 500ms)
 * - Full (extended hover): Shows after fullDelay (default 2s)
 * - Docs (click icon): Opens external documentation in browser
 *
 * Features:
 * - Canvas-based rendering with text wrapping
 * - Smart positioning (flips to avoid clipping)
 * - Configurable delays per tooltip
 * - Global show/hide toggle via localStorage
 */
class TooltipManager {
    constructor() {
        this.activeTooltip = null;
        this.hoverStartTime = null;
        this.quickShown = false;
        this.fullShown = false;

        // Load config from localStorage
        this.config = this.loadConfig();
    }

    loadConfig() {
        try {
            const config = localStorage.getItem('smart-res-calc-tooltip-config');
            return config ? JSON.parse(config) : {
                showInfoIcons: true,
                defaultDelay: 250,    // Quick tooltip delay (ms) - snappier feel
                fullDelay: 1500,      // Full tooltip delay (ms) - faster access to full info
                advancedMode: false
            };
        } catch (e) {
            return { showInfoIcons: true, defaultDelay: 250, fullDelay: 1500 };
        }
    }

    saveConfig() {
        try {
            localStorage.setItem('smart-res-calc-tooltip-config', JSON.stringify(this.config));
            logger.debug('Saved tooltip config:', this.config);
        } catch (e) {
            logger.error('Failed to save tooltip config:', e);
        }
    }

    startHover(tooltipContent, iconBounds, canvasBounds, nodePos) {
        this.hoverStartTime = Date.now();

        // Convert icon bounds from node-local to canvas-global coordinates
        const globalBounds = nodePos ? {
            x: iconBounds.x + nodePos[0],
            y: iconBounds.y + nodePos[1],
            width: iconBounds.width,
            height: iconBounds.height
        } : iconBounds;

        // Store canvas-global bounds (will be converted to screen coords in graph-level draw)
        this.activeTooltip = {
            content: tooltipContent,
            bounds: globalBounds,
            position: null // Calculated at draw time with screen coords
        };
        this.quickShown = false;
        this.fullShown = false;
    }

    updateHover() {
        if (!this.activeTooltip) return;

        const elapsed = Date.now() - this.hoverStartTime;
        const delay = this.activeTooltip.content.hoverDelay || this.config.defaultDelay;

        if (!this.quickShown && elapsed >= delay) {
            this.quickShown = true;
        }

        if (!this.fullShown && elapsed >= this.config.fullDelay) {
            this.fullShown = true;
        }
    }

    endHover() {
        if (this.activeTooltip) {
        }
        this.activeTooltip = null;
        this.hoverStartTime = null;
        this.quickShown = false;
        this.fullShown = false;
    }

    calculateTooltipPosition(iconBounds, canvasBounds) {
        // Smart positioning: right of icon by default, flip left if clipping
        const tooltipWidth = 300;
        const tooltipHeight = 150; // Approximate, will be calculated during draw


        let x = iconBounds.x + iconBounds.width + 10; // 10px right of icon
        let y = iconBounds.y;

        // Check right edge clipping
        if (canvasBounds && x + tooltipWidth > canvasBounds.width) {
            x = iconBounds.x - tooltipWidth - 10; // Flip to left
        }

        // Check bottom edge clipping
        if (canvasBounds && y + tooltipHeight > canvasBounds.height) {
            y = Math.max(10, canvasBounds.height - tooltipHeight - 10);
        }


        return { x, y };
    }

    draw(ctx, canvasBounds) {
        if (!this.activeTooltip || !this.config.showInfoIcons) return;

        this.updateHover();

        const tooltip = this.activeTooltip;
        const pos = tooltip.position;

        // Determine which content to show
        let content = '';
        if (this.fullShown && tooltip.content.full) {
            content = tooltip.content.full;
        } else if (this.quickShown && tooltip.content.quick) {
            content = tooltip.content.quick;
        }

        if (!content) {
            return;
        }

        // Draw tooltip
        const padding = 12;
        const lineHeight = 16;
        const maxWidth = 280; // Reduced from 300 for better text wrapping with padding

        // Wrap text
        const lines = this.wrapText(ctx, content, maxWidth - padding * 2);
        const tooltipHeight = lines.length * lineHeight + padding * 2;

        ctx.save();

        // Background with border
        ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // Use roundRect if available, otherwise regular rect
        if (ctx.roundRect) {
            ctx.roundRect(pos.x, pos.y, maxWidth, tooltipHeight, 4);
        } else {
            ctx.rect(pos.x, pos.y, maxWidth, tooltipHeight);
        }
        ctx.fill();
        ctx.stroke();


        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            ctx.fillText(line, pos.x + padding, pos.y + padding + i * lineHeight);
        });

        // Doc link indicator (if full tooltip and has docsUrl)
        if (this.fullShown && tooltip.content.docsUrl) {
            const linkY = pos.y + tooltipHeight - padding - lineHeight;
            ctx.fillStyle = '#4CAF50';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('Click icon for full docs →', pos.x + padding, linkY);
        }

        ctx.restore();
    }

    drawAtScreenCoords(ctx, screenBounds, canvasBounds) {
        // Draw tooltip at graph level using screen coordinates
        // Called from app.canvas.onDrawForeground with identity transform

        if (!this.activeTooltip || !this.config.showInfoIcons) return;

        this.updateHover();

        const tooltip = this.activeTooltip;

        logger.verbose(`quickShown: ${this.quickShown}, fullShown: ${this.fullShown}`);

        // Determine which content to show
        let content = '';
        if (this.fullShown && tooltip.content.full) {
            content = tooltip.content.full;
        } else if (this.quickShown && tooltip.content.quick) {
            content = tooltip.content.quick;
        }

        if (!content) {
            return;
        }


        // Calculate tooltip position in screen space
        const tooltipWidth = 280;
        const tooltipHeight = 150; // Will be recalculated after text wrapping

        let x = screenBounds.x + screenBounds.width + 10; // 10px right of icon
        let y = screenBounds.y;

        // Check right edge clipping
        if (x + tooltipWidth > canvasBounds.width) {
            x = screenBounds.x - tooltipWidth - 10; // Flip to left
        }

        // Check bottom edge clipping
        if (y + tooltipHeight > canvasBounds.height) {
            y = Math.max(10, canvasBounds.height - tooltipHeight - 10);
        }


        // Draw tooltip
        const padding = 12;
        const lineHeight = 16;
        const maxWidth = 280;

        // Wrap text
        const lines = this.wrapText(ctx, content, maxWidth - padding * 2);

        // Calculate height - include extra line for doc link if showing full tooltip with docs
        const hasDocLink = this.fullShown && tooltip.content.docsUrl;
        const contentLines = lines.length + (hasDocLink ? 1 : 0);
        const actualTooltipHeight = contentLines * lineHeight + padding * 2;

        // Recheck bottom clipping with actual height
        if (y + actualTooltipHeight > canvasBounds.height) {
            y = Math.max(10, canvasBounds.height - actualTooltipHeight - 10);
        }


        ctx.save();

        // Background with border
        ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, maxWidth, actualTooltipHeight, 4);
        } else {
            ctx.rect(x, y, maxWidth, actualTooltipHeight);
        }
        ctx.fill();
        ctx.stroke();


        // Text
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            ctx.fillText(line, x + padding, y + padding + i * lineHeight);
        });

        // Doc link indicator (if full tooltip and has docsUrl)
        // Render on the line AFTER the last content line
        if (hasDocLink) {
            const linkY = y + padding + lines.length * lineHeight;
            ctx.fillStyle = '#4CAF50';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('Shift+Click label for full docs →', x + padding, linkY);
        }

        ctx.restore();
    }

    wrapText(ctx, text, maxWidth) {
        const lines = [];
        const paragraphs = text.split('\n');

        ctx.font = '12px sans-serif'; // Ensure font is set for measurement

        paragraphs.forEach(paragraph => {
            if (!paragraph.trim()) {
                lines.push('');
                return;
            }

            const words = paragraph.split(' ');
            let currentLine = '';

            words.forEach(word => {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            });

            if (currentLine) {
                lines.push(currentLine);
            }
        });

        return lines;
    }

    handleClick(tooltipContent) {
        if (tooltipContent.docsUrl) {
            window.open(tooltipContent.docsUrl, '_blank');
            logger.info('Opened docs:', tooltipContent.docsUrl);
        } else {
            logger.debug('No docs URL available for this tooltip');
        }
    }
}

/**
 * Info Icon - Label text tooltip trigger (no icon drawn)
 *
 * Uses label text as tooltip trigger area - no visual icon.
 * Hover over label shows tooltip, Shift+Click opens docs.
 * Integrates with TooltipManager for hover state and tooltip display.
 *
 * Usage:
 * - Add to widget: this.infoIcon = new InfoIcon(TOOLTIP_CONTENT.widget_name)
 * - Set hit area: this.infoIcon.setHitArea(labelX, labelY, labelWidth, labelHeight)
 * - Mouse: if (this.infoIcon.mouse(event, pos, canvasBounds, nodePos)) return true;
 *
 * Note: No visible icon is drawn - the label text itself is the interactive area.
 */
class InfoIcon {
    constructor(tooltipContent) {
        this.content = tooltipContent;
        this.hitArea = { x: 0, y: 0, width: 0, height: 0 };
        this.isHovering = false;
    }

    /**
     * Set the hit area for tooltip triggering (replaces icon drawing)
     * Call this after drawing the label text to set the interactive region.
     *
     * @param {number} x - Label text X position
     * @param {number} y - Label text Y position
     * @param {number} width - Label text width (from ctx.measureText())
     * @param {number} height - Label text height (typically line height or widget height)
     */
    setHitArea(x, y, width, height) {
        if (!tooltipManager.config.showInfoIcons) return;

        // Store label bounds as hit area
        this.hitArea = { x, y, width, height };

    }

    /**
     * Legacy draw method - now just calls setHitArea for backwards compatibility
     * @deprecated Use setHitArea() instead
     */
    draw(ctx, x, y, height, canvasBounds) {
        // Backwards compatibility - assume this is icon position, not label
        // Widget should call setHitArea() with actual label bounds instead
        this.setHitArea(x, y, 14, height);
    }

    mouse(event, pos, canvasBounds, nodePos) {
        if (!tooltipManager.config.showInfoIcons) return false;

        const inBounds = this.isInBounds(pos, this.hitArea);


        if (event.type === 'pointermove') {
            if (inBounds && !this.isHovering) {
                // Start hover (convert node-local to canvas-global coords)
                this.isHovering = true;
                tooltipManager.startHover(this.content, this.hitArea, canvasBounds, nodePos);
                return true;
            } else if (!inBounds && this.isHovering) {
                // End hover
                this.isHovering = false;
                tooltipManager.endHover();
                return false;
            }
        }

        if (event.type === 'pointerdown' && inBounds) {
            // Shift+Click to open docs (prevents conflicts with normal clicks)
            if (event.shiftKey) {
                tooltipManager.handleClick(this.content);
                return true;
            }
            // Regular click without shift - don't consume event (let widget handle it)
            return false;
        }

        return inBounds;
    }

    isInBounds(pos, bounds) {
        if (!bounds) return false;  // Guard against undefined bounds
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }
}

// Singleton instance
const tooltipManager = new TooltipManager();

/**
 * Add tooltip support to a native ComfyUI widget
 * Only wraps mouse() method - does NOT modify draw() to avoid breaking widget rendering
 *
 * @param {object} widget - Native ComfyUI widget (combo, text, etc.)
 * @param {object} tooltipContent - Tooltip content from TOOLTIP_CONTENT
 * @param {object} node - The LiteGraph node containing the widget
 */
function wrapWidgetWithTooltip(widget, tooltipContent, node) {
    // Create InfoIcon for this widget
    widget.infoIcon = new InfoIcon(tooltipContent);

    // Store original mouse method
    const originalMouse = widget.mouse;

    // Wrap mouse method to handle tooltip events
    widget.mouse = function(event, pos, node) {
        // Check tooltip first
        if (this.infoIcon) {
            const canvasBounds = { width: node.size[0], height: node.size[1] };
            const tooltipHandled = this.infoIcon.mouse(event, pos, canvasBounds, node.pos);
            if (tooltipHandled) {
                node.setDirtyCanvas(true);
                return true; // Tooltip handled the event
            }
        }

        // Call original mouse handler
        if (originalMouse) {
            return originalMouse.call(this, event, pos, node);
        }
        return false;
    };
}

/**
 * Shared utilities for image dimension extraction
 * Used by both CopyImageButton and ScaleWidget to avoid code duplication
 */
const ImageDimensionUtils = {
    /**
     * Extract file path from LoadImage node
     * Returns null if not a LoadImage node or path not found
     */
    getImageFilePath(sourceNode, maxDepth = 10) {
        if (!sourceNode) return null;

        // Generic traversal: Follow input connections until we find a node with image data
        // This works with ANY node type (LoadImage, custom loaders, reroutes, etc.)
        let currentNode = sourceNode;
        let depth = 0;
        const visitedNodes = new Set();

        while (depth < maxDepth) {
            // Prevent circular references
            if (visitedNodes.has(currentNode.id)) {
                logger.verbose('[ImageUtils] Circular reference detected in connection chain');
                return null;
            }
            visitedNodes.add(currentNode.id);

            // Check if this node has an image widget with a filename
            // This works for LoadImage and any other node that loads images from files
            const imageWidget = currentNode.widgets?.find(w => w.name === "image");
            if (imageWidget && imageWidget.value) {
                logger.verbose(`[ImageUtils] Found image source at node '${currentNode.title || currentNode.type}' with filename: ${imageWidget.value}`);
                return imageWidget.value;
            }

            // This node doesn't have the data we need - check if it has an input to traverse
            // This handles reroutes, custom passthrough nodes, etc.
            const firstInput = currentNode.inputs?.[0];
            if (firstInput && firstInput.link) {
                const linkInfo = currentNode.graph.links[firstInput.link];
                const upstreamNode = linkInfo ? currentNode.graph.getNodeById(linkInfo.origin_id) : null;
                if (upstreamNode) {
                    logger.verbose(`[ImageUtils] Node '${currentNode.title || currentNode.type}' has no image data, traversing to input (depth ${depth})`);
                    currentNode = upstreamNode;
                    depth++;
                    continue;
                }
            }

            // No image data and no input to traverse
            logger.verbose(`[ImageUtils] Node '${currentNode.title || currentNode.type}' has no image data and no input connection`);
            return null;
        }

        logger.verbose(`[ImageUtils] Max depth (${maxDepth}) exceeded in connection chain`);
        return null;
    },

    /**
     * Fetch dimensions from server endpoint
     * Returns {width, height, success} or null on failure
     */
    async fetchDimensionsFromServer(imagePath) {
        try {
            const response = await fetch('/smart-resolution/get-dimensions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ image_path: imagePath })
            });

            if (!response.ok) {
                logger.verbose(`Server responded with status: ${response.status}`);
                return null;
            }

            const data = await response.json();
            return data;
        } catch (e) {
            logger.verbose(`Server request failed: ${e}`);
            return null;
        }
    },

    /**
     * Parse dimensions from cached info output
     * Looks for patterns like "From Image (Exact: 1920×1080)" or "From Image (AR: 16:9)"
     * Returns {width, height, success: true} or null
     */
    parseDimensionsFromInfo(node) {
        // Get the info widget value (last execution output)
        const infoWidget = node.widgets?.find(w => w.name === "info");
        if (!infoWidget || !infoWidget.value) {
            logger.verbose("No info widget or value found for dimension parsing");
            return null;
        }

        const infoText = infoWidget.value;
        logger.verbose(`Parsing info text: ${infoText}`);

        // Pattern: "From Image (Exact: 1920×1080)" or "From Image (AR: 16:9)"
        // Extract the source dimensions
        const match = infoText.match(/From Image \((?:Exact|AR): (\d+)×(\d+)\)/);
        if (match) {
            return {
                width: parseInt(match[1]),
                height: parseInt(match[2]),
                success: true
            };
        }

        logger.verbose("No dimension pattern found in info text");
        return null;
    }
};

/**
 * Custom scale multiplier widget
 * Features:
 * - 1.0x visually centered (asymmetric: 30% for 0-1.0, 70% for 1.0-7.0)
 * - Variable steps (0.05 below 1.0, 0.1 above)
 * - Click numeric value to edit
 * - Muted appearance at 1.0 (neutral/inactive state)
 */
class ScaleWidget {
    constructor(name, defaultValue = 1.0) {
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
        this.infoIcon = new InfoIcon(TOOLTIP_CONTENT.scale);
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

/**
 * Compact dimension widget with inline toggle and number controls
 * Matches rgthree's Power Lora Loader aesthetic
 */
class DimensionWidget {
    constructor(name, defaultValue, isInteger = true, config = {}) {
        this.name = name;
        this.type = "custom";
        this.isInteger = isInteger;
        this.value = {
            on: false,
            value: defaultValue
        };

        // Behavior configuration
        // - Toggle Behavior: Controls when toggle can be enabled/disabled
        // - Value Behavior: Controls when values can be edited
        this.toggleBehavior = config.toggleBehavior ?? ToggleBehavior.SYMMETRIC;
        this.valueBehavior = config.valueBehavior ?? ValueBehavior.ALWAYS;

        // Mouse state
        this.mouseDowned = null;
        this.isMouseDownedAndOver = false;

        // Hit areas for mouse interaction (updated during draw)
        this.hitAreas = {
            toggle: { x: 0, y: 0, width: 0, height: 0 },
            valueDec: { x: 0, y: 0, width: 0, height: 0 },
            valueInc: { x: 0, y: 0, width: 0, height: 0 },
            valueEdit: { x: 0, y: 0, width: 0, height: 0 }
        };

        // Optional tooltip support (only used for MEGAPIXEL)
        this.infoIcon = config.tooltipContent ? new InfoIcon(config.tooltipContent) : null;
    }

    /**
     * Draw compact widget (rgthree-style)
     * Height: 24px (compact), Margins: 3px (tight)
     */
    draw(ctx, node, width, y, height) {
        const margin = 15;
        const innerMargin = 3;  // Reduced from 5px for tighter layout
        const midY = y + height / 2;

        ctx.save();

        // Draw background (rounded)
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, height - 2, 4);
        ctx.fill();

        let posX = margin + innerMargin;

        // Draw toggle switch (LEFT side)
        const toggleWidth = height * 1.5;
        this.drawToggle(ctx, posX, y, height, this.value.on);
        this.hitAreas.toggle = { x: posX, y: y, width: toggleWidth, height: height };
        posX += toggleWidth + innerMargin * 2;

        // Draw label with special handling for megapixel default state
        let labelColor = this.value.on ? "#ffffff" : "#888888";

        // If megapixel is disabled but acting as default (no other dimensions active), make it whiter
        if (!this.value.on && this.name === "dimension_megapixel") {
            const widthWidget = node.widgets.find(w => w.name === "dimension_width");
            const heightWidget = node.widgets.find(w => w.name === "dimension_height");
            const widthActive = widthWidget?.value?.on ?? false;
            const heightActive = heightWidget?.value?.on ?? false;

            // If no other dimensions are constraining, megapixel is the default
            if (!widthActive && !heightActive) {
                labelColor = "#dddddd";  // Whiter to indicate it's active as default
            }
        }

        ctx.fillStyle = labelColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "13px sans-serif";  // Slightly smaller for compact layout

        const labelText = this.name.replace("dimension_", "").replace("_", " ").toUpperCase();
        const labelTextWidth = ctx.measureText(labelText).width;
        ctx.fillText(labelText, posX, midY);

        // Set tooltip trigger area on label (if tooltip configured)
        if (this.infoIcon) {
            this.infoIcon.setHitArea(posX, y, labelTextWidth, height);
        }

        // Draw number controls (RIGHT side)
        const numberWidth = 110;  // Reduced from 120 for compact layout
        const numberX = width - margin - numberWidth - innerMargin;

        if (this.value.on) {
            this.drawNumberWidget(ctx, numberX, y, numberWidth, height, this.value.on);
        } else {
            // Draw grayed out value (still clickable to edit - symmetric behavior)
            ctx.fillStyle = "#555555";
            ctx.textAlign = "center";
            ctx.font = "12px monospace";
            const displayValue = this.isInteger ? String(Math.round(this.value.value)) : this.value.value.toFixed(1);
            ctx.fillText(displayValue, numberX + numberWidth / 2, midY);

            // Set hit area for value editing (symmetric behavior - always editable)
            this.hitAreas.valueEdit = { x: numberX, y: y, width: numberWidth, height: height };

            // Clear +/- button hit areas (buttons not shown when toggle OFF)
            this.hitAreas.valueDec = { x: 0, y: 0, width: 0, height: 0 };
            this.hitAreas.valueInc = { x: 0, y: 0, width: 0, height: 0 };
        }

        ctx.restore();
    }

    /**
     * Draw toggle switch (rgthree-style)
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
        ctx.fillStyle = state ? "#4CAF50" : "#888888";
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draw number input widget with +/- buttons (compact)
     */
    drawNumberWidget(ctx, x, y, width, height, isActive) {
        const buttonWidth = 18;  // Reduced from 20 for compact layout
        const midY = y + height / 2;

        ctx.save();

        // Value background
        ctx.fillStyle = isActive ? "#2a2a2a" : "#1a1a1a";
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
        ctx.fillText("−", x + buttonWidth / 2 + 2, midY);

        // Value display (clickable to edit)
        const valueX = x + buttonWidth + 4;
        const valueWidth = width - (buttonWidth + 4) * 2;
        this.hitAreas.valueEdit = { x: valueX, y: y, width: valueWidth, height: height };

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.font = "12px monospace";
        const displayValue = this.isInteger ? String(Math.round(this.value.value)) : this.value.value.toFixed(1);
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
     * Handle mouse events
     */
    mouse(event, pos, node) {
        const canvas = app.canvas;

        // Check info icon first (tooltip on label) if configured
        if (this.infoIcon) {
            const canvasBounds = { width: node.size[0], height: node.size[1] };
            if (this.infoIcon.mouse(event, pos, canvasBounds, node.pos)) {
                node.setDirtyCanvas(true);
                return true; // Tooltip handled the event
            }
        }

        if (event.type === "pointerdown") {
            this.mouseDowned = [...pos];
            this.isMouseDownedAndOver = true;

            // Check toggle click
            if (this.isInBounds(pos, this.hitAreas.toggle)) {
                const oldState = this.value.on;
                this.value.on = !this.value.on;
                logger.debug(`Toggle clicked: ${this.name} - ${oldState} → ${this.value.on}`);

                // Invalidate dimension source cache when toggle changes
                node.dimensionSourceManager?.invalidateCache();
                node.updateModeWidget?.(); // Update MODE widget

                // Refresh image dimensions if image is connected and USE_IMAGE is enabled
                // This ensures fresh image data is loaded when dimension toggles change
                const imageWidget = node.widgets?.find(w => w.name === "image_mode");
                const imageConnected = imageWidget && !imageWidget.imageDisconnected;
                const useImageEnabled = imageWidget?.value?.on;

                if (imageConnected && useImageEnabled) {
                    const scaleWidget = node.widgets?.find(w => w instanceof ScaleWidget);
                    if (scaleWidget?.refreshImageDimensions) {
                        logger.info(`[${this.name}] Dimension toggle changed, refreshing image data`);
                        scaleWidget.refreshImageDimensions(node);
                    }
                }

                node.setDirtyCanvas(true);
                return true;
            }

            // Value editing - check behavior mode
            // ALWAYS: Values editable regardless of toggle state (default)
            // CONDITIONAL: Values only editable when toggle ON
            const allowValueEdit = this.value.on ||
                                   (this.valueBehavior === ValueBehavior.ALWAYS);

            if (allowValueEdit) {
                // Decrement button
                if (this.isInBounds(pos, this.hitAreas.valueDec)) {
                    this.changeValue(-1, node);

                    // Invalidate dimension source cache when value changes
                    node.dimensionSourceManager?.invalidateCache();
                    node.updateModeWidget?.(); // Update MODE widget

                    node.setDirtyCanvas(true);
                    return true;
                }

                // Increment button
                if (this.isInBounds(pos, this.hitAreas.valueInc)) {
                    this.changeValue(1, node);

                    // Invalidate dimension source cache when value changes
                    node.dimensionSourceManager?.invalidateCache();
                    node.updateModeWidget?.(); // Update MODE widget

                    node.setDirtyCanvas(true);
                    return true;
                }

                // Value edit (prompt for new value)
                if (this.isInBounds(pos, this.hitAreas.valueEdit)) {
                    const currentValue = this.isInteger ? Math.round(this.value.value) : this.value.value;
                    canvas.prompt("Enter value", String(currentValue), (newValue) => {
                        const parsed = parseFloat(newValue);
                        if (!isNaN(parsed)) {
                            this.value.value = this.isInteger ? Math.round(parsed) : parsed;

                            // Invalidate dimension source cache when value changes
                            node.dimensionSourceManager?.invalidateCache();
                            node.updateModeWidget?.(); // Update MODE widget

                            node.setDirtyCanvas(true);
                        }
                    }, event);
                    return true;
                }
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
     * Change value by increment
     */
    changeValue(delta, node) {
        if (this.isInteger) {
            // Get divisible_by setting from node
            let increment = 8; // Default to 8 for divisibility-friendly increments
            if (node && node.widgets) {
                const divisibleWidget = node.widgets.find(w => w.name === "divisible_by");
                if (divisibleWidget) {
                    if (divisibleWidget.value === "Exact") {
                        increment = 1;
                    } else {
                        const divisor = parseInt(divisibleWidget.value);
                        if (!isNaN(divisor)) {
                            increment = divisor;
                        }
                    }
                }
            }
            // Integer: increment by divisible_by value
            this.value.value = Math.max(64, Math.round(this.value.value) + delta * increment);
        } else {
            // Float: increment by 0.1
            this.value.value = Math.max(0.1, Math.round((this.value.value + delta * 0.1) * 10) / 10);
        }
    }

    /**
     * Compute size for layout (compact height)
     */
    computeSize(width) {
        return [width, 24];  // Reduced from 30px for compact layout
    }

    /**
     * Serialize value for workflow JSON
     */
    serializeValue(node, index) {
        logger.debug(`serializeValue called: ${this.name} (index ${index}) =`, this.value);
        return this.value;
    }
}

// ===== Seed Widget Special Values (matching rgthree convention) =====
const SPECIAL_SEED_RANDOM = -1;
const SPECIAL_SEED_INCREMENT = -2;
const SPECIAL_SEED_DECREMENT = -3;
const SPECIAL_SEEDS = [SPECIAL_SEED_RANDOM, SPECIAL_SEED_INCREMENT, SPECIAL_SEED_DECREMENT];
const SEED_MAX = 1125899906842624;  // Match rgthree's max

/**
 * Seed Widget
 * Compact widget with toggle (LEFT), seed action buttons (CENTER-RIGHT), and value (RIGHT)
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
class SeedWidget {
    constructor(name, defaultValue = -1, config = {}) {
        this.name = name;
        this.type = "custom";
        this.value = {
            on: true,
            value: defaultValue
        };

        // Last seed tracking (for recall button)
        this.lastSeed = null;

        // Randomize mode: when true, each queue generates a new random seed.
        // Set by dice button, cleared by lock/recycle/manual entry.
        // The value gets updated to the actual seed on each queue (for workflow saving)
        // but resets to -1 before the NEXT queue to trigger a new random.
        this.randomizeMode = false;

        // Mouse state
        this.mouseDowned = null;
        this.isMouseDownedAndOver = false;

        // Tooltip support
        this.infoIcon = config.tooltipContent ? new InfoIcon(config.tooltipContent) : null;

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
        const margin = 15;
        const innerMargin = 3;
        const midY = y + height / 2;
        const isActive = this.value.on;

        ctx.save();

        // Draw background (rounded)
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(margin, y + 1, width - margin * 2, height - 2, 4);
        ctx.fill();

        let posX = margin + innerMargin;

        // Draw toggle switch (LEFT side)
        const toggleWidth = height * 1.5;
        this.drawToggle(ctx, posX, y, height, isActive);
        this.hitAreas.toggle = { x: posX, y: y, width: toggleWidth, height: height };
        posX += toggleWidth + innerMargin * 2;

        // Draw label
        ctx.fillStyle = isActive ? "#ffffff" : "#888888";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "13px sans-serif";
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
        this._drawIconButton(ctx, btnStartX, y, btnSize, height, "🎲", "btnRandomize",
            this.randomizeMode && isActive);

        // Button 2: New Fixed Random (lock)
        this._drawIconButton(ctx, btnStartX + btnSize + btnGap, y, btnSize, height, "🔒", "btnFixRandom", false);

        // Button 3: Recall Last Seed (recycle)
        const hasLastSeed = this.lastSeed != null;
        this._drawIconButton(ctx, btnStartX + (btnSize + btnGap) * 2, y, btnSize, height, "♻️", "btnRecallLast",
            false, !hasLastSeed);

        ctx.globalAlpha = 1.0;

        // Draw number controls (RIGHT side)
        if (isActive) {
            this.drawNumberWidget(ctx, numberX, y, numberWidth, height, true);
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
     * Draw toggle switch (same as DimensionWidget)
     */
    drawToggle(ctx, x, y, height, state) {
        const radius = height * 0.36;
        const bgWidth = height * 1.5;

        ctx.save();

        ctx.beginPath();
        ctx.roundRect(x + 4, y + 4, bgWidth - 8, height - 8, height * 0.5);
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fill();
        ctx.globalAlpha = 1.0;

        const circleX = state ? x + height : x + height * 0.5;
        ctx.beginPath();
        ctx.arc(circleX, y + height * 0.5, radius, 0, Math.PI * 2);
        ctx.fillStyle = state ? "#4CAF50" : "#888888";
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draw number input with +/- buttons (same pattern as DimensionWidget)
     */
    drawNumberWidget(ctx, x, y, width, height, isActive) {
        const buttonWidth = 18;
        const midY = y + height / 2;

        ctx.save();

        ctx.fillStyle = isActive ? "#2a2a2a" : "#1a1a1a";
        ctx.beginPath();
        ctx.roundRect(x, y + 2, width, height - 4, 3);
        ctx.fill();

        // Decrement [-]
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

        // Value display
        const valueX = x + buttonWidth + 4;
        const valueWidth = width - (buttonWidth + 4) * 2;
        this.hitAreas.valueEdit = { x: valueX, y: y, width: valueWidth, height: height };

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.font = "12px monospace";
        const displayValue = this._formatSeedValue(this.value.value);
        ctx.fillText(displayValue, valueX + valueWidth / 2, midY);

        // Increment [+]
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
     * Handle mouse events
     */
    mouse(event, pos, node) {
        // Check info icon first (tooltip on label)
        if (this.infoIcon) {
            const canvasBounds = { width: node.size[0], height: node.size[1] };
            if (this.infoIcon.mouse(event, pos, canvasBounds, node.pos)) {
                node.setDirtyCanvas(true);
                return true;
            }
        }

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
                this.randomizeMode = true;
                this.value.value = SPECIAL_SEED_RANDOM;
                logger.debug(`SeedWidget: Randomize Each Time (randomizeMode=true)`);
                node.setDirtyCanvas(true);
                return true;
            }

            // New Fixed Random button — clears random mode
            if (this.isInBounds(pos, this.hitAreas.btnFixRandom)) {
                this.randomizeMode = false;
                this.value.value = this.generateRandomSeed();
                logger.debug(`SeedWidget: New Fixed Random (value = ${this.value.value})`);
                node.setDirtyCanvas(true);
                return true;
            }

            // Recall Last Seed button — clears random mode, locks seed
            if (this.isInBounds(pos, this.hitAreas.btnRecallLast)) {
                if (this.lastSeed != null) {
                    this.randomizeMode = false;
                    this.value.value = this.lastSeed;
                    logger.debug(`SeedWidget: Recall Last Seed (value = ${this.lastSeed})`);
                    node.setDirtyCanvas(true);
                }
                return true;
            }

            // Value editing (always allowed, matching DimensionWidget ALWAYS behavior)
            // Decrement
            if (this.isInBounds(pos, this.hitAreas.valueDec)) {
                this.value.value = Math.round(this.value.value) - 1;
                node.setDirtyCanvas(true);
                return true;
            }

            // Increment
            if (this.isInBounds(pos, this.hitAreas.valueInc)) {
                this.value.value = Math.round(this.value.value) + 1;
                node.setDirtyCanvas(true);
                return true;
            }

            // Value edit (click to type)
            if (this.isInBounds(pos, this.hitAreas.valueEdit)) {
                const canvas = app.canvas;
                const currentValue = Math.round(this.value.value);
                canvas.prompt("Seed (-1=rnd, -2=inc, -3=dec)", String(currentValue), (newValue) => {
                    const parsed = parseInt(newValue);
                    if (!isNaN(parsed)) {
                        this.value.value = parsed;
                        node.setDirtyCanvas(true);
                    }
                }, event);
                return true;
            }
        }

        return false;
    }

    /**
     * Check if position is within bounds
     */
    isInBounds(pos, bounds) {
        if (!bounds) return false;
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

    /**
     * Compute size for layout
     */
    computeSize(width) {
        return [width, 24];
    }

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
    serializeValue(node, index) {
        if (this.value.on && (this.randomizeMode || SPECIAL_SEEDS.includes(this.value.value))) {
            // Resolve to actual seed and update value (so workflow JSON saves it)
            const resolved = this.resolveActualSeed();
            this.lastSeed = resolved;
            // Return a copy with the resolved value for this serialization
            const data = { on: true, value: resolved };
            logger.debug(`SeedWidget serializeValue: resolved to ${resolved}, randomizeMode=${this.randomizeMode}`);
            // If randomizeMode, the widget display stays at -1 for next queue
            // If not randomizeMode, update the widget value permanently
            if (!this.randomizeMode) {
                this.value.value = resolved;
            }
            return data;
        }
        if (this.value.value >= 0) {
            this.lastSeed = this.value.value;
        }
        logger.debug(`serializeValue called: ${this.name} (index ${index}) =`, this.value);
        return this.value;
    }
}

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
                const scaleWidget = new ScaleWidget("scale", 1.0);
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
