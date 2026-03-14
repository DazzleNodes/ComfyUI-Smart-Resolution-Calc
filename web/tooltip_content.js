/**
 * Centralized Tooltip Content Definitions
 *
 * This file contains all tooltip content for the Smart Resolution Calculator node.
 * Each tooltip has three levels:
 * - quick: Short 1-2 sentence description (shown after hoverDelay ms)
 * - full: Extended 3-5 sentence explanation with examples (shown after fullDelay ms)
 * - docsUrl: Optional link to external documentation (opened on icon click)
 * - hoverDelay: Optional custom delay in milliseconds (default 250ms)
 *
 * To add tooltips to new widgets:
 * 1. Add content here with widget name as key
 * 2. Import TOOLTIP_CONTENT in smart_resolution_calc.js
 * 3. Create InfoIcon with TOOLTIP_CONTENT.widget_name
 * 4. Call icon.draw() and icon.mouse() in widget methods
 */

export const TOOLTIP_CONTENT = {
    /**
     * USE IMAGE DIMS? widget (ImageModeWidget)
     * High Priority - Complex behavior with two extraction modes
     */
    image_mode: {
        quick: "Extract dimensions from image. AR Only: ratio | Exact Dims: exact",
        full: "USE IMAGE DIMS extracts dimensions from connected image input.\n\n" +
              "• AR Only: Extracts aspect ratio, combines with your WIDTH, HEIGHT, & MEGAPIXEL setting.\n" +
              "• Exact Dims: Uses exact image resolution (overrides WIDTH/HEIGHT).\n\n" +
              "Tip: Connect image to auto-populate, or use Copy button for snapshot.",
        docsUrl: "https://github.com/djdarcy/ComfyUI-Smart-Resolution-Calc/blob/main/docs/image-input.md",
        hoverDelay: 250
    },

    /**
     * MEGAPIXEL widget (DimensionWidget)
     * High Priority - Unfamiliar terminology, future feature coming
     */
    megapixel: {
        quick: "Target resolution in millions of pixels (DEFAULT is 1MP = 1024×1024)",
        full: "MEGAPIXEL sets target image resolution.\n\n" +
              "Combined with aspect ratio to calculate WIDTH and HEIGHT.\n" +
              "Example: 2MP at 16:9 = 1920×1080\n\n" +
              "When disabled: Defaults to 1.0 MP as baseline for aspect ratio calculations.\n" +
              "When enabled: Uses your specified value.\n\n" +
              "Future: If WIDTH + HEIGHT + MEGAPIXEL all set, treats W:H as aspect ratio and scales using MEGAPIXEL.",
        docsUrl: null, // Add when docs exist
        hoverDelay: 250
    },

    /**
     * divisible_by widget (Native ComfyUI combo)
     * High Priority - Technical concept not intuitive to users
     */
    divisible_by: {
        quick: "Ensures dimensions divisible by N for AI model compatibility",
        full: "Divisible By rounds dimensions to multiples of the selected value.\n" +
              "Why: Most AI models require dimensions divisible by 8, 16, or 64.\n" +
              "Exact: No rounding (may cause model errors if incompatible)\n" +
              "Recommended: Use 8 or 16 for most Stable Diffusion models.",
        docsUrl: null,
        hoverDelay: 250
    },

    /**
     * custom_aspect_ratio widget (Native ComfyUI text input)
     * Medium Priority - Format unclear to users
     */
    custom_aspect_ratio: {
        quick: "Format: W:H (fractional OK: '1:2.5', '16:9', '1.85:1')",
        full: "Custom aspect ratio format: WIDTH:HEIGHT\n\n" +
              "Supports fractional values:\n" +
              "  • 16:9 (standard HD)\n" +
              "  • 1:2.5 (tall portrait)\n" +
              "  • 1.85:1 (cinema)\n" +
              "  • 2.39:1 (anamorphic widescreen)\n\n" +
              "Tip: Enable 'custom_ratio' toggle to activate custom ratio.",
        docsUrl: null,
        hoverDelay: 250
    },

    /**
     * SCALE widget (ScaleWidget - asymmetric slider)
     * Medium Priority - Complex interaction with different modes
     */
    scale: {
        quick: "Multiplies base dimensions (applies to image input + manual)",
        full: "SCALE multiplies base dimensions by the selected value.\n\n" +
              "• With image input set (AR Only): Scales using image AR + your settings\n" +
              "• With image input set (Exact): Scales exact image dimensions\n\n" +
              "Manual entry: Uses manual WIDTH and HEIGHT entries to perform scale calculation\n\n" +
              "Tip: Asymmetric slider allows fine control from 0.0x to >10.0x, with 1.0x centered for easy reset.",
        docsUrl: null,
        hoverDelay: 250
    },

    /**
     * aspect_ratio widget (Native ComfyUI combo)
     * Low Priority - Mostly self-explanatory, but interaction rules unclear
     */
    /**
     * SEED widget (SeedWidget)
     * High Priority - New concept, toggle semantics need explanation
     */
    fill_seed: {
        quick: "Seed for reproducible noise fills. ON = seeds RNG, OFF = passthrough",
        full: "SEED controls noise fill reproducibility.\n\n" +
              "Toggle ON: Seeds the RNG for fill_type noise patterns.\n" +
              "  Same seed + same fill_type = identical noise every time.\n" +
              "  Special values: -1 = new random each queue,\n" +
              "  -2 = last seed + 1, -3 = last seed - 1\n\n" +
              "Toggle OFF: Value passes through literally. No RNG seeding.\n" +
              "  Useful for routing raw values to other nodes.\n\n" +
              "Buttons (always work in both modes):\n" +
              "  Dice = set to -1 (randomize each time when ON)\n" +
              "  Lock = generate a new random seed value\n" +
              "  Recycle = recall the last seed actually used",
        docsUrl: null,
        hoverDelay: 250
    },

    aspect_ratio: {
        quick: "Aspect ratio for calculations (ignored if both W+H set)",
        full: "ASPECT RATIO determines image proportions.\n\n" +
              "Priority rules:\n" +
              "  1. Both WIDTH + HEIGHT set → AR ignored\n" +
              "  2. WIDTH OR HEIGHT + AR → calculates missing dimension\n" +
              "  3. MEGAPIXEL + AR → calculates both dimensions\n\n" +
              "Tip: Use preset ratios or enable 'custom_ratio' for\n" +
              "fractional values like 1:2.5 or 1.85:1.",
        docsUrl: null,
        hoverDelay: 250
    }
};
