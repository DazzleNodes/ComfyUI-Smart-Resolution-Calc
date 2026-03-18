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

// Extracted components (Phase 7-10: Remaining widgets)
import { ModeStatusWidget } from './components/ModeStatusWidget.js';
import { ImageModeWidget } from './components/ImageModeWidget.js';
import { ColorPickerButton } from './components/ColorPickerButton.js';
import { CopyImageButton } from './components/CopyImageButton.js';

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
