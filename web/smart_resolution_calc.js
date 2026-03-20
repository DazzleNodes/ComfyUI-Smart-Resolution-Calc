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

// Widget visibility utilities (draw override, not array splice)
import { hideWidget, showWidget } from './components/DazzleWidget.js';

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
    logCorruptionDiagnostics
} from './components/WidgetValidation.js';

import { ToggleBehavior, ValueBehavior } from './components/DazzleToggleWidget.js';

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

// Extracted components (Phase 7-10: Remaining widgets)
import { ModeStatusWidget } from './components/ModeStatusWidget.js';
import { ImageModeWidget } from './components/ImageModeWidget.js';
import { ColorPickerButton } from './components/ColorPickerButton.js';
import { CopyImageButton } from './components/CopyImageButton.js';

// Extracted components (Phase 6: ScaleWidget + ImageDimensionUtils)
import { ScaleWidget } from './components/ScaleWidget.js';
import { ImageDimensionUtils } from './utils/ImageDimensionUtils.js';
import { applyDazzleSerialization } from './utils/serialization.js';

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
                    valueBehavior: ValueBehavior.CONDITIONAL,
                    tooltipContent: TOOLTIP_CONTENT.image_mode
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

                // Reposition image_purpose: move it right after seed widget
                // (visual order: fill_type → blend_strength → SEED → image_purpose → output_image_mode)
                const imagePurposeRef = this.widgets.find(w => w.name === "image_purpose");
                if (imagePurposeRef && seedWidget) {
                    const ipCurrentIdx = this.widgets.indexOf(imagePurposeRef);
                    if (ipCurrentIdx !== -1) {
                        this.widgets.splice(ipCurrentIdx, 1);
                    }
                    const seedIdx = this.widgets.indexOf(seedWidget);
                    this.widgets.splice(seedIdx + 1, 0, imagePurposeRef);
                    logger.debug(`Repositioned image_purpose after seed at index ${seedIdx + 1}`);
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
                    image_purpose: this.widgets.find(w => w.name === "image_purpose"),
                    image_mode: this.widgets.find(w => w.name === "image_mode"),
                    copy_from_image: this.widgets.find(w => w.name === "copy_from_image")
                };

                // image_purpose controls output_image_mode visibility
                const imagePurposeWidget = this.imageOutputWidgets.image_purpose;
                if (imagePurposeWidget) {
                    const origCallback = imagePurposeWidget.callback;
                    const outputImageModeWidget = this.imageOutputWidgets.output_image_mode;
                    imagePurposeWidget.callback = function(value) {
                        if (origCallback) origCallback.call(this, value);
                        // output_image_mode only relevant when image_purpose uses transforms
                        const showTransformOptions = ["img2img", "img2noise", "image + noise", "img2img + img2noise"].includes(value);
                        if (outputImageModeWidget) {
                            if (showTransformOptions) {
                                showWidget(outputImageModeWidget);
                            } else {
                                hideWidget(outputImageModeWidget);
                            }
                        }
                    };
                }

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

                    // Force canvas update to ensure widget becomes interactive immediately
                    this.setDirtyCanvas(true, true);

                    // Also trigger a size recalculation to ensure proper layout
                    this.setSize(this.computeSize());
                }

                // ===== Widget Visibility System (v0.9.3 — draw override, no splice) =====
                // Widgets stay in the array at all times. Hidden widgets have draw/computeSize/mouse
                // overridden to no-ops. This eliminates index drift, state corruption, and type mutation.
                // See: 2025-11-11__10-47-00__canvas-corruption-fix-learnings.md

                // Function to update widget visibility based on image input connection
                this.updateImageOutputVisibility = function() {
                    visibilityLogger.debug('=== updateImageOutputVisibility called ===');

                    // Check if image INPUT has a connection
                    const imageInput = this.inputs ? this.inputs.find(inp => inp.name === "image") : null;
                    const hasConnection = imageInput && imageInput.link != null;
                    visibilityLogger.debug(`Image input connected: ${hasConnection}`);

                    // Update ImageModeWidget's imageDisconnected property
                    // This property controls the asymmetric toggle behavior
                    const imageModeWidget = this.imageOutputWidgets.image_mode;
                    if (imageModeWidget) {
                        imageModeWidget.imageDisconnected = !hasConnection;
                    }

                    // Show/hide widgets based on connection status
                    if (hasConnection) {
                        // Show all image-related widgets
                        Object.keys(this.imageOutputWidgets).forEach(key => {
                            const widget = this.imageOutputWidgets[key];
                            if (widget) {
                                showWidget(widget);
                                visibilityLogger.debug(`Showing widget: ${key}`);
                            }
                        });

                        // After showing widgets, refresh image dimensions
                        // CRITICAL: Must happen AFTER image_mode widget is visible, otherwise
                        // refreshImageDimensions can't find the widget and returns early
                        // See: 2025-11-11__20-09-38__full-postmortem_reconnect-timing-root-cause.md
                        if (this.scaleWidgetInstance && this.scaleWidgetInstance.refreshImageDimensions) {
                            logger.info('[Visibility] Widgets shown, triggering dimension refresh');
                            this.scaleWidgetInstance.refreshImageDimensions(this);
                        }
                    } else {
                        // Hide all image-related widgets
                        Object.keys(this.imageOutputWidgets).forEach(key => {
                            const widget = this.imageOutputWidgets[key];
                            if (widget) {
                                hideWidget(widget);
                                visibilityLogger.debug(`Hiding widget: ${key}`);
                            }
                        });

                        // Update Mode(AR) for disconnect
                        // NOTE: For RECONNECT, updateModeWidget() is called in refreshImageDimensions()
                        // after imageDimensionsCache is populated (timing fix).
                        // See: 2025-11-11__20-09-38__full-postmortem_reconnect-timing-root-cause.md
                        if (this.updateModeWidget) {
                            this.updateModeWidget(true);  // Force refresh to bypass cache
                        }
                    }

                    // Resize node to accommodate shown/hidden widgets
                    const currentSize = this.size || this.computeSize();
                    const newSize = this.computeSize();
                    this.setSize([currentSize[0], newSize[1]]);
                };

                // Initially hide widgets - delay until outputs are ready
                setTimeout(() => {
                    this.updateImageOutputVisibility();
                }, 100);

                // Monitor connection changes — single event handler + 50ms one-shot delay.
                // The delay handles the LiteGraph timing issue where link objects aren't
                // yet in graph.links when the event fires (VHS uses the same pattern).
                // Previous implementation had 3 redundant mechanisms (onConnectionsChange,
                // onConnectionsRemove, 500ms polling). Simplified to 1.
                const originalOnConnectionsChange = this.onConnectionsChange;
                this.onConnectionsChange = function(type, index, connected, link_info) {
                    if (originalOnConnectionsChange) {
                        originalOnConnectionsChange.apply(this, arguments);
                    }

                    if (type === LiteGraph.INPUT && this.inputs && this.inputs[index]) {
                        const input = this.inputs[index];
                        if (input.name === "image") {
                            // 50ms delay for LiteGraph link graph to settle
                            setTimeout(() => this.updateImageOutputVisibility(), 50);
                        }
                    }
                };

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

            // Name-based serialization (reusable library function)
            // Scale widget step config is SmartResCalc-specific, passed via hooks
            applyDazzleSerialization(nodeType, {
                onSerialize: (data, node) => {
                    // Store scale widget step configuration
                    const scaleWidget = node.widgets ? node.widgets.find(w => w instanceof ScaleWidget) : null;
                    if (scaleWidget) {
                        if (!data.widgets_config) data.widgets_config = {};
                        data.widgets_config.scale = {
                            leftStep: scaleWidget.leftStep,
                            rightStep: scaleWidget.rightStep
                        };
                    }
                },
                onConfigure: (info, node) => {
                    // Restore scale widget step configuration
                    if (info.widgets_config && info.widgets_config.scale) {
                        const scaleWidget = node.widgets.find(w => w instanceof ScaleWidget);
                        if (scaleWidget) {
                            scaleWidget.leftStep = info.widgets_config.scale.leftStep || 0.05;
                            scaleWidget.rightStep = info.widgets_config.scale.rightStep || 0.1;
                        }
                    }

                    // Sync output_image_mode visibility with restored image_purpose value
                    const ipWidget = node.widgets?.find(w => w.name === "image_purpose");
                    if (ipWidget?.callback) {
                        ipWidget.callback(ipWidget.value);
                    }
                }
            });

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
        logger.verbose('setup() called');

        // ===== SEED PROMPT INTERCEPTION =====
        // Intercept prompt data right before it's sent to the server.
        // This is the ONLY place where seed resolution happens — serializeValue
        // is a simple passthrough. This pattern follows rgthree's approach:
        // resolve seeds, patch prompt data, update lastSeed — all in one place,
        // only during actual queue operations (not auto-save/serialize).
        const originalQueuePrompt = app.api.queuePrompt.bind(app.api);
        app.api.queuePrompt = async function(index, prompt, ...args) {
            // Find all SmartResolutionCalc nodes and resolve their seeds
            const nodes = app.graph._nodes || [];
            for (const node of nodes) {
                if (node.comfyClass !== 'SmartResolutionCalc') continue;

                const seedWidget = node.widgets?.find(w => w.name === 'fill_seed');
                if (!seedWidget) continue;

                // Only resolve if seed is ON and has a special value
                if (!seedWidget.value?.on) continue;
                const seedValue = seedWidget.value?.value;
                if (!SPECIAL_SEEDS.includes(seedValue)) {
                    // Fixed seed — just track it as lastSeed
                    seedWidget.lastSeed = seedValue;
                    continue;
                }

                // Resolve the special seed value
                const resolvedSeed = seedWidget.resolveActualSeed();
                seedWidget.lastSeed = resolvedSeed;
                logger.debug(`[Seed Intercept] Node ${node.id}: resolved ${seedValue} -> ${resolvedSeed}`);

                // Patch the prompt data (what gets sent to Python)
                const nodePrompt = prompt?.output?.[String(node.id)];
                if (nodePrompt?.inputs?.fill_seed) {
                    nodePrompt.inputs.fill_seed = { on: true, value: resolvedSeed };
                }

                // Patch the workflow data (what gets saved in image metadata)
                const workflowNode = prompt?.workflow?.nodes?.find(n => n.id === node.id);
                if (workflowNode) {
                    // Patch index-based widgets_values
                    if (workflowNode.widgets_values) {
                        for (let i = 0; i < workflowNode.widgets_values.length; i++) {
                            const wv = workflowNode.widgets_values[i];
                            if (wv && typeof wv === 'object' && 'on' in wv && wv.value === seedValue) {
                                workflowNode.widgets_values[i] = { on: true, value: resolvedSeed };
                                break;
                            }
                        }
                    }
                    // Patch name-based widgets_values_by_name (used by our configure restore)
                    if (workflowNode.widgets_values_by_name && workflowNode.widgets_values_by_name.fill_seed) {
                        workflowNode.widgets_values_by_name.fill_seed = { on: true, value: resolvedSeed };
                    }
                }

                // Redraw to show updated state
                node.setDirtyCanvas(true);
            }

            // Call the original queuePrompt
            return originalQueuePrompt(index, prompt, ...args);
        };
        logger.verbose('Installed seed prompt interception hook on app.api.queuePrompt');

        logger.verbose('setup() - hooking app.canvas.onDrawForeground');

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
