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
import { SpectralBlend2DWidget } from './components/SpectralBlend2DWidget.js';
import { seedsFromPromptText, applyImageSeed, pickMetadataReader, promptTextFromMeta } from './utils/prompt_seed.js';

// ===== IMAGE DRAG-IN: SEEDS FROM THE PROMPT BLOCK (#58) =====
// When a workflow is loaded FROM AN IMAGE (drag-drop or File > Open, both via
// app.handleFile), the image's API prompt block records the fill_seed Python
// actually received, while the workflow block's dazzle_last_seed on images
// made with v0.12.2 is the PREVIOUS run's seed. The handleFile wrapper (in
// setup()) reads the prompt block BEFORE delegating and parks the seeds here;
// each node's configure hook then applies its own entry, which is the exact
// moment the node exists and comes after the property hydration, so the
// prompt wins by ordering rather than by polling (loadGraphData's promise
// settles before the recreated nodes appear).
const PENDING_IMAGE_SEEDS_TTL_MS = 10000;
let pendingImageSeeds = null;   // { seeds: Map<string, number>, at: number, name: string } | null

/**
 * Read the SmartResCalc seeds from an image file's embedded prompt block,
 * using the frontend's own metadata readers (window.comfyAPI.pnginfo).
 * Returns an empty map for non-images, missing readers, or unreadable
 * metadata; never throws.
 *
 * @param {File} file
 * @returns {Promise<Map<string, number>>}
 */
async function readImagePromptSeeds(file) {
    const pnginfo = globalThis.window?.comfyAPI?.pnginfo;
    const name = String(file?.name || '');
    const reader = pickMetadataReader(file, pnginfo);
    if (!reader) {
        logger.debug(`[Image Seeds] no metadata reader for ${name || file?.type || 'file'}`);
        return new Map();
    }
    try {
        const meta = await reader(file);
        const promptText = promptTextFromMeta(meta);
        const seeds = seedsFromPromptText(promptText);
        logger.debug(`[Image Seeds] ${name}: metadata keys=${Object.keys(meta || {}).join(',')} promptChars=${typeof promptText === 'string' ? promptText.length : 'none'} seeds=${seeds.size}`);
        return seeds;
    } catch (e) {
        logger.debug(`[Image Seeds] ${name}: metadata read failed: ${e}`);
        return new Map();
    }
}

// Other custom nodes also wrap app.handleFile, and one in the wild captures
// the original at module load and assigns its wrapper AFTER extension setup,
// which silently replaced a plain assignment made from setup() (and, since
// it calls its captured original directly, a prototype patch would be
// bypassed too). So the hook is installed as the OUTERMOST wrapper of
// whatever is current, marked so it is never stacked on itself, and
// re-checked a few times during the first seconds so a later wrapper is
// wrapped in turn. Calls made while a hook run is already in progress just
// delegate (a wrapper chain can otherwise re-enter us).
const HANDLE_FILE_HOOK_MARK = '__srcImageSeedHook';
let handleFileHookDepth = 0;

function installHandleFileHook(app, attempt = 0) {
    const current = app?.handleFile;
    if (typeof current !== 'function') {
        if (attempt === 0) logger.debug('[Image Seeds] app.handleFile not available; image drag-in seed hook not installed');
        return false;
    }
    if (current[HANDLE_FILE_HOOK_MARK]) return false;   // already outermost
    const inner = current;
    const hook = async function srcImageSeedHandleFile(file, ...args) {
        if (handleFileHookDepth > 0) return inner.apply(this, [file, ...args]);
        handleFileHookDepth++;
        try {
            pendingImageSeeds = null;
            logger.debug(`[Image Seeds] handleFile(${file?.name || '?'}, type=${file?.type || '?'})`);
            const seeds = await readImagePromptSeeds(file);
            if (seeds.size > 0) {
                const entry = { seeds, at: Date.now(), name: file?.name || '' };
                pendingImageSeeds = entry;
                logger.debug(`[Image Seeds] ${entry.name}: ${seeds.size} SmartResCalc seed(s) in the prompt block`);
                // The recreated nodes configure shortly after loadGraphData
                // resolves; drop the entry once they have had time to do so,
                // so a later load within the TTL cannot pick it up.
                setTimeout(() => { if (pendingImageSeeds === entry) pendingImageSeeds = null; }, 5000);
            }
        } finally {
            handleFileHookDepth--;
        }
        return inner.apply(this, [file, ...args]);
    };
    hook[HANDLE_FILE_HOOK_MARK] = true;
    app.handleFile = hook;
    logger.debug(`[Image Seeds] Installed image drag-in seed hook on app.handleFile (attempt ${attempt}, wrapping ${inner.name || 'anonymous'})`);
    return true;
}

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
                // Named apart from the Python `scale` input on purpose: the slider is a view
                // on the native `scale` widget (see the value accessor below), never saved
                // and never sent. A shared name made 1.5x frontends rename one of them `scale#1`.
                const scaleWidget = new ScaleWidget("scale_slider", 1.0, { tooltipContent: TOOLTIP_CONTENT.scale });
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

                // ===== SpectralBlend2DWidget =====
                // 2D XY pad for blend_strength + cutoff visualization
                // Augments the native widgets (they stay for value storage + noodle input)
                const blendWidget = this.widgets.find(w => w.name === "blend_strength");
                const cutoffNativeWidget = this.widgets.find(w => w.name === "cutoff");
                const featureSizeWidget = this.widgets.find(w => w.name === "feature_size");
                const fillBlendWidget = this.widgets.find(w => w.name === "fill_blend_strength");
                // Reuse imagePurposeRef from the earlier reposition block (line ~183)
                if (blendWidget && cutoffNativeWidget) {
                    const blend2DWidget = new SpectralBlend2DWidget(
                        "spectral_blend_2d", blendWidget, cutoffNativeWidget, {
                            tooltipContent: TOOLTIP_CONTENT.spectral_blend,
                            featureSizeWidget: featureSizeWidget,
                            fillBlendWidget: fillBlendWidget,
                            imagePurposeWidget: imagePurposeRef,
                        }
                    );
                    this.addCustomWidget(blend2DWidget);

                    // Remove from end (addCustomWidget appends) and insert after cutoff
                    const addedIdx = this.widgets.indexOf(blend2DWidget);
                    if (addedIdx !== -1) {
                        this.widgets.splice(addedIdx, 1);
                    }
                    const cutoffIdx = this.widgets.indexOf(cutoffNativeWidget);
                    this.widgets.splice(cutoffIdx + 1, 0, blend2DWidget);

                    // Make native blend_strength, cutoff, feature_size, fill_blend_strength
                    // sliders zero-height but still functional. Values flow through our
                    // custom widget's header (clickable fields) rather than the native sliders.
                    // Using hideWidget() would suppress serialization/dirty detection —
                    // instead we override only draw and computeSize.
                    for (const w of [blendWidget, cutoffNativeWidget, featureSizeWidget, fillBlendWidget].filter(Boolean)) {
                        if (w) {
                            w._origDraw = w.draw;
                            w.draw = function() {};
                            w._origComputeSize = w.computeSize;
                            w.computeSize = function() { return [0, -4]; };
                        }
                    }

                    // Re-render on image_purpose change so the secondary blend value
                    // shows/hides correctly when user switches modes
                    // NOTE: the image_purpose callback is wrapped again later at line ~598 for
                    // output_image_mode visibility. Both wrappers chain via origCallback.
                    if (imagePurposeRef) {
                        const origPurposeCallback = imagePurposeRef.callback;
                        const nodeRef = this;
                        imagePurposeRef.callback = function(value) {
                            if (origPurposeCallback) origPurposeCallback.call(this, value);
                            nodeRef.setDirtyCanvas(true, true);
                        };
                    }

                    logger.debug('Added SpectralBlend2DWidget after cutoff');
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

                // Custom MODE readout. Display only, never saved, and named apart from the
                // hidden native `mode_status` input so no frontend renames either of them.
                const modeStatusWidget = new ModeStatusWidget("mode_status_display");
                modeStatusWidget.serialize = false;
                this.modeStatusWidgetInstance = modeStatusWidget;

                // Insert custom widget above aspect_ratio
                const aspectRatioIndex = this.widgets.findIndex(w => w.name === "aspect_ratio");
                if (aspectRatioIndex !== -1) {
                    this.widgets.splice(aspectRatioIndex, 0, modeStatusWidget);
                    logger.debug('Created custom MODE status widget above aspect_ratio');
                } else {
                    this.widgets.push(modeStatusWidget);
                    logger.debug('Created custom MODE status widget at end');
                }

                // The native `scale` widget (from Python's FLOAT input) owns the value: it is
                // what the frontend saves, what it sends to Python, and it owns the input
                // socket, so a link into `scale` works with no help from us. It is hidden,
                // and our slider is a VIEW on it: the slider's `value` is an accessor over
                // the native widget, so there is one stored value and nothing to keep in
                // sync. (v0.12.5 mirrored two values and patched the prompt; that patch
                // overwrote links. Design: 2026-09-26__07-12-00__dev-workflow-single-scale-widget.md)
                const nativeScaleWidget = this.widgets.find(w => w.name === "scale" && w !== scaleWidget);
                if (nativeScaleWidget) {
                    nativeScaleWidget.type = "converted-widget";
                    nativeScaleWidget.computeSize = () => [0, -4];  // Hide it from layout
                    nativeScaleWidget.draw = () => {};  // Prevent it from rendering entirely
                    const initial = scaleWidget.value;
                    Object.defineProperty(scaleWidget, 'value', {
                        configurable: true,
                        enumerable: true,
                        get: () => nativeScaleWidget.value,
                        set: (v) => { nativeScaleWidget.value = v; },
                    });
                    if (nativeScaleWidget.value === undefined || nativeScaleWidget.value === null) {
                        nativeScaleWidget.value = initial;
                    }
                    scaleWidget.serialize = false;
                    this.nativeScaleWidget = nativeScaleWidget;
                    logger.debug('Scale slider is a view on the hidden native scale widget');
                }

                // Step sizes persist in node.properties, written when they change.
                // A 1.5x frontend saves via the graph serializer without calling our
                // node.serialize hook, so a write only at serialize time never reached
                // the file (#60).
                this.storeScaleSteps = () => {
                    if (!this.properties) this.properties = {};
                    this.properties.dazzle_scale_steps = { leftStep: scaleWidget.leftStep, rightStep: scaleWidget.rightStep };
                };
                scaleWidget.onStepsChanged = () => this.storeScaleSteps();

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

                    const modeWidget = this.modeStatusWidgetInstance;
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
                            // Retained reference: under 1.5x frontends the slider is renamed "scale#1"
                            const scaleWidget = this.scaleWidgetInstance;
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
                    fillColorWidget.computeSize = function() { return [0, -4]; };
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

                    // Insert button right after fill_type widget (logical grouping)
                    const fillTypeForColor = this.widgets.find(w => w.name === "fill_type");
                    const fillTypeColorIdx = fillTypeForColor ? this.widgets.indexOf(fillTypeForColor) : -1;
                    if (fillTypeColorIdx !== -1) {
                        this.widgets.splice(fillTypeColorIdx + 1, 0, colorPickerButton);
                    } else {
                        // Fallback: after fill_color widget
                        const fillColorIndex = this.widgets.indexOf(fillColorWidget);
                        this.widgets.splice(fillColorIndex + 1, 0, colorPickerButton);
                    }

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
                        const fillTypeWidget = this.widgets?.find(w => w.name === 'fill_type');
                        const isCustomColor = fillTypeWidget?.value === 'custom_color';
                        Object.keys(this.imageOutputWidgets).forEach(key => {
                            const widget = this.imageOutputWidgets[key];
                            if (widget) {
                                // Hide color picker when fill_type isn't custom_color
                                if (key === 'color_picker_button' && !isCustomColor) {
                                    hideWidget(widget);
                                    visibilityLogger.debug(`Hiding widget: ${key} (fill_type != custom_color)`);
                                } else {
                                    showWidget(widget);
                                    visibilityLogger.debug(`Showing widget: ${key}`);
                                }
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

                        // Show color picker if fill_type is custom_color
                        // (color picker is useful without image for dimensions-only workflows)
                        const fillTypeWidget = this.widgets?.find(w => w.name === 'fill_type');
                        if (fillTypeWidget?.value === 'custom_color') {
                            const cpBtn = this.imageOutputWidgets.color_picker_button;
                            if (cpBtn) {
                                showWidget(cpBtn);
                                visibilityLogger.debug('Showing color_picker_button (fill_type=custom_color)');
                            }
                        }

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

                // Listen for fill_type changes to toggle color picker visibility
                const fillTypeWidget = this.widgets?.find(w => w.name === 'fill_type');
                if (fillTypeWidget) {
                    const origCallback = fillTypeWidget.callback;
                    const nodeRef = this;
                    fillTypeWidget.callback = function(value) {
                        if (origCallback) origCallback.call(this, value);
                        nodeRef.updateImageOutputVisibility();
                    };
                }

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
                    // Store the scale widget's step configuration in node.properties.
                    // Frontends from the 1.5x line keep only an allowlist of node
                    // keys in the workflow they save (`properties` is on it; a
                    // custom `widgets_config` is not, and never reached configure
                    // after a save/load round trip: measured 2026-09-26). Same home
                    // as dazzle_last_seed. The old `widgets_config.scale` is still
                    // read on restore for files saved before v0.12.5.
                    // Older frontends call this hook on every save; 1.5x does not, so the
                    // live write in storeScaleSteps (onNodeCreated) is the primary path.
                    const scaleWidget = node.scaleWidgetInstance;
                    if (scaleWidget && node.storeScaleSteps) {
                        node.storeScaleSteps();
                        if (data.properties && data.properties !== node.properties) {
                            data.properties.dazzle_scale_steps = { ...node.properties.dazzle_scale_steps };
                        }
                    }
                },
                onConfigure: (info, node) => {
                    // Restore scale widget step configuration: node.properties first
                    // (v0.12.5+), then the pre-v0.12.5 widgets_config block.
                    // Scale restores onto the native `scale` widget by name like any other
                    // value; the slider reads it through its accessor. One older shape needs
                    // help: files saved on a 1.5x frontend before v0.12.5 hold the user's
                    // value under "scale#1" (the slider, renamed by the frontend) and a
                    // stale 1.0 under "scale". Remove when such files no longer matter.
                    const named = info.widgets_values_named;
                    if (node.nativeScaleWidget && named && typeof named === 'object'
                        && named['scale#1'] !== undefined && named['scale#1'] !== null) {
                        node.nativeScaleWidget.value = named['scale#1'];
                    }

                    const steps = info.properties?.dazzle_scale_steps ?? info.widgets_config?.scale;
                    if (steps) {
                        const scaleWidget = node.scaleWidgetInstance;
                        if (scaleWidget) {
                            scaleWidget.leftStep = steps.leftStep || 0.05;
                            scaleWidget.rightStep = steps.rightStep || 0.1;
                            // A pre-v0.12.5 file carried steps only in widgets_config;
                            // move them to properties so the next save keeps them.
                            node.storeScaleSteps?.();
                        }
                    }

                    // Hydrate the seed recall buffer from the persisted property so
                    // recycle (and -2/-3) work right after a workflow reload or an
                    // image drag-in, not only after the first queue. This completes
                    // the v0.12.2 plan; the queue-time hydration below is the fallback.
                    const seedWidget = node.widgets?.find(w => w.name === "fill_seed");
                    if (seedWidget?.hydrateLastSeedFromNode?.(node)) {
                        logger.debug(`[configure] Node ${node.id}: hydrated lastSeed=${seedWidget.lastSeed} from properties`);
                    }

                    // If this load came from an image, its prompt block outranks
                    // the property just hydrated (#58). Entries older than the TTL
                    // belong to an earlier file and are ignored.
                    if (pendingImageSeeds && (Date.now() - pendingImageSeeds.at) <= PENDING_IMAGE_SEEDS_TTL_MS) {
                        const before = node.properties?.dazzle_last_seed;
                        if (applyImageSeed(node, pendingImageSeeds.seeds)) {
                            logger.debug(`[configure] Node ${node.id}: seed from image prompt ${before} -> ${node.properties.dazzle_last_seed} (${pendingImageSeeds.name})`);
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

                        // Find the ImageModeWidget and use the retained ScaleWidget reference
                        const imageModeWidget = this.widgets?.find(w => w.name === "image_mode");
                        const scaleWidget = this.scaleWidgetInstance;

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

                // Fallback hydration of lastSeed from the per-tab persisted
                // property (primary hydration happens in the configure hook).
                // loadGraphData (opening/switching workflow tabs) recreates all
                // node objects, wiping runtime props like lastSeed — without
                // this, 'reuse last seed' silently falls back to a fresh random
                // seed and busts the cache. node.properties serialize into each
                // tab's workflow draft, so every tab keeps its own last seed.
                if (seedWidget.hydrateLastSeedFromNode?.(node)) {
                    logger.debug(`[Seed Intercept] Node ${node.id}: hydrated lastSeed=${seedWidget.lastSeed} from properties (fallback)`);
                }
                // Hydrate pending user intent the same way (set by SeedWidget
                // interaction, possibly in a previous page/tab lifetime)
                if (!seedWidget.userSeedIntent && node.properties?.dazzle_seed_intent_pending) {
                    seedWidget.userSeedIntent = true;
                    logger.debug(`[Seed Intercept] Node ${node.id}: hydrated pending user seed intent from properties`);
                }

                // Only resolve if seed is ON
                if (!seedWidget.value?.on) continue;
                const seedValue = seedWidget.value?.value;

                // Find connected DazzleCommand via noodle ONLY.
                // No graph scan fallback — standalone SmartResCalc nodes must not be
                // affected by unconnected DazzleCommand nodes in the workflow (#56).
                let cmdNode = null;
                const signalInput = node.inputs?.find(i => i.name === 'dazzle_signal');
                if (signalInput?.link) {
                    // Follow the link through Reroute nodes to the real origin —
                    // a rerouted noodle otherwise makes cmdNode silently null and
                    // the node behaves as if no DazzleCommand were connected.
                    let link = app.graph.links[signalInput.link];
                    for (let hops = 0; link && hops < 10; hops++) {
                        const candidate = app.graph.getNodeById(link.origin_id);
                        if (!candidate) break;
                        if (candidate.comfyClass === 'DazzleCommand') {
                            cmdNode = candidate;
                            break;
                        }
                        const t = candidate.type || candidate.comfyClass || '';
                        if (!/reroute/i.test(t)) break;  // foreign node — stop
                        const upstream = candidate.inputs?.[0]?.link;
                        link = (upstream != null) ? app.graph.links[upstream] : null;
                    }
                    if (!cmdNode) {
                        logger.debug(`[Seed Intercept] Node ${node.id}: dazzle_signal link present but no DazzleCommand origin found (broken/foreign chain?)`);
                    }
                }

                // If no DazzleCommand and seed is fixed, just track and skip
                if (!cmdNode && !SPECIAL_SEEDS.includes(seedValue)) {
                    seedWidget.lastSeed = seedValue;
                    node.properties.dazzle_last_seed = seedValue;
                    seedWidget.userSeedIntent = false;
                    delete node.properties.dazzle_seed_intent_pending;
                    continue;
                }

                // Determine the active seed option from DazzleCommand
                let resolvedSeed;
                let seedHandled = false;

                if (cmdNode) {
                    const cmdState = cmdNode._dazzleCommandState || 'paused';
                    const activeSeedWidget = cmdState === 'playing'
                        ? cmdNode.widgets?.find(w => w.name === 'play_seed')
                        : cmdNode.widgets?.find(w => w.name === 'pause_seed');
                    const activeSeedOption = activeSeedWidget?.value || 'one run then random';

                    logger.debug(`[Seed Intercept] Node ${node.id}: cmdNode=${cmdNode.id}, cmdState=${cmdState}, activeSeedWidget=${activeSeedWidget?.name}=${activeSeedWidget?.value}, activeSeedOption=${activeSeedOption}, seedValue=${seedValue}`);

                    // Priority order: DazzleCommand user seed > seed option logic > SmartResCalc widget
                    const dazzleUserSeed = cmdNode._dazzleUserSeed;

                    if (activeSeedOption === 'new seed each run') {
                        // Force random regardless of widget or DazzleCommand seed
                        resolvedSeed = Math.floor(Math.random() * SEED_MAX);
                        seedHandled = true;
                        logger.debug(`[Seed Intercept] Node ${node.id}: FORCED RANDOM -> ${resolvedSeed}`);

                    } else if (activeSeedOption === 'reuse last seed') {
                        // Lock to last resolved seed — unless the user has
                        // explicitly touched the seed widget since the last
                        // run. Their preference is honored once (falls through
                        // to normal widget resolution below), then the newly
                        // resolved seed becomes the locked seed.
                        if (seedWidget.userSeedIntent) {
                            logger.debug(`[Seed Intercept] Node ${node.id}: REUSE LAST overridden by user seed intent — resolving from widget`);
                        } else if (seedWidget.lastSeed != null) {
                            resolvedSeed = seedWidget.lastSeed;
                            seedHandled = true;
                            logger.debug(`[Seed Intercept] Node ${node.id}: REUSE LAST -> ${resolvedSeed}`);
                        }

                    } else if (activeSeedOption === 'keep widget value') {
                        // Priority: DazzleCommand user seed > SmartResCalc widget
                        if (dazzleUserSeed != null) {
                            resolvedSeed = dazzleUserSeed;
                            seedHandled = true;
                            logger.debug(`[Seed Intercept] Node ${node.id}: KEEP (DazzleCmd) -> ${resolvedSeed}`);
                        } else if (SPECIAL_SEEDS.includes(seedValue)) {
                            resolvedSeed = seedWidget.resolveActualSeed();
                            seedHandled = true;
                            logger.debug(`[Seed Intercept] Node ${node.id}: KEEP WIDGET (resolved) -> ${resolvedSeed}`);
                        } else {
                            resolvedSeed = seedValue;
                            seedHandled = true;
                            logger.debug(`[Seed Intercept] Node ${node.id}: KEEP WIDGET -> ${resolvedSeed}`);
                        }

                    } else if (activeSeedOption === 'one run then random') {
                        // Priority: DazzleCommand user seed > SmartResCalc fixed value > random
                        if (dazzleUserSeed != null) {
                            resolvedSeed = dazzleUserSeed;
                            seedHandled = true;
                            logger.debug(`[Seed Intercept] Node ${node.id}: TRANSIENT (DazzleCmd ${resolvedSeed}) -> will clear after dispatch`);
                            // Defer clear until after prompt dispatch
                            const _cmd = cmdNode;
                            setTimeout(() => {
                                _cmd._dazzleUserSeed = null;
                                _cmd.setDirtyCanvas(true);
                            }, 100);
                        } else if (!SPECIAL_SEEDS.includes(seedValue)) {
                            // Widget has a fixed value (user typed it) — use once
                            resolvedSeed = seedValue;
                            seedHandled = true;
                            logger.debug(`[Seed Intercept] Node ${node.id}: TRANSIENT (widget ${seedValue}) -> will reset to random after dispatch`);
                            // Defer widget reset until after prompt is fully dispatched.
                            // Changing it during queuePrompt doesn't work because
                            // graphToPrompt may have already serialized the value.
                            const _sw = seedWidget;
                            const _node = node;
                            setTimeout(() => {
                                logger.debug(`[Seed Intercept] Deferred reset firing: widget value was ${_sw.value?.value}, setting to ${SPECIAL_SEED_RANDOM}`);
                                _sw.value.value = SPECIAL_SEED_RANDOM;
                                if (_sw.setRandomMode) _sw.setRandomMode(true);
                                _node.setDirtyCanvas(true);
                                logger.debug(`[Seed Intercept] Deferred reset done: widget value is now ${_sw.value?.value}`);
                            }, 500);
                        }
                        // If neither — fall through to normal random
                    }
                    // 'SmartResCalc decides' → seedHandled stays false, normal behavior
                }

                if (!seedHandled) {
                    // Normal resolution (random, increment, decrement)
                    resolvedSeed = seedWidget.resolveActualSeed();
                    logger.debug(`[Seed Intercept] Node ${node.id}: NORMAL resolved ${seedValue} -> ${resolvedSeed}`);
                }
                seedWidget.lastSeed = resolvedSeed;
                // Persist per-tab so 'reuse last seed' survives tab switches
                // and page reloads (properties ride the workflow draft).
                node.properties.dazzle_last_seed = resolvedSeed;
                // User intent (if any) has been honored by this resolution —
                // clear it so lock resumes on the new seed next queue.
                if (seedWidget.userSeedIntent) {
                    seedWidget.userSeedIntent = false;
                    delete node.properties.dazzle_seed_intent_pending;
                    logger.debug(`[Seed Intercept] Node ${node.id}: user seed intent consumed, re-locking on ${resolvedSeed}`);
                }

                // Patch the prompt data (what gets sent to Python)
                const nodePrompt = prompt?.output?.[String(node.id)];

                // Strip dazzle_signal from prompt inputs to prevent cache cascade.
                // The noodle is JS-side binding only (finding the right
                // DazzleCommand); the resolved seed is already baked into
                // fill_seed below. Removing the link means ComfyUI's cache
                // doesn't see DazzleCommand as an ancestor — no cascade.
                // (No markers are injected: ComfyUI filters undeclared prompt
                // inputs before they reach Python, so markers never arrived —
                // and Python needs nothing from the signal anyway.)
                if (nodePrompt?.inputs?.dazzle_signal) {
                    delete nodePrompt.inputs.dazzle_signal;
                    logger.debug(`[Seed Intercept] Node ${node.id}: stripped dazzle_signal`);
                }

                if (nodePrompt?.inputs?.fill_seed) {
                    nodePrompt.inputs.fill_seed = { on: true, value: resolvedSeed };
                }

                // Patch the workflow snapshot (what gets embedded in image
                // metadata). The snapshot was serialized BEFORE this hook ran,
                // so its copy of node.properties still holds the PREVIOUS run's
                // seed; writing this run's seed here is what makes an image
                // dragged back in recover its own seed.
                //
                // Match ids loosely: in current frontends the live node.id is a
                // string while the serialized snapshot carries numbers, so the
                // former strict === never matched and nothing here ever reached
                // an image (measured 9/9 on 2026-09-06; see the seed-recall design doc).
                //
                // Only the property mirror is patched. widgets_values keeps the
                // display state (-1 in random mode) so a dragged-in image
                // restores the same mode as a saved JSON, with the seed readable
                // in the value box and one recycle click away.
                const workflowNode = prompt?.workflow?.nodes?.find(n => String(n.id) === String(node.id));
                if (workflowNode) {
                    if (!workflowNode.properties) workflowNode.properties = {};
                    const stale = workflowNode.properties.dazzle_last_seed;
                    workflowNode.properties.dazzle_last_seed = resolvedSeed;
                    logger.debug(`[Seed Intercept] Node ${node.id}: workflow snapshot dazzle_last_seed ${stale} -> ${resolvedSeed}`);
                } else {
                    logger.debug(`[Seed Intercept] Node ${node.id}: workflow snapshot node not found; image metadata will carry the previous run's seed`);
                }

                // Redraw to show updated state
                node.setDirtyCanvas(true);
            }

            // NOTE: dazzle_signal is NOT stripped from PBE nodes. PBE needs
            // the noodle for execution ordering (DazzleCommand must execute
            // before PBE). Cache cascade is controlled by per-node IS_CHANGED:
            // DC only re-executes when ITS state changes, not when other DCs
            // change. So PBE-1 only cascades when DC-1 toggles.

            // Call the original queuePrompt
            return originalQueuePrompt(index, prompt, ...args);
        };
        logger.verbose('Installed seed prompt interception hook on app.api.queuePrompt');

        // ===== IMAGE DRAG-IN HOOK (#58) =====
        // Read the prompt block before the frontend loads the workflow, so the
        // configure hook can apply each node's real seed (see the module-level
        // note by readImagePromptSeeds / installHandleFileHook). Installed now
        // and re-checked during the first seconds, because other extensions
        // wrap app.handleFile after setup and would otherwise hide this hook.
        installHandleFileHook(app, 0);
        for (const ms of [250, 1000, 3000, 8000]) {
            setTimeout(() => installHandleFileHook(app, ms), ms);
        }

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
