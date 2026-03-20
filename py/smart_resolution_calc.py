from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
import comfy.model_management
import comfy.utils
import logging
import os
import random as py_random
from math import gcd

# Configure debug logging
logger = logging.getLogger('SmartResolutionCalc')
DEBUG_ENABLED = os.getenv('COMFY_DEBUG_SMART_RES_CALC', 'false').lower() == 'true'
logger.setLevel(logging.DEBUG if DEBUG_ENABLED else logging.WARNING)

# Console handler with clear formatting
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        '[SmartResCalc] %(levelname)s: %(message)s'
    ))
    logger.addHandler(handler)

# Always log when module is loaded
print("[SmartResCalc] Module loaded, DEBUG_ENABLED =", DEBUG_ENABLED)



# ============================================================================
# Noise utilities (DazNoise, spectral blending, pil2tensor)
# EXTRACTED to noise_utils.py for modularity and reuse.
# ============================================================================
from .noise_utils import (
    spectral_noise_blend, pil2tensor, _generate_daznoise, _get_plasma_fast,
    DAZNOISE_FILL_TYPES, _DAZNOISE_TYPE_MAP
)



# ============================================================================
# DimensionSourceCalculator
# EXTRACTED to dimension_calculator.py for modularity and reuse.
# ============================================================================
from .dimension_calculator import DimensionSourceCalculator

# Image creation and transformation functions (extracted from SmartResolutionCalc)
from .image_utils import (
    create_empty_image as _create_empty_image,
    transform_image as _transform_image,
    transform_image_scale_pad as _transform_image_scale_pad,
    transform_image_crop_pad as _transform_image_crop_pad,
    transform_image_scale_crop as _transform_image_scale_crop,
    create_preview_image as _create_preview_image,
    create_latent as _create_latent,
    get_image_dimensions_from_path,
)



class CalculationContext:
    """
    Pipeline state for calculate_dimensions().

    Accumulates state as the calculation progresses through stages:
    input parsing -> dimension resolution -> scale/divisibility -> seed ->
    image generation -> latent generation -> info assembly.

    Using a context object instead of 15+ local variables flowing between
    helper methods eliminates long parameter lists and makes the pipeline
    stages explicit.

    Field lifecycle (which stage populates each field):

        Inputs (from ComfyUI — set in __init__):
            aspect_ratio, divisible_by, custom_ratio, custom_aspect_ratio,
            batch_size, scale, image, vae, output_image_mode, fill_type,
            fill_color, blend_strength, fill_image, fill_seed, kwargs

        Parsed from kwargs (__init__):
            use_image, exact_dims, use_mp, megapixel_val, use_width, width_val,
            use_height, height_val

        Populated by _handle_image_input:
            mode_info, override_warning
            May modify: custom_ratio, custom_aspect_ratio, use_width, width_val,
                        use_height, height_val, kwargs

        Populated by _resolve_dimensions:
            w, h, calculated_ar, ratio_display, result, info_detail_base

        Populated by _apply_scale_and_divisibility:
            w (scaled+rounded), h (scaled+rounded), mp, info_detail

        Populated by _resolve_seed:
            seed_active, actual_seed

        Populated by _prepare_output_mode:
            actual_mode, cache_key

        Populated by _resolve_image_purpose:
            use_image_for_output, use_image_for_latent_encode,
            use_image_for_noise_shape
            May modify: actual_mode (forced to "empty" for dims-only/img2noise)

        Populated by _generate_output_image:
            output_image (torch.Tensor [B, H, W, C])

        Populated by _generate_latent:
            latent (dict with 'samples' tensor), latent_source (str)

        Populated by _build_info_string:
            info (str)

        Populated by calculate_dimensions (directly):
            resolution, preview
    """
    def __init__(self, aspect_ratio, divisible_by, custom_ratio, custom_aspect_ratio,
                 batch_size, scale, image, vae, image_purpose, output_image_mode, fill_type,
                 fill_color, blend_strength, fill_image, fill_seed, kwargs):
        # ===== Inputs (from ComfyUI) =====
        self.aspect_ratio: str = aspect_ratio
        self.divisible_by: str = divisible_by
        self.custom_ratio: bool = custom_ratio
        self.custom_aspect_ratio: str = custom_aspect_ratio
        self.batch_size: int = batch_size
        self.scale: float = max(0.0, scale)
        self.image = image                    # Optional[torch.Tensor] — [B, H, W, C]
        self.vae = vae                        # Optional — ComfyUI VAE object
        self.image_purpose: str = image_purpose
        self.output_image_mode: str = output_image_mode
        self.fill_type: str = fill_type
        self.fill_color: str = fill_color
        self.blend_strength: float = blend_strength
        self.fill_image = fill_image          # Optional[torch.Tensor]
        self.fill_seed = fill_seed            # Optional[dict] — {on: bool, value: int}
        self.kwargs: dict = kwargs

        # ===== Image mode (parsed from kwargs) =====
        image_mode = kwargs.get('image_mode', {'on': False, 'value': 0})
        self.use_image: bool = image_mode.get('on', False) if isinstance(image_mode, dict) else False
        self.exact_dims: bool = image_mode.get('value', 0) == 1 if isinstance(image_mode, dict) else False
        self.mode_info: str = None            # Populated by _handle_image_input
        self.override_warning: bool = False   # Populated by _handle_image_input

        # ===== Widget state (parsed from kwargs) =====
        self.use_mp: bool = kwargs.get('dimension_megapixel', {}).get('on', False)
        self.megapixel_val: float = float(kwargs.get('dimension_megapixel', {}).get('value', 1.0))
        self.use_width: bool = kwargs.get('dimension_width', {}).get('on', False)
        self.width_val: int = int(kwargs.get('dimension_width', {}).get('value', 1920))
        self.use_height: bool = kwargs.get('dimension_height', {}).get('on', False)
        self.height_val: int = int(kwargs.get('dimension_height', {}).get('value', 1080))

        # ===== Dimension resolution (populated by _resolve_dimensions) =====
        self.w: int = 0
        self.h: int = 0
        self.mp: float = 0.0
        self.divisor: int = 1 if divisible_by == "Exact" else int(divisible_by)
        self.ratio_display: str = ""
        self.calculated_ar: str = ""
        self.result: dict = None              # DimensionSourceCalculator output
        self.info_detail_base: str = ""
        self.info_detail: str = ""

        # ===== Seed state (populated by _resolve_seed) =====
        self.seed_active: bool = False
        self.actual_seed: int = 0

        # ===== Image purpose routing flags (populated by _resolve_image_purpose) =====
        self.use_image_for_output: bool = True       # IMAGE output uses transformed image
        self.use_image_for_latent_encode: bool = True # LATENT should VAE-encode the image
        self.use_image_for_noise_shape: bool = False  # Image is spectral blend pattern source

        # ===== Output state (populated by pipeline stages) =====
        self.actual_mode: str = output_image_mode  # Populated by _prepare_output_mode
        self.cache_key: tuple = None               # Populated by _prepare_output_mode
        self.output_image = None              # Populated by _generate_output_image — torch.Tensor [B, H, W, C]
        self.preview = None                   # Populated by calculate_dimensions — torch.Tensor
        self.latent: dict = None              # Populated by _generate_latent — {samples: tensor}
        self.latent_source: str = "Empty"     # Populated by _generate_latent
        self.resolution: str = ""             # Populated by calculate_dimensions
        self.info: str = ""                   # Populated by _build_info_string

    def to_tuple(self) -> tuple:
        """Return the final output tuple for ComfyUI.
        Returns: (megapixels, width, height, seed, preview, image, latent, info)
        """
        return (self.mp, self.w, self.h, self.actual_seed,
                self.preview, self.output_image, self.latent, self.info)


class SmartResolutionCalc:
    """
    Smart Resolution Calculator - Flexible resolution and latent generation node.

    Accepts any combination of megapixels/width/height + aspect ratio, automatically
    calculates missing values, and generates both preview and latent images.

    Toggle-based input system allows explicit control over which dimensions to use.
    """

    @classmethod
    def _get_fill_type_options(cls):
        """Build fill_type dropdown options, extending with DazNoise types if available."""
        base = ["black", "white", "custom_color", "noise", "random"]
        if _get_plasma_fast():
            base.extend(DAZNOISE_FILL_TYPES)
        return base

    @classmethod
    def INPUT_TYPES(cls):
        aspect_ratios = [
            "1:1 (Square - Instagram/Profile)",
            "2:3 (Photo Print 4×6)",
            "3:4 (SD Video Portrait)",
            "3:5 (Elegant Vertical)",
            "4:5 (Instagram Portrait)",
            "5:7 (Photo Print 5×7)",
            "5:8 (Tall Photo Print)",
            "7:9 (Modern Portrait)",
            "9:16 (Vert Vid: YT Short/TikTok/Reels)",
            "9:19 (Tall Mobile Screen)",
            "9:21 (Ultra Tall Mobile)",
            "9:32 (Vertical Ultrawide)",
            "3:2 (Photo Print 6×4)",
            "4:3 (SD TV/Monitor)",
            "5:3 (Wide Photo Print)",
            "5:4 (Monitor 1280×1024)",
            "7:5 (Photo Print 7×5)",
            "8:5 (16:10 Monitor/Laptop)",
            "9:7 (Artful Horizon)",
            "16:9 (HD Video/YouTube/TV)",
            "19:9 (Ultrawide Phone)",
            "21:9 (Ultrawide Cinema 2.35:1)",
            "32:9 (Super Ultrawide Monitor)"
        ]

        return {
            "required": {
                "aspect_ratio": (aspect_ratios, {"default": "3:4 (SD Video Portrait)"}),
                "divisible_by": (["Exact", "8", "16", "32", "64"], {"default": "16"}),
                "custom_ratio": ("BOOLEAN", {"default": False, "label_on": "Enable", "label_off": "Disable"}),
            },
            "optional": {
                "mode_status": ("STRING", {
                    "default": "Calculating...",
                    "multiline": False,
                    "tooltip": "Shows current dimension calculation mode (updated automatically, read-only)"
                }),
                "custom_aspect_ratio": ("STRING", {"default": "5.2:2.5"}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 64}),
                "scale": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.0,
                    "max": 7.0,
                    "step": 0.1,
                    "display": "slider"
                }),
                "image": ("IMAGE", {
                    "tooltip": "Optional input image for dimension extraction and transformation.\n\nWithout VAE:\n• Extract dimensions via 'USE IMAGE DIMS' toggle (AR Only or Exact Dims)\n• Transform to target size (distort, crop/pad, scale/crop, scale/pad)\n• Output available via IMAGE output pin\n\nWith VAE:\n• All above features PLUS\n• IMAGE output is VAE encoded to LATENT output\n• Enables img2img/inpainting/outpainting workflows (use low denoise ~0.2)"
                }),
                "vae": ("VAE", {
                    "tooltip": "Optional VAE for encoding image output to latent.\n• Connected: Encodes the IMAGE output to latent (for img2img workflows)\n• Disconnected: Generates empty latent (for txt2img workflows)\nConnect VAE to enable low-denoise img2img/inpainting/outpainting."
                }),
                # fill_type is always visible (controls latent fill even without input image)
                "fill_type": (cls._get_fill_type_options(), {
                    "default": "black",
                    "tooltip": "Fill pattern for empty images, padding, and latent generation:\n• black: Solid black (#000000)\n• white: Solid white (#FFFFFF)\n• custom_color: Use fill_color hex value\n• noise: Gaussian noise (camera-like, centered around gray)\n• random: Uniform random pixels (TV static, full color range)\n\nWith DazzleNodes/dazzle-comfy-plasma-fast installed:\n• DazNoise: Pink — Brightness-biased noise (cube root)\n• DazNoise: Brown — Extreme brightness-biased noise\n• DazNoise: Plasma — Organic cloud-like patterns\n• DazNoise: Greyscale — Monochrome noise mapped to RGB\n• DazNoise: Gaussian — Wide Gaussian noise (centered gray, std=0.25)\n\nWhen VAE is connected, non-trivial fills (noise, random, DazNoise) are\nVAE-encoded into the latent output for use as starting latent in KSampler."
                }),
                "blend_strength": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.05,
                    "tooltip": "Spectral blend strength for noise-to-latent pipeline.\nControls how much the fill_type noise pattern's spatial structure\ninfluences the latent output.\n\n0.0 = Pure Gaussian noise (no pattern influence)\n0.1-0.3 = Subtle structural influence\n0.3-0.5 = Moderate (recommended for most patterns)\n0.5-0.7 = Strong influence (may reduce prompt adherence)\n0.7-1.0 = Very strong (pattern dominates composition)\n\nOnly active when fill_type is a noise pattern (noise, random, DazNoise).\nHas no effect when fill_type is black/white/custom_color."
                }),
                # Image purpose: how the connected image affects outputs (hidden until image connected)
                "image_purpose": (["img2img", "dimensions only", "img2noise", "image + noise", "img2img + img2noise"], {
                    "default": "img2img",
                    "tooltip": "Controls how the connected INPUT image affects the OUTPUT nubs.\n\n• img2img: Transform INPUT image per output_image_mode → OUTPUT image.\n  VAE-encode transformed image → OUTPUT latent.\n\n• dimensions only: Use INPUT image for dimension/AR extraction only.\n  fill_type pattern → OUTPUT image. Seeded noise → OUTPUT latent.\n  The INPUT image does NOT appear in any output.\n\n• img2noise: Use INPUT image's spatial structure to shape noise.\n  fill_type pattern → OUTPUT image.\n  Image-shaped spectral noise → OUTPUT latent. (Composition transfer)\n\n• image + noise: Independent output paths.\n  Transform INPUT image → OUTPUT image.\n  Seeded noise from fill_type → OUTPUT latent. (Not VAE-encoded)\n\n• img2img + img2noise: Layered mode.\n  Transform INPUT image → OUTPUT image.\n  VAE-encoded image + image-shaped noise → OUTPUT latent.\n  (Self-consistent noise reinforces image composition)"
                }),
                # Image output parameters (hidden by JavaScript until image input connected)
                "output_image_mode": (["auto", "empty", "transform (distort)", "transform (crop/pad)", "transform (scale/crop)", "transform (scale/pad)"], {
                    "default": "auto",
                    "tooltip": "Image output mode:\n• auto: Smart default (transform (distort) if image input, empty otherwise)\n• empty: Generate new image with fill pattern\n• transform (distort): Scale to exact dimensions (ignores aspect ratio)\n• transform (crop/pad): No scaling, crop if larger or pad if smaller\n• transform (scale/crop): Scale to cover target (maintains AR), crop excess\n• transform (scale/pad): Scale to fit inside target (maintains AR), pad remainder"
                }),
                "fill_color": ("STRING", {
                    "default": "#522525",
                    "tooltip": "Hex color code for custom_color fill type.\nFormat: #RRGGBB (e.g., #FF0000=red, #00FF00=green, #0000FF=blue)\nWith or without # prefix. Only used when fill_type is 'custom_color'."
                }),
                "fill_image": ("IMAGE", {
                    "tooltip": "Optional custom fill image. When connected, overrides fill_type for padding/empty areas.\nConnect any noise generator (e.g., DazNoise OmniNoise) for custom fill patterns.\nThe image will be scaled to match target dimensions."
                }),
            },
            # Custom widgets added via JavaScript - declare in hidden so ComfyUI passes them to Python
            # Widget data structure: {'on': bool, 'value': number}
            "hidden": {
                "image_mode": "IMAGE_MODE_WIDGET",  # {on: bool, value: 0|1} - 0=AR Only, 1=Exact Dims
                "dimension_megapixel": "DIMENSION_WIDGET",
                "dimension_width": "DIMENSION_WIDGET",
                "dimension_height": "DIMENSION_WIDGET",
                "fill_seed": "SEED_WIDGET",  # {on: bool, value: number} - seed widget state
            },
        }

    RETURN_TYPES = ("FLOAT", "INT", "INT", "INT", "IMAGE", "IMAGE", "LATENT", "STRING")
    RETURN_NAMES = ("megapixels", "width", "height", "seed", "preview", "image", "latent", "info")
    FUNCTION = "calculate_dimensions"
    CATEGORY = "DazzleNodes"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Force re-execution only when seed is active AND set to a special value
        # (-1 = random, -2 = noise passthrough, -3 = increment, etc.)
        # Fixed seeds (>= 0) produce deterministic output, so ComfyUI can cache normally
        fill_seed = kwargs.get('fill_seed')
        if fill_seed is not None and isinstance(fill_seed, dict):
            if fill_seed.get('on', False):
                seed_value = fill_seed.get('value', 0)
                if isinstance(seed_value, (int, float)) and seed_value < 0:
                    return float("NaN")  # Special seed — always re-execute
        return ""  # Fixed seed or seed off — let ComfyUI cache normally
    # get_image_dimensions_from_path extracted to image_utils.py

    def calculate_dimensions_api(widgets, runtime_context=None):
        """
        API endpoint method for dimension calculation.

        This is the single source of truth for dimension calculations.
        JavaScript calls this via /smart-resolution/calculate-dimensions endpoint.

        Args:
            widgets (dict): Widget state from JavaScript
                {
                    "width_enabled": bool,
                    "width_value": int,
                    "height_enabled": bool,
                    "height_value": int,
                    "mp_enabled": bool,
                    "mp_value": float,
                    "image_mode_enabled": bool,
                    "image_mode_value": int,  # 0=AR Only, 1=Exact Dims
                    "custom_ratio_enabled": bool,
                    "custom_aspect_ratio": str,
                    "aspect_ratio_dropdown": str
                }
            runtime_context (dict): Optional runtime data
                {
                    "image_info": {"width": int, "height": int}
                }

        Returns:
            dict: Calculation result
                {
                    "mode": str,
                    "priority": int,
                    "baseW": int,
                    "baseH": int,
                    "source": str,
                    "ar": {"ratio": float, "aspectW": int, "aspectH": int, "source": str},
                    "conflicts": list,
                    "description": str,
                    "activeSources": list,
                    "success": bool
                }
        """
        try:
            # Create calculator instance
            calculator = DimensionSourceCalculator()

            # Call calculator
            result = calculator.calculate_dimension_source(widgets, runtime_context)

            # Add success flag
            result['success'] = True

            return result

        except Exception as e:
            logger.error(f"Error calculating dimensions: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': str(e)
            }

    def __init__(self):
        self.device = comfy.model_management.intermediate_device()
        # Cache for expensive noise generation (DazNoise, etc.)
        # Keyed on (fill_type, seed, width, height, batch_size) — reuse if unchanged
        self._noise_cache_key = None
        self._noise_cache_image = None
        self._noise_cache_latent = None

    def format_aspect_ratio(self, width, height):
        """
        Format aspect ratio as simplified W:H notation using GCD.

        Returns a simplified aspect ratio that users can manually enter
        into the aspect ratio field for future use.

        Examples:
            1920 × 1080 → "16:9"
            1024 × 1024 → "1:1"
            3840 × 2160 → "16:9"
            1997 × 1123 → "1997:1123" (coprime, already reduced)
        """
        divisor = gcd(width, height)
        w_ratio = width // divisor
        h_ratio = height // divisor
        return f"{w_ratio}:{h_ratio}"

    def calculate_mode_label_for_info(self, use_width, use_height, use_mp, use_image, exact_dims, ar_source_label, calculated_ar):
        """
        Calculate mode label for info output based on active widget states.

        Mirrors JavaScript's DimensionSourceManager priority system to ensure consistency
        between MODE widget display and info output.

        Args:
            ar_source_label: String describing AR source, e.g., "Image AR (1:1)", "Aspect Ratio (16:9)"
            calculated_ar: The actual AR calculated from dimensions (e.g., "16:9")

        Priority order (matching JavaScript):
        1. Image Exact Dims
        2. Width + Height (show calculated AR)
        3. Width + Megapixels (show calculated AR)
        4. Height + Megapixels (show calculated AR)
        5. Width + Aspect Ratio (with source context)
        6. Height + Aspect Ratio (with source context)
        7. Megapixels + Aspect Ratio (with source context)
        8. Default (1.0 MP) / Image AR Only mode
        """
        # Priority 1: Image Exact Dims
        if use_image and exact_dims:
            return f"Image Exact Dims (AR: {calculated_ar})"

        # Priority 2: Width + Height (both specified - show calculated AR)
        if use_width and use_height:
            return f"Width + Height (AR: {calculated_ar})"

        # Priority 3: Width + Megapixels (show calculated AR)
        if use_width and use_mp:
            return f"Width + Megapixels (AR: {calculated_ar})"

        # Priority 4: Height + Megapixels (show calculated AR)
        if use_height and use_mp:
            return f"Height + Megapixels (AR: {calculated_ar})"

        # Priority 5: Width + Aspect Ratio (show AR source with ratio)
        if use_width:
            return f"Width + {ar_source_label}"

        # Priority 6: Height + Aspect Ratio (show AR source with ratio)
        if use_height:
            return f"Height + {ar_source_label}"

        # Priority 7: Megapixels + Aspect Ratio (show AR source with ratio)
        if use_mp:
            return f"Megapixels + {ar_source_label}"

        # Priority 8: Default or Image AR Only
        if use_image and not exact_dims:
            # AR Only mode with no dimension widgets - using defaults with image AR
            return f"Default (1.0 MP) + {ar_source_label}"

        # Pure default mode (no inputs active - show calculated AR)
        return f"Default (1.0 MP) (AR: {calculated_ar})"

    def calculate_dimensions(self, aspect_ratio, divisible_by, custom_ratio=False,
                            custom_aspect_ratio="16:9", batch_size=1, scale=1.0,
                            image=None, vae=None, image_purpose="img2img",
                            output_image_mode="auto", fill_type="black",
                            fill_color="#808080", blend_strength=0.0, fill_image=None,
                            fill_seed=None, **kwargs):
        """
        Calculate dimensions based on active toggle inputs from custom widgets.

        Args:
            aspect_ratio: Selected aspect ratio from dropdown
            divisible_by: Dimension rounding factor ("Exact", "8", "16", "32", "64")
            custom_ratio: Whether custom aspect ratio is enabled
            custom_aspect_ratio: Custom aspect ratio string (e.g., "16:9")
            batch_size: Number of images/latents to generate
            scale: Scale multiplier for dimensions
            image: Optional input image for dimension extraction or transformation
            vae: Optional VAE for encoding image output to latent
                 - If provided: Encodes output_image to latent (img2img workflow)
                 - If None: Generates empty latent (txt2img workflow)
            output_image_mode: Image output transformation mode
            fill_type: Fill pattern for empty images
            fill_color: Hex color for custom fill
            blend_strength: Spectral blend strength for noise-to-latent pipeline
            fill_image: Optional custom fill image (overrides fill_type)
            fill_seed: Seed widget data {on: bool, value: number} for noise RNG (hidden)
                 - on=True: Seeds RNG for reproducible noise fills
                 - on=False: Passthrough, no RNG seeding
            **kwargs: Widget data from JavaScript containing dimension toggles

        kwargs contains widget data from JavaScript:
        {
            'dimension_megapixel': {'on': True, 'value': 1.0},
            'dimension_width': {'on': False, 'value': 1920},
            'dimension_height': {'on': True, 'value': 1080},
            'image_mode': {'on': True, 'value': 0},  # 0=AR Only, 1=Exact Dims
        }

        Priority order (first match wins):
        1. Width + Height -> calculate megapixels, infer aspect ratio
        2. Width + Aspect Ratio -> calculate height, then megapixels
        3. Height + Aspect Ratio -> calculate width, then megapixels
        4. Megapixels + Aspect Ratio -> calculate both dimensions
        5. None active -> default to 1.0 MP + aspect ratio

        Pipeline stages (each populates the CalculationContext):
        1. _handle_image_input() -- extract dims/AR from connected image
        2. _resolve_dimensions() -- run DimensionSourceCalculator
        3. _apply_scale_and_divisibility() -- scale + round to divisor
        4. _resolve_seed() -- resolve seed value from widget data
        5. _generate_output_image() -- generate image (5 modes + caching)
        6. _generate_latent() -- generate latent (3 paths + caching)
        7. _build_info_string() -- assemble info output

        Returns:
            Tuple: (megapixels, width, height, seed, preview, image, latent, info)
        """
        # ALWAYS log that function was called (critical diagnostic)
        print(f"[SmartResCalc] calculate_dimensions() CALLED - aspect_ratio={aspect_ratio}, divisible_by={divisible_by}")

        # Debug logging for kwargs
        logger.debug(f"Function called with standard args: aspect_ratio={aspect_ratio}, divisible_by={divisible_by}, custom_ratio={custom_ratio}")
        logger.debug(f"kwargs keys received: {list(kwargs.keys())}")
        logger.debug(f"kwargs contents: {kwargs}")

        # Create pipeline context with all inputs
        ctx = CalculationContext(
            aspect_ratio, divisible_by, custom_ratio, custom_aspect_ratio,
            batch_size, scale, image, vae, image_purpose, output_image_mode, fill_type,
            fill_color, blend_strength, fill_image, fill_seed, kwargs
        )

        # Pipeline stages
        self._handle_image_input(ctx)
        self._resolve_dimensions(ctx)
        self._apply_scale_and_divisibility(ctx)
        self._resolve_seed(ctx)

        # Image + latent generation
        self._prepare_output_mode(ctx)
        self._resolve_image_purpose(ctx)
        ctx.output_image = self._generate_output_image(
            ctx.actual_mode, ctx.image, ctx.w, ctx.h, ctx.fill_type, ctx.fill_color,
            ctx.batch_size, ctx.fill_image, ctx.cache_key, ctx.seed_active, ctx.actual_seed
        )

        # Preview (generated after output_image so we can show the transform result)
        ctx.resolution = f"{ctx.w} x {ctx.h}"
        # Determine which image to show in the preview thumbnail:
        # - img2img / image+noise / img2img+img2noise: show ctx.output_image (already transformed)
        # - img2noise: transform the input image per noise_shape_transform for preview
        # - dimensions only: no thumbnail
        preview_image = None
        if ctx.image is not None:
            if ctx.use_image_for_output:
                # output_image is the transformed input image
                preview_image = ctx.output_image
            elif ctx.use_image_for_noise_shape:
                # For img2noise, output_image is the fill pattern — transform input image for preview
                transform_mode = getattr(ctx, 'noise_shape_transform', 'transform (distort)')
                if transform_mode == "transform (distort)":
                    preview_image = _transform_image(ctx.image, ctx.w, ctx.h)
                elif transform_mode == "transform (crop/pad)":
                    preview_image = _transform_image_crop_pad(ctx.image, ctx.w, ctx.h, ctx.fill_type, ctx.fill_color, ctx.fill_image)
                elif transform_mode == "transform (scale/crop)":
                    preview_image = _transform_image_scale_crop(ctx.image, ctx.w, ctx.h)
                elif transform_mode == "transform (scale/pad)":
                    preview_image = _transform_image_scale_pad(ctx.image, ctx.w, ctx.h, ctx.fill_type, ctx.fill_color, ctx.fill_image)
                else:
                    preview_image = _transform_image(ctx.image, ctx.w, ctx.h)
        ctx.preview = _create_preview_image(ctx.w, ctx.h, ctx.resolution, ctx.ratio_display, ctx.mp,
                                            preview_image=preview_image)
        ctx.latent, ctx.latent_source = self._generate_latent(
            ctx.vae, ctx.image, ctx.output_image, ctx.actual_mode, ctx.w, ctx.h,
            ctx.batch_size, ctx.fill_type, ctx.fill_image, ctx.blend_strength,
            ctx.seed_active, ctx.actual_seed, ctx.cache_key,
            ctx.use_image_for_latent_encode, ctx.use_image_for_noise_shape,
            getattr(ctx, 'noise_shape_transform', None), ctx.fill_color
        )

        # Info string assembly
        self._build_info_string(ctx)

        # ALWAYS log final results
        print(f"[SmartResCalc] RESULT: {ctx.info}, resolution={ctx.resolution}")
        logger.debug(f"Returning: mp={ctx.mp}, w={ctx.w}, h={ctx.h}, resolution={ctx.resolution}, info={ctx.info}")

        return ctx.to_tuple()

    def _handle_image_input(self, ctx):
        """Stage 1: Extract dimensions or AR from connected image."""
        # Debug: Log image_mode state
        logger.debug(f"image_mode: use_image={ctx.use_image}, exact_dims={ctx.exact_dims}, image={'connected' if ctx.image is not None else 'None'}")

        if ctx.image is None or not ctx.use_image:
            return

        # Image tensor shape: [batch, height, width, channels]
        h, w = ctx.image.shape[1], ctx.image.shape[2]
        actual_ar = self.format_aspect_ratio(w, h)
        logger.debug(f"Image input detected: {w}x{h}, AR: {actual_ar}")

        if ctx.exact_dims:
            # Check if manual WIDTH or HEIGHT settings will be overridden
            manual_width = ctx.kwargs.get('dimension_width', {}).get('on', False)
            manual_height = ctx.kwargs.get('dimension_height', {}).get('on', False)
            if manual_width or manual_height:
                ctx.override_warning = True
                logger.debug(f"Override warning: Manual W/H settings detected but will be ignored in exact dims mode")

            # Force Width+Height mode with extracted dimensions (apply scale)
            ctx.kwargs['dimension_width'] = {'on': True, 'value': int(w * ctx.scale)}
            ctx.kwargs['dimension_height'] = {'on': True, 'value': int(h * ctx.scale)}
            ctx.use_width = True
            ctx.width_val = int(w * ctx.scale)
            ctx.use_height = True
            ctx.height_val = int(h * ctx.scale)
            ctx.mode_info = f"From Image (Exact: {w}x{h})"
            if ctx.scale != 1.0:
                ctx.mode_info += f" @ {ctx.scale}x"
            logger.debug(f"Exact dimensions mode: forcing width={ctx.width_val}, height={ctx.height_val}")
        else:
            # Extract AR only, use with current megapixel calculation
            ctx.custom_ratio = True
            ctx.custom_aspect_ratio = actual_ar
            ctx.mode_info = f"From Image (AR: {actual_ar})"
            logger.debug(f"AR extraction mode: using AR {actual_ar} with existing megapixel logic")

    def _resolve_dimensions(self, ctx):
        """Stage 2: Run DimensionSourceCalculator and extract base dimensions."""
        # Debug: Log extracted widget values
        logger.debug(f"Extracted widget states: use_mp={ctx.use_mp} (val={ctx.megapixel_val}), "
                     f"use_width={ctx.use_width} (val={ctx.width_val}), "
                     f"use_height={ctx.use_height} (val={ctx.height_val})")

        # Build widgets dict for calculator
        widgets = {
            'width_enabled': ctx.use_width,
            'width_value': ctx.width_val,
            'height_enabled': ctx.use_height,
            'height_value': ctx.height_val,
            'mp_enabled': ctx.use_mp,
            'mp_value': ctx.megapixel_val,
            'image_mode_enabled': ctx.use_image,
            'image_mode_value': 1 if ctx.exact_dims else 0,
            'custom_ratio_enabled': ctx.custom_ratio,
            'custom_aspect_ratio': ctx.custom_aspect_ratio if ctx.custom_ratio else '16:9',
            'aspect_ratio_dropdown': ctx.aspect_ratio
        }

        # Build runtime context (includes image info if available)
        runtime_context = {}
        if ctx.image is not None and ctx.use_image:
            img_h, img_w = ctx.image.shape[1], ctx.image.shape[2]
            runtime_context['image_info'] = {'width': img_w, 'height': img_h}

        # Calculate dimensions
        calculator = DimensionSourceCalculator()
        ctx.result = calculator.calculate_dimension_source(widgets, runtime_context)

        # Handle pending states (image mode enabled but no image connected)
        # Fall back to defaults with dropdown AR when baseW/baseH are None
        if ctx.result['baseW'] is None or ctx.result['baseH'] is None:
            logger.warning(f"[Calculator] Pending state detected ({ctx.result['mode']}), falling back to defaults")
            print(f"[SmartResCalc] WARNING: Image mode enabled but no image connected - using defaults")
            # Recalculate without image mode to get valid dimensions
            widgets_fallback = widgets.copy()
            widgets_fallback['image_mode_enabled'] = False
            ctx.result = calculator.calculate_dimension_source(widgets_fallback, runtime_context)

        ctx.w = ctx.result['baseW']
        ctx.h = ctx.result['baseH']
        ctx.calculated_ar = f"{ctx.result['ar']['aspectW']}:{ctx.result['ar']['aspectH']}"
        ctx.ratio_display = ctx.calculated_ar

        # Build info detail base from priority
        self._build_info_detail_base(ctx)

        logger.debug(f"Calculator result: mode={ctx.result['mode']}, priority={ctx.result['priority']}, baseW={ctx.w}, baseH={ctx.h}, AR={ctx.calculated_ar}")
        logger.debug(f"Mode description: {ctx.result['description']}")

    def _build_info_detail_base(self, ctx):
        """Build the info detail base string from calculator priority."""
        result = ctx.result
        w, h = ctx.w, ctx.h

        if result['priority'] == 1:  # Exact Dims
            ctx.info_detail_base = f"From Image: {w}x{h}"
        elif result['priority'] == 2:  # MP+W+H Scalar
            ctx.info_detail_base = f"AR from WxH, scaled to {ctx.megapixel_val}MP"
        elif result['priority'] == 3:  # Explicit dimensions
            if result['mode'] == 'width_height_explicit':
                ctx.info_detail_base = f"Base W: {w} x H: {h}"
            elif result['mode'] == 'mp_width_explicit':
                ctx.info_detail_base = f"Calculated H: {h} from {ctx.megapixel_val}MP"
            elif result['mode'] == 'mp_height_explicit':
                ctx.info_detail_base = f"Calculated W: {w} from {ctx.megapixel_val}MP"
        elif result['priority'] == 4:  # AR Only
            active = result.get('activeSources', [])
            if 'WIDTH' in active:
                ctx.info_detail_base = f"WIDTH: {w}, calculated H: {h} from image AR {ctx.calculated_ar}"
            elif 'HEIGHT' in active:
                ctx.info_detail_base = f"HEIGHT: {h}, calculated W: {w} from image AR {ctx.calculated_ar}"
            elif 'MEGAPIXEL' in active:
                ctx.info_detail_base = f"Calculated {w}x{h} from {ctx.megapixel_val}MP and image AR {ctx.calculated_ar}"
            else:
                ctx.info_detail_base = f"Calculated {w}x{h} from default 1.0MP and image AR {ctx.calculated_ar}"
        elif result['priority'] == 5:  # Single dimension with AR
            active = result.get('activeSources', [])
            if 'WIDTH' in active:
                ctx.info_detail_base = f"Calculated H: {h}"
            elif 'HEIGHT' in active:
                ctx.info_detail_base = f"Calculated W: {w}"
            elif 'MEGAPIXEL' in active:
                ctx.info_detail_base = f"Calculated W: {w} x H: {h}"
        else:  # Priority 6: Defaults
            ctx.info_detail_base = f"W: {w} x H: {h}"

    def _apply_scale_and_divisibility(self, ctx):
        """Stage 3: Apply scale multiplier and divisibility rounding."""
        # Warn if scale is very high
        if ctx.scale > 7.0:
            logger.warning(f"Scale {ctx.scale}x exceeds recommended maximum (7x). This may cause out-of-memory errors.")
            print(f"[SmartResCalc] WARNING: Scale {ctx.scale}x is very high and may exceed GPU limits")

        # Apply scale (keep float precision for accurate rounding)
        w_scaled = ctx.w * ctx.scale
        h_scaled = ctx.h * ctx.scale

        # Warn if scaled dimensions exceed typical GPU limits
        if w_scaled > 16384 or h_scaled > 16384:
            logger.warning(f"Scaled dimensions {w_scaled:.1f}x{h_scaled:.1f} exceed typical GPU texture limits (16384px)")
            print(f"[SmartResCalc] WARNING: Dimensions {int(w_scaled)}x{int(h_scaled)} may exceed GPU limits")

        # Apply divisibility rounding (Python banker's rounding)
        ctx.w = int(round(w_scaled / ctx.divisor) * ctx.divisor)
        ctx.h = int(round(h_scaled / ctx.divisor) * ctx.divisor)
        ctx.mp = (ctx.w * ctx.h) / 1_000_000

        # Build info detail with scale info
        if ctx.scale != 1.0:
            ctx.info_detail = f"{ctx.info_detail_base} | Scale: {ctx.scale}x | Final: {ctx.w}x{ctx.h} | MP: {ctx.mp:.2f}"
        else:
            ctx.info_detail = f"{ctx.info_detail_base} | MP: {ctx.mp:.2f}"

    def _resolve_seed(self, ctx):
        """Stage 4: Resolve seed value from widget data."""
        # The JS SeedWidget resolves special values (-1=random, -2=inc, -3=dec)
        # to actual seed numbers BEFORE sending to Python via serializeValue().
        # The -1/-2/-3 fallback below is VESTIGIAL — safety net for edge cases.
        if ctx.fill_seed is not None and isinstance(ctx.fill_seed, dict):
            ctx.seed_active = ctx.fill_seed.get('on', False)
            seed_value = int(ctx.fill_seed.get('value', -1))

            if ctx.seed_active:
                if seed_value in (-1, -2, -3):
                    # VESTIGIAL: JS should have resolved these before sending
                    logger.warning(f"Received unresolved special seed {seed_value} from JS — generating random")
                    ctx.actual_seed = py_random.randint(0, 1125899906842624)
                else:
                    ctx.actual_seed = seed_value
                logger.debug(f"Fill seed active: will seed RNG with {ctx.actual_seed}")
            else:
                # OFF mode: passthrough literal value, no RNG seeding
                ctx.actual_seed = seed_value
                logger.debug(f"Fill seed OFF: passthrough value {ctx.actual_seed}")
        else:
            # No seed data (backward compat with pre-v0.8.0 workflows)
            ctx.actual_seed = 0
            logger.debug("No fill_seed data, using default (unseeded)")

    def _prepare_output_mode(self, ctx):
        """Resolve 'auto' mode and set cache key before image/latent generation."""
        ctx.actual_mode = ctx.output_image_mode
        if ctx.output_image_mode == "auto":
            ctx.actual_mode = "transform (distort)" if ctx.image is not None else "empty"
            logger.debug(f"Smart default: 'auto' -> '{ctx.actual_mode}'")

        # Guard: Transform modes require input image
        if ctx.actual_mode.startswith("transform") and ctx.image is None:
            logger.warning(f"Transform mode '{ctx.actual_mode}' requires input image, using 'empty'")
            ctx.actual_mode = "empty"

        ctx.cache_key = (ctx.fill_type, ctx.actual_seed if ctx.seed_active else None,
                         ctx.w, ctx.h, ctx.batch_size, ctx.fill_image is not None)

    def _resolve_image_purpose(self, ctx):
        """Resolve image_purpose into routing flags for output generation.

        Sets three flags that control how _generate_output_image and _generate_latent
        route the image:
        - use_image_for_output: IMAGE output uses transformed image (vs fill pattern)
        - use_image_for_latent_encode: LATENT should VAE-encode the image
        - use_image_for_noise_shape: image is spectral blend pattern source for noise LATENT
        """
        purpose = ctx.image_purpose

        if purpose == "img2img":
            # Standard behavior — transform image, VAE-encode to latent
            ctx.use_image_for_output = True
            ctx.use_image_for_latent_encode = True
            ctx.use_image_for_noise_shape = False

        elif purpose == "dimensions only":
            # Image for dims only — fill pattern for IMAGE, noise for LATENT
            ctx.use_image_for_output = False
            ctx.use_image_for_latent_encode = False
            ctx.use_image_for_noise_shape = False
            ctx.actual_mode = "empty"

        elif purpose == "img2noise":
            # Image as spectral blend source — fill pattern for IMAGE, image-shaped noise for LATENT
            # output_image_mode controls how the input image is transformed before noise shaping
            ctx.use_image_for_output = False
            ctx.use_image_for_latent_encode = False
            ctx.use_image_for_noise_shape = True
            # Store the user's transform choice for noise shaping, then force empty for IMAGE output
            ctx.noise_shape_transform = ctx.actual_mode if ctx.actual_mode.startswith("transform") else "transform (distort)"
            ctx.actual_mode = "empty"

        elif purpose == "image + noise":
            # Independent paths — transform image for IMAGE, noise for LATENT
            ctx.use_image_for_output = True
            ctx.use_image_for_latent_encode = False
            ctx.use_image_for_noise_shape = False

        elif purpose == "img2img + img2noise":
            # Layered — transform image for IMAGE, VAE-encode + image-shaped noise for LATENT
            ctx.use_image_for_output = True
            ctx.use_image_for_latent_encode = True
            ctx.use_image_for_noise_shape = True

        if purpose != "img2img":
            logger.debug(f"Image purpose '{purpose}': output={ctx.use_image_for_output}, "
                         f"latent_encode={ctx.use_image_for_latent_encode}, "
                         f"noise_shape={ctx.use_image_for_noise_shape}, "
                         f"actual_mode={ctx.actual_mode}")

    def _build_info_string(self, ctx):
        """Stage 7: Assemble the info output string."""
        import re

        div_info = "Exact" if ctx.divisible_by == "Exact" else str(ctx.divisor)
        ctx.calculated_ar = self.format_aspect_ratio(ctx.w, ctx.h)
        mode_display = ctx.result['description']

        logger.debug(f"Mode display from calculator: '{mode_display}' (priority={ctx.result['priority']}, mode={ctx.result['mode']}, conflicts={len(ctx.result['conflicts'])})")

        base_info = f"Mode: {mode_display} | {ctx.info_detail}"

        # Add AR if not already mentioned
        info_so_far = base_info.lower()
        has_ar_mention = (
            re.search(r'\bar\b', info_so_far) or
            'image ar' in info_so_far or
            'image_ar' in info_so_far
        )

        seed_info = f"Seed: {ctx.actual_seed}" if ctx.seed_active else ""

        purpose_info = f" | Purpose: {ctx.image_purpose}" if ctx.image_purpose != "img2img" else ""

        if not has_ar_mention:
            ctx.info = f"{base_info} | AR: {ctx.calculated_ar} | Div: {div_info}{purpose_info} | Latent: {ctx.latent_source}"
        else:
            ctx.info = f"{base_info} | Div: {div_info}{purpose_info} | Latent: {ctx.latent_source}"

        if seed_info:
            ctx.info = f"{ctx.info} | {seed_info}"

        # Override warning for exact dims mode
        if ctx.exact_dims and ctx.override_warning:
            ctx.info = f"[Manual W/H Ignored] | {ctx.info}"

    def _generate_output_image(self, actual_mode, image, w, h, fill_type, fill_color,
                               batch_size, fill_image, cache_key, seed_active, actual_seed):
        """
        Generate the output image based on the selected mode.

        Handles 5 modes: empty (with caching), distort, crop/pad, scale/crop, scale/pad.
        Transform modes require an input image; falls back to empty if none connected.

        Returns:
            torch.Tensor: Output image tensor [B, H, W, C]
        """
        # Seed RNG right before image generation (after preview, before noise fill)
        # This ensures the seeded state isn't consumed by preview or other code
        if seed_active and actual_seed >= 0:
            torch.manual_seed(actual_seed)
            py_random.seed(actual_seed)
            logger.debug(f"Seeded torch and py_random with {actual_seed} (right before image generation)")

        if actual_mode == "empty":
            if self._noise_cache_key == cache_key and self._noise_cache_image is not None:
                output_image = self._noise_cache_image
                logger.debug(f"Using cached noise image ({fill_type}, seed={actual_seed}, {w}x{h})")
                print(f"[SmartResCalc] Using cached noise image (skipping {fill_type} generation)")
            else:
                # Generate image with specified fill pattern at calculated dimensions
                logger.debug(f"Calling create_empty_image({w}, {h}, '{fill_type}', ...)")
                output_image = _create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)
                logger.debug(f"output_image: shape={output_image.shape}, min={output_image.min():.4f}, max={output_image.max():.4f}, mean={output_image.mean():.4f}")
                # Cache the result
                self._noise_cache_key = cache_key
                self._noise_cache_image = output_image
                self._noise_cache_latent = None  # Invalidate latent cache (will be rebuilt)
                logger.debug(f"Cached noise image ({fill_type}, seed={actual_seed}, {w}x{h})")

        elif actual_mode == "transform (distort)":
            if image is not None:
                # Transform input image to calculated dimensions (may distort aspect ratio)
                # Note: Use input image's batch size, not batch_size parameter
                output_image = _transform_image(image, w, h)
                logger.debug(f"Transformed (distort) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (distort) mode selected but no image connected, generating empty image")
                output_image = _create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        elif actual_mode == "transform (crop/pad)":
            if image is not None:
                # No scaling - crop if larger, pad if smaller
                output_image = _transform_image_crop_pad(image, w, h, fill_type, fill_color, fill_image)
                logger.debug(f"Transformed (crop/pad) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (crop/pad) mode selected but no image connected, generating empty image")
                output_image = _create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        elif actual_mode == "transform (scale/crop)":
            if image is not None:
                # Scale to cover target (maintaining AR), crop excess
                output_image = _transform_image_scale_crop(image, w, h)
                logger.debug(f"Transformed (scale/crop) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (scale/crop) mode selected but no image connected, generating empty image")
                output_image = _create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        elif actual_mode == "transform (scale/pad)":
            if image is not None:
                # Scale to fit inside target (maintaining AR), pad remainder
                output_image = _transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image)
                logger.debug(f"Transformed (scale/pad) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (scale/pad) mode selected but no image connected, generating empty image")
                output_image = _create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        else:  # Safety fallback for invalid mode values
            logger.warning(f"Invalid output_image_mode '{actual_mode}', using empty image")
            output_image = _create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        return output_image

    def _generate_latent(self, vae, image, output_image, actual_mode, w, h, batch_size,
                         fill_type, fill_image, blend_strength, seed_active, actual_seed,
                         cache_key, use_image_for_latent_encode=True,
                         use_image_for_noise_shape=False, noise_shape_transform=None,
                         fill_color="#808080"):
        """
        Generate latent output based on VAE presence, fill type, and image_purpose flags.

        Paths (controlled by image_purpose routing flags):
        1. VAE + image + latent_encode → encode transformed image (img2img)
        2. VAE + non-trivial fill + !latent_encode → raw latent noise (txt2img with seed)
        3. VAE + noise_shape + image → spectral blend with image as pattern source (img2noise)
        4. VAE + latent_encode + noise_shape → VAE-encode + image-shaped noise dict (layered)
        5. Otherwise → empty latent (zeros)

        Returns:
            tuple: (latent_dict, latent_source_label)
        """
        latent_source = "Empty"  # Default for info output

        # Determine if fill content is worth VAE-encoding
        # Trivial fills (black/white/custom_color) produce uniform images that don't benefit
        # from VAE encoding — use zeros latent instead (faster, equivalent for KSampler)
        has_nontrivial_fill = (
            fill_image is not None
            or fill_type in ("noise", "random")
            or fill_type.startswith("DazNoise:")
        )

        # Latent output paths (controlled by image_purpose routing flags):
        # 1. VAE + image + latent_encode → VAE-encode the transformed image (img2img)
        # 2. VAE + !latent_encode + noise fill → raw latent noise (txt2img with seed control)
        # 3. Otherwise → empty zeros latent
        should_vae_encode_image = (
            vae is not None and image is not None
            and use_image_for_latent_encode and actual_mode != "empty"
        )
        should_generate_raw_noise = (
            vae is not None and not use_image_for_latent_encode and has_nontrivial_fill
        )

        if should_vae_encode_image:
            # Path 1: VAE-encode the transformed image for img2img workflows
            try:
                logger.debug(f"VAE connected with image, encoding output_image")
                pixels = output_image
                if pixels.shape[3] > 3:
                    pixels = pixels[:, :, :, :3]
                if not pixels.is_contiguous():
                    pixels = pixels.contiguous()

                logger.debug(f"  Calling vae.encode() with shape {pixels.shape}")
                encoded = vae.encode(pixels)
                latent = {"samples": encoded}
                latent_source = "VAE Encoded"
                logger.debug(f"VAE encoding successful, latent shape: {latent['samples'].shape}")

                # img2img + img2noise: also generate image-shaped noise alongside VAE-encoded latent
                if use_image_for_noise_shape and image is not None:
                    if seed_active and actual_seed >= 0:
                        torch.manual_seed(actual_seed)
                    gaussian_noise = torch.randn_like(latent["samples"])

                    # Resize input image to latent spatial dims as pattern source
                    latent_h, latent_w = latent["samples"].shape[-2], latent["samples"].shape[-1]
                    latent_channels = latent["samples"].shape[1]
                    pattern_pixel = image.permute(0, 3, 1, 2)
                    pattern_resized = torch.nn.functional.interpolate(
                        pattern_pixel, size=(latent_h, latent_w), mode='bilinear', align_corners=False
                    )
                    if pattern_resized.shape[1] < latent_channels:
                        repeats = (latent_channels + pattern_resized.shape[1] - 1) // pattern_resized.shape[1]
                        pattern_resized = pattern_resized.repeat(1, repeats, 1, 1)[:, :latent_channels]
                    if gaussian_noise.ndim == 5:
                        pattern_resized = pattern_resized.unsqueeze(2)
                    pattern_resized = pattern_resized - pattern_resized.mean()

                    effective_blend = blend_strength if blend_strength > 0.0 else 0.15
                    shaped_noise = spectral_noise_blend(
                        pattern_resized, gaussian_noise,
                        alpha=effective_blend, cutoff=0.2
                    )
                    latent["noise"] = shaped_noise
                    latent["use_as_noise"] = True
                    latent_source = f"VAE Encoded + Image-Shaped Noise (blend={effective_blend})"
                    logger.debug(f"Layered img2img+img2noise: noise shape={shaped_noise.shape}")

            except Exception as e:
                import traceback
                logger.error(f"VAE encoding failed: {e}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                print(f"[SmartResCalc] WARNING: VAE encoding failed ({e}), using empty latent")
                latent = _create_latent(w, h, batch_size, vae=vae, device=self.device)
                latent_source = "Empty (VAE failed)"

        elif should_generate_raw_noise:
            # Path 2: Generate raw Gaussian noise in latent space (for sampler consumption)
            # NOT VAE-encoded — this is proper diffusion noise (torch.randn) that
            # samplers can use directly. The IMAGE output still shows the visual
            # noise pattern for preview purposes.
            #
            # Note: Decoding this latent via VAEDecode will produce random-looking output.
            # Use the IMAGE output to preview the noise pattern instead.

            # Build cache key that includes blend_strength and image_purpose routing
            # For img2noise, include image shape as a proxy for "same image" detection
            # (we can't hash the full tensor efficiently, but shape change = different image)
            image_shape_key = tuple(image.shape) if (use_image_for_noise_shape and image is not None) else None
            noise_cache_key = (cache_key, blend_strength, use_image_for_noise_shape,
                               noise_shape_transform, image_shape_key)

            # Check cache first
            if (self._noise_cache_key == noise_cache_key and self._noise_cache_latent is not None):
                latent = self._noise_cache_latent
                blend_label = f" blend={blend_strength}" if blend_strength > 0 else ""
                latent_source = f"Raw Noise ({fill_type}{blend_label}) [cached]"
                logger.debug(f"Using cached raw noise latent")
                print(f"[SmartResCalc] Using cached noise latent (skipping regeneration)")
            else:
                logger.debug(f"Noise cache miss: stored={self._noise_cache_key}, current={noise_cache_key}")
                # Create the latent shape (handles 5D for video VAEs)
                latent = _create_latent(w, h, batch_size, vae=vae, device=self.device)

                # Seed and fill with Gaussian noise instead of zeros
                if seed_active and actual_seed >= 0:
                    torch.manual_seed(actual_seed)
                gaussian_noise = torch.randn_like(latent["samples"])

                # Determine if spectral blending should run:
                # - blend_strength > 0 with fill_type noise (current behavior)
                # - use_image_for_noise_shape with connected image (img2noise)
                should_spectral_blend = (
                    blend_strength > 0.0
                    or (use_image_for_noise_shape and image is not None)
                )

                if should_spectral_blend:
                    # Spectral blending: inject spatial structure into noise
                    latent_h, latent_w = latent["samples"].shape[-2], latent["samples"].shape[-1]
                    latent_channels = latent["samples"].shape[1]

                    # Choose pattern source: input image (img2noise) or fill_type output
                    if use_image_for_noise_shape and image is not None:
                        # img2noise: transform INPUT IMAGE per output_image_mode, then use as pattern
                        transform_mode = noise_shape_transform or "transform (distort)"
                        if transform_mode == "transform (distort)":
                            transformed = _transform_image(image, w, h)
                        elif transform_mode == "transform (crop/pad)":
                            transformed = _transform_image_crop_pad(image, w, h, fill_type, fill_color, fill_image)
                        elif transform_mode == "transform (scale/crop)":
                            transformed = _transform_image_scale_crop(image, w, h)
                        elif transform_mode == "transform (scale/pad)":
                            transformed = _transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image)
                        else:
                            transformed = _transform_image(image, w, h)
                        pattern_pixel = transformed.permute(0, 3, 1, 2)  # [B, C, H, W]
                        pattern_label = f"image ({transform_mode})"
                        logger.debug(f"img2noise: transformed input image via '{transform_mode}' to {w}x{h}")
                        # For img2noise, use blend_strength if set, otherwise default to 0.15
                        effective_blend = blend_strength if blend_strength > 0.0 else 0.15
                    else:
                        # Standard: use fill_type noise as pattern source
                        pattern_pixel = output_image.permute(0, 3, 1, 2)  # [B, 3, H, W]
                        pattern_label = fill_type
                        effective_blend = blend_strength

                    # Resize to latent spatial dims
                    pattern_resized = torch.nn.functional.interpolate(
                        pattern_pixel, size=(latent_h, latent_w), mode='bilinear', align_corners=False
                    )

                    # Expand/tile to match latent channel count (e.g., 3 RGB → 16 latent channels)
                    if pattern_resized.shape[1] < latent_channels:
                        repeats = (latent_channels + pattern_resized.shape[1] - 1) // pattern_resized.shape[1]
                        pattern_resized = pattern_resized.repeat(1, repeats, 1, 1)[:, :latent_channels]

                    # Handle 5D video latents: add temporal dim
                    if gaussian_noise.ndim == 5:
                        pattern_resized = pattern_resized.unsqueeze(2)  # [B, C, 1, h, w]

                    # Normalize pattern to zero-mean before blending
                    pattern_resized = pattern_resized - pattern_resized.mean()

                    # Apply spectral blending
                    latent["samples"] = spectral_noise_blend(
                        pattern_resized, gaussian_noise,
                        alpha=effective_blend, cutoff=0.2
                    )
                    blend_label = f" blend={effective_blend}"
                    if use_image_for_noise_shape and image is not None:
                        latent_source = f"Image-Shaped Noise ({pattern_label}{blend_label})"
                    else:
                        latent_source = f"Spectral Noise ({pattern_label}{blend_label})"
                    logger.debug(f"Spectral blend: source={pattern_label}, alpha={effective_blend}, cutoff=0.2, "
                                 f"shape={latent['samples'].shape}, "
                                 f"mean={latent['samples'].mean():.4f}, std={latent['samples'].std():.4f}")
                else:
                    # Pure Gaussian noise (no blending)
                    latent["samples"] = gaussian_noise
                    latent_source = f"Raw Noise ({fill_type})"
                    logger.debug(f"Generated raw latent noise: shape={latent['samples'].shape}, "
                                 f"mean={latent['samples'].mean():.4f}, std={latent['samples'].std():.4f}")

                latent["use_as_noise"] = True

                # Cache for reuse
                self._noise_cache_key = noise_cache_key
                self._noise_cache_latent = latent
        else:
            # Generate empty latent for txt2img workflows (backward compatible)
            # Reasons: VAE not connected, or fill is trivial (black/white/custom_color)
            logger.debug(f"Generating empty latent (txt2img workflow)")
            latent = _create_latent(w, h, batch_size, vae=vae, device=self.device)
            latent_source = "Empty"

        return latent, latent_source

    # ============================================================================
    # Image creation and transformation methods
    # EXTRACTED to image_utils.py for modularity and reuse.
    # Imported at module level as _create_empty_image, _transform_image, etc.
    # ============================================================================

    # create_preview_image and create_latent extracted to image_utils.py

NODE_CLASS_MAPPINGS = {
    "SmartResolutionCalc": SmartResolutionCalc,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SmartResolutionCalc": "Smart Resolution Calculator",
}
