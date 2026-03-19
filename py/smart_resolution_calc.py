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
        # Force re-execution when seed is active to prevent stale cache
        # This is needed because noise fills are non-deterministic (or seeded),
        # and ComfyUI's cache doesn't know about our internal RNG state
        fill_seed = kwargs.get('fill_seed')
        if fill_seed is not None and isinstance(fill_seed, dict):
            if fill_seed.get('on', False):
                return float("NaN")  # Always re-execute when seed is active
        return ""  # Default: let ComfyUI cache normally

    @staticmethod
    def get_image_dimensions_from_path(image_path):
        """
        Extract image dimensions from a file path using PIL.

        Security: Validates path is within ComfyUI directories before reading.
        Handles both full paths and filenames (searches in input directory).

        Args:
            image_path: Absolute path, relative path, or filename

        Returns:
            dict: {'width': int, 'height': int, 'success': bool, 'error': str}
        """
        try:
            import folder_paths

            # Check for directory traversal attempts early
            if '..' in image_path:
                logger.warning(f"Rejected path with traversal attempt: {image_path}")
                return {
                    'success': False,
                    'error': 'Invalid path'
                }

            # If image_path is just a filename (no path separators), look in input directory
            if not os.path.dirname(image_path):
                # Just a filename - construct path in input directory
                input_dir = folder_paths.get_input_directory()
                abs_path = os.path.join(input_dir, image_path)
                logger.debug(f"Filename detected, using input directory: {abs_path}")
            else:
                # Has directory components - normalize as absolute path
                abs_path = os.path.abspath(image_path)

            # Security: Only allow paths within ComfyUI directories
            allowed_dirs = [
                os.path.abspath(folder_paths.get_input_directory()),
                os.path.abspath(folder_paths.get_output_directory()),
                os.path.abspath(folder_paths.get_temp_directory()),
            ]

            # Check if path is within allowed directories
            is_allowed = any(abs_path.startswith(allowed_dir) for allowed_dir in allowed_dirs)

            if not is_allowed:
                logger.warning(f"Rejected path outside allowed directories: {abs_path}")
                return {
                    'success': False,
                    'error': 'Path outside allowed directories'
                }

            # Check file exists
            if not os.path.exists(abs_path):
                logger.debug(f"File not found: {abs_path}")
                return {
                    'success': False,
                    'error': f'File not found: {os.path.basename(abs_path)}'
                }

            # Read image dimensions using PIL
            with Image.open(abs_path) as img:
                width, height = img.size
                logger.debug(f"Successfully read dimensions: {width}×{height} from {abs_path}")
                return {
                    'width': width,
                    'height': height,
                    'success': True
                }

        except Exception as e:
            logger.error(f"Error reading image dimensions: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    @staticmethod
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
                            image=None, vae=None, output_image_mode="auto", fill_type="black",
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
                 • If provided: Encodes output_image to latent (img2img workflow)
                 • If None: Generates empty latent (txt2img workflow)
            output_image_mode: Image output transformation mode
            fill_type: Fill pattern for empty images
            fill_color: Hex color for custom fill
            fill_seed: Seed widget data {on: bool, value: number} for noise RNG (hidden)
                 • on=True: Seeds RNG for reproducible noise fills
                 • on=False: Passthrough, no RNG seeding
            **kwargs: Widget data from JavaScript containing dimension toggles

        kwargs contains widget data from JavaScript:
        {
            'dimension_megapixel': {'on': True, 'value': 1.0},
            'dimension_width': {'on': False, 'value': 1920},
            'dimension_height': {'on': True, 'value': 1080},
            'image_mode': {'on': True, 'value': 0},  # 0=AR Only, 1=Exact Dims
        }

        Priority order (first match wins):
        1. Width + Height → calculate megapixels, infer aspect ratio
        2. Width + Aspect Ratio → calculate height, then megapixels
        3. Height + Aspect Ratio → calculate width, then megapixels
        4. Megapixels + Aspect Ratio → calculate both dimensions
        5. None active → default to 1.0 MP + aspect ratio

        Returns:
            Tuple: (megapixels, width, height, seed, preview, image, latent, info)
        """

        # ALWAYS log that function was called (critical diagnostic)
        print(f"[SmartResCalc] calculate_dimensions() CALLED - aspect_ratio={aspect_ratio}, divisible_by={divisible_by}")

        # Debug logging for kwargs
        logger.debug(f"Function called with standard args: aspect_ratio={aspect_ratio}, divisible_by={divisible_by}, custom_ratio={custom_ratio}")
        logger.debug(f"kwargs keys received: {list(kwargs.keys())}")
        logger.debug(f"kwargs contents: {kwargs}")

        # Image input handling - extract dimensions from connected image
        # image_mode widget: {on: bool, value: 0|1} - 0=AR Only, 1=Exact Dims
        mode_info = None
        override_warning = False
        image_mode = kwargs.get('image_mode', {'on': False, 'value': 0})  # Default: DISABLED, AR Only
        use_image = image_mode.get('on', False) if isinstance(image_mode, dict) else False
        exact_dims = image_mode.get('value', 0) == 1 if isinstance(image_mode, dict) else False

        # Debug: Log image_mode state
        logger.debug(f"image_mode from kwargs: {image_mode}, use_image={use_image}, exact_dims={exact_dims}, image={'connected' if image is not None else 'None'}")

        if image is not None and use_image:
            # Extract dimensions from first image in batch
            # Image tensor shape: [batch, height, width, channels]
            h, w = image.shape[1], image.shape[2]
            actual_ar = self.format_aspect_ratio(w, h)

            logger.debug(f"Image input detected: {w}×{h}, AR: {actual_ar}, mode={image_mode}")

            if exact_dims:
                # Check if manual WIDTH or HEIGHT settings will be overridden
                manual_width = kwargs.get('dimension_width', {}).get('on', False)
                manual_height = kwargs.get('dimension_height', {}).get('on', False)
                if manual_width or manual_height:
                    override_warning = True
                    logger.debug(f"Override warning: Manual W/H settings detected but will be ignored in exact dims mode")

                # Force Width+Height mode with extracted dimensions
                # Apply scale to extracted dimensions
                kwargs['dimension_width'] = {'on': True, 'value': int(w * scale)}
                kwargs['dimension_height'] = {'on': True, 'value': int(h * scale)}
                mode_info = f"From Image (Exact: {w}×{h})"
                if scale != 1.0:
                    mode_info += f" @ {scale}x"
                logger.debug(f"Exact dimensions mode: forcing width={int(w * scale)}, height={int(h * scale)}")
            else:
                # Extract AR only, use with current megapixel calculation
                custom_ratio = True
                custom_aspect_ratio = actual_ar
                mode_info = f"From Image (AR: {actual_ar})"
                logger.debug(f"AR extraction mode: using AR {actual_ar} with existing megapixel logic")

        # Extract widget toggle states and values
        use_mp = kwargs.get('dimension_megapixel', {}).get('on', False)
        megapixel_val = float(kwargs.get('dimension_megapixel', {}).get('value', 1.0))

        use_width = kwargs.get('dimension_width', {}).get('on', False)
        width_val = int(kwargs.get('dimension_width', {}).get('value', 1920))

        use_height = kwargs.get('dimension_height', {}).get('on', False)
        height_val = int(kwargs.get('dimension_height', {}).get('value', 1080))

        # Debug: Log extracted widget values
        logger.debug(f"Extracted widget states: use_mp={use_mp} (val={megapixel_val}), use_width={use_width} (val={width_val}), use_height={use_height} (val={height_val})")

        # Get aspect ratio string
        if custom_ratio and custom_aspect_ratio:
            ratio_str = custom_aspect_ratio
            ratio_display = custom_aspect_ratio
        else:
            ratio_str = aspect_ratio.split(' ')[0]  # "3:4 (Golden Ratio)" → "3:4"
            ratio_display = ratio_str

        logger.debug(f"Aspect ratio: {ratio_str} (display: {ratio_display})")

        # Parse aspect ratio (supports floats for cinema ratios like 1.85:1, 2.39:1)
        try:
            parts = ratio_str.strip().split(':')
            if len(parts) != 2:
                raise ValueError(f"Invalid ratio format: '{ratio_str}' (expected 'width:height')")

            w_ratio = float(parts[0])
            h_ratio = float(parts[1])

            # Validate positive values
            if w_ratio <= 0:
                raise ValueError(f"Width ratio must be positive, got: {w_ratio}")
            if h_ratio <= 0:
                raise ValueError(f"Height ratio must be positive, got: {h_ratio}")

        except ValueError as e:
            # Fallback to default aspect ratio on error
            logger.error(f"Invalid custom aspect ratio '{ratio_str}': {e}")
            print(f"[SmartResCalc] ERROR: {e}. Using default 16:9.")
            w_ratio, h_ratio = 16.0, 9.0

        # Handle divisibility - "Exact" means no rounding (divisor=1)
        if divisible_by == "Exact":
            divisor = 1
        else:
            divisor = int(divisible_by)

        logger.debug(f"Parsed: w_ratio={w_ratio}, h_ratio={h_ratio}, divisor={divisor}")

        # ========================================
        # Use DimensionSourceCalculator for dimension calculation
        # ========================================
        # Build widgets dict from kwargs
        widgets = {
            'width_enabled': use_width,
            'width_value': width_val,
            'height_enabled': use_height,
            'height_value': height_val,
            'mp_enabled': use_mp,
            'mp_value': megapixel_val,
            'image_mode_enabled': use_image,
            'image_mode_value': 1 if exact_dims else 0,  # 0=AR Only, 1=Exact Dims
            'custom_ratio_enabled': custom_ratio,
            'custom_aspect_ratio': custom_aspect_ratio if custom_ratio else '16:9',
            'aspect_ratio_dropdown': aspect_ratio
        }

        # Build runtime context (includes image info if available)
        runtime_context = {}
        if image is not None and use_image:
            # Extract dimensions from first image in batch
            # Image tensor shape: [batch, height, width, channels]
            img_h, img_w = image.shape[1], image.shape[2]
            runtime_context['image_info'] = {
                'width': img_w,
                'height': img_h
            }

        # Create calculator and get dimension source
        calculator = DimensionSourceCalculator()
        result = calculator.calculate_dimension_source(widgets, runtime_context)

        # Handle pending states (image mode enabled but no image connected)
        # Fall back to defaults with dropdown AR when baseW/baseH are None
        if result['baseW'] is None or result['baseH'] is None:
            logger.warning(f"[Calculator] Pending state detected ({result['mode']}), falling back to defaults")
            print(f"[SmartResCalc] WARNING: Image mode enabled but no image connected - using defaults")
            # Recalculate without image mode to get valid dimensions
            widgets_fallback = widgets.copy()
            widgets_fallback['image_mode_enabled'] = False
            result = calculator.calculate_dimension_source(widgets_fallback, runtime_context)

        # Extract base dimensions and metadata from calculator result
        w = result['baseW']
        h = result['baseH']
        calculated_ar = f"{result['ar']['aspectW']}:{result['ar']['aspectH']}"

        # For ratio_display: use calculated AR (GCD-reduced from actual dimensions)
        ratio_display = calculated_ar

        # Mode for logging (internal description)
        mode = result['description']

        # Info detail base (will be enhanced with scale/div info below)
        if result['priority'] == 1:  # Exact Dims
            info_detail_base = f"From Image: {w}×{h}"
        elif result['priority'] == 2:  # MP+W+H Scalar
            info_detail_base = f"AR from W×H, scaled to {megapixel_val}MP"
        elif result['priority'] == 3:  # Explicit dimensions
            if result['mode'] == 'width_height_explicit':
                info_detail_base = f"Base W: {w} × H: {h}"
            elif result['mode'] == 'mp_width_explicit':
                info_detail_base = f"Calculated H: {h} from {megapixel_val}MP"
            elif result['mode'] == 'mp_height_explicit':
                info_detail_base = f"Calculated W: {w} from {megapixel_val}MP"
        elif result['priority'] == 4:  # AR Only
            # Show which dimension source is active and what was calculated
            active_sources = result.get('activeSources', [])
            if 'WIDTH' in active_sources:
                info_detail_base = f"WIDTH: {w}, calculated H: {h} from image AR {calculated_ar}"
            elif 'HEIGHT' in active_sources:
                info_detail_base = f"HEIGHT: {h}, calculated W: {w} from image AR {calculated_ar}"
            elif 'MEGAPIXEL' in active_sources:
                info_detail_base = f"Calculated {w}×{h} from {megapixel_val}MP and image AR {calculated_ar}"
            else:
                # defaults with image AR
                info_detail_base = f"Calculated {w}×{h} from default 1.0MP and image AR {calculated_ar}"
        elif result['priority'] == 5:  # Single dimension with AR
            if 'WIDTH' in result.get('activeSources', []):
                info_detail_base = f"Calculated H: {h}"
            elif 'HEIGHT' in result.get('activeSources', []):
                info_detail_base = f"Calculated W: {w}"
            elif 'MEGAPIXEL' in result.get('activeSources', []):
                info_detail_base = f"Calculated W: {w} × H: {h}"
        else:  # Priority 6: Defaults
            info_detail_base = f"W: {w} × H: {h}"

        logger.debug(f"Calculator result: mode={result['mode']}, priority={result['priority']}, baseW={w}, baseH={h}, AR={calculated_ar}")
        logger.debug(f"Mode description: {mode}")

        # Apply scale multiplier
        # Clamp scale to minimum 0.0 (user requirement: allow 0 but it's clamped by default)
        scale = max(0.0, scale)

        # Warn if scale is very high
        if scale > 7.0:
            logger.warning(f"Scale {scale}x exceeds recommended maximum (7x). This may cause out-of-memory errors.")
            print(f"[SmartResCalc] WARNING: Scale {scale}x is very high and may exceed GPU limits")

        # Apply scale to base dimensions (keep float precision for accurate divisibility rounding)
        w_scaled = w * scale
        h_scaled = h * scale

        # Warn if scaled dimensions exceed typical GPU limits
        if w_scaled > 16384 or h_scaled > 16384:
            logger.warning(f"Scaled dimensions {w_scaled:.1f}×{h_scaled:.1f} exceed typical GPU texture limits (16384px)")
            print(f"[SmartResCalc] WARNING: Dimensions {int(w_scaled)}×{int(h_scaled)} may exceed GPU limits")

        # Apply divisibility rounding (Python uses banker's rounding - rounds .5 to nearest even)
        # This matches the behavior after fixing JavaScript tooltip to use banker's rounding
        w = int(round(w_scaled / divisor) * divisor)
        h = int(round(h_scaled / divisor) * divisor)

        # Recalculate megapixels after scaling and rounding
        mp = (w * h) / 1_000_000

        # Build info detail string
        if scale != 1.0:
            info_detail = f"{info_detail_base} | Scale: {scale}x | Final: {w}×{h} | MP: {mp:.2f}"
        else:
            info_detail = f"{info_detail_base} | MP: {mp:.2f}"

        # Generate outputs
        resolution = f"{w} x {h}"  # Used for preview display and logging

        # ===== SEED RESOLUTION =====
        # The JS SeedWidget resolves special values (-1=random, -2=inc, -3=dec)
        # to actual seed numbers BEFORE sending to Python via serializeValue().
        # Python should always receive a real seed number (>= 0) when seed is ON.
        #
        # The -1/-2/-3 fallback below is VESTIGIAL — it exists only as a safety net
        # for edge cases where JS doesn't resolve (e.g., old workflows, direct API
        # calls). Under normal operation, this branch should never be hit.
        seed_active = False
        actual_seed = 0

        if fill_seed is not None and isinstance(fill_seed, dict):
            seed_active = fill_seed.get('on', False)
            seed_value = int(fill_seed.get('value', -1))

            if seed_active:
                if seed_value in (-1, -2, -3):
                    # VESTIGIAL: JS should have resolved these before sending.
                    # This fallback generates a Python-side random if JS didn't resolve.
                    # Under normal operation this branch should NOT be reached.
                    logger.warning(f"Received unresolved special seed value {seed_value} from JS — generating Python-side random (this is unexpected)")
                    actual_seed = py_random.randint(0, 1125899906842624)
                else:
                    actual_seed = seed_value

                logger.debug(f"Fill seed active: will seed RNG with {actual_seed}")
            else:
                # OFF mode: passthrough literal value, no RNG seeding
                actual_seed = seed_value
                logger.debug(f"Fill seed OFF: passthrough value {actual_seed}")
        else:
            # No seed data (backward compat with pre-v0.8.0 workflows)
            actual_seed = 0
            logger.debug("No fill_seed data, using default (unseeded)")

        # ===== PREVIEW OUTPUT (UNCHANGED) =====
        # Always generate preview grid visualization (1024x1024)
        # This output is NEVER modified - maintains exact current behavior
        preview = self.create_preview_image(w, h, resolution, ratio_display, mp)

        # ===== IMAGE OUTPUT =====
        # Seed RNG right before image generation (after preview, before noise fill)
        # This ensures the seeded state isn't consumed by preview or other code
        if seed_active and actual_seed >= 0:
            torch.manual_seed(actual_seed)
            py_random.seed(actual_seed)
            logger.debug(f"Seeded torch and py_random with {actual_seed} (right before image generation, py_random will determine DazNoise seed)")

        # DEBUG: Log actual values received from JS to diagnose Issue #8 corruption
        logger.debug(f"Inputs: output_image_mode='{output_image_mode}', fill_type='{fill_type}', fill_color='{fill_color}', seed_active={seed_active}, actual_seed={actual_seed}")

        # Smart defaults: "auto" mode selects based on input image presence
        # Widgets hidden by JavaScript when IMAGE output not connected
        actual_mode = output_image_mode
        if output_image_mode == "auto":
            # Apply smart defaults based on input image presence
            if image is not None:
                actual_mode = "transform (distort)"
                logger.debug("Smart default: 'auto' → 'transform (distort)' (input image detected)")
            else:
                actual_mode = "empty"
                logger.debug("Smart default: 'auto' → 'empty' (no input image)")

        # After determining actual_mode from "auto" or possibly mistaken user input
        # Guard: Transform modes require input image - force to empty if missing
        if actual_mode.startswith("transform") and image is None:
            logger.warning(f"Transform mode '{actual_mode}' requires input image, falling back to 'empty' mode")
            print(f"[SmartResCalc] WARNING: Transform mode requires input image, using empty image instead")
            actual_mode = "empty"

        # Generate actual image output based on mode
        logger.debug(f"actual_mode='{actual_mode}', about to generate image")

        # Cache key for noise generation (used by both image and latent caching)
        cache_key = (fill_type, actual_seed if seed_active else None, w, h, batch_size,
                     fill_image is not None)

        if actual_mode == "empty":
            if self._noise_cache_key == cache_key and self._noise_cache_image is not None:
                output_image = self._noise_cache_image
                logger.debug(f"Using cached noise image ({fill_type}, seed={actual_seed}, {w}x{h})")
                print(f"[SmartResCalc] Using cached noise image (skipping {fill_type} generation)")
            else:
                # Generate image with specified fill pattern at calculated dimensions
                logger.debug(f"Calling create_empty_image({w}, {h}, '{fill_type}', ...)")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)
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
                output_image = self.transform_image(image, w, h)
                logger.debug(f"Transformed (distort) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (distort) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        elif actual_mode == "transform (crop/pad)":
            if image is not None:
                # No scaling - crop if larger, pad if smaller
                output_image = self.transform_image_crop_pad(image, w, h, fill_type, fill_color, fill_image)
                logger.debug(f"Transformed (crop/pad) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (crop/pad) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        elif actual_mode == "transform (scale/crop)":
            if image is not None:
                # Scale to cover target (maintaining AR), crop excess
                output_image = self.transform_image_scale_crop(image, w, h)
                logger.debug(f"Transformed (scale/crop) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (scale/crop) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        elif actual_mode == "transform (scale/pad)":
            if image is not None:
                # Scale to fit inside target (maintaining AR), pad remainder
                output_image = self.transform_image_scale_pad(image, w, h, fill_type, fill_color, fill_image)
                logger.debug(f"Transformed (scale/pad) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (scale/pad) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        else:  # Safety fallback for invalid mode values
            logger.warning(f"Invalid output_image_mode '{actual_mode}', using empty image")
            output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size, fill_image)

        # ===== LATENT OUTPUT (VAE ENCODING SUPPORT) =====
        # Three paths:
        # 1. VAE + image + transform mode → encode transformed image
        # 2. VAE + non-trivial fill (noise/DazNoise/random/fill_image) → encode filled image
        # 3. Otherwise → empty latent (zeros)
        latent_source = "Empty"  # Default for info output

        # Determine if fill content is worth VAE-encoding
        # Trivial fills (black/white/custom_color) produce uniform images that don't benefit
        # from VAE encoding — use zeros latent instead (faster, equivalent for KSampler)
        has_nontrivial_fill = (
            fill_image is not None
            or fill_type in ("noise", "random")
            or fill_type.startswith("DazNoise:")
        )

        # Three latent output paths:
        # 1. Image attached + VAE → VAE-encode the transformed image (img2img)
        # 2. No image + noise fill + VAE → raw latent noise (txt2img with seed control)
        # 3. Otherwise → empty zeros latent
        should_vae_encode_image = (
            vae is not None and image is not None and actual_mode != "empty"
        )
        should_generate_raw_noise = (
            vae is not None and image is None and has_nontrivial_fill
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

            except Exception as e:
                import traceback
                logger.error(f"VAE encoding failed: {e}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                print(f"[SmartResCalc] WARNING: VAE encoding failed ({e}), using empty latent")
                latent = self.create_latent(w, h, batch_size, vae=vae)
                latent_source = "Empty (VAE failed)"

        elif should_generate_raw_noise:
            # Path 2: Generate raw Gaussian noise in latent space (for sampler consumption)
            # NOT VAE-encoded — this is proper diffusion noise (torch.randn) that
            # samplers can use directly. The IMAGE output still shows the visual
            # noise pattern for preview purposes.
            #
            # Note: Decoding this latent via VAEDecode will produce random-looking output.
            # Use the IMAGE output to preview the noise pattern instead.

            # Build cache key that includes blend_strength
            noise_cache_key = (cache_key, blend_strength)

            # Check cache first
            if (self._noise_cache_key == noise_cache_key and self._noise_cache_latent is not None):
                latent = self._noise_cache_latent
                blend_label = f" blend={blend_strength}" if blend_strength > 0 else ""
                latent_source = f"Raw Noise ({fill_type}{blend_label}) [cached]"
                logger.debug(f"Using cached raw noise latent")
            else:
                # Create the latent shape (handles 5D for video VAEs)
                latent = self.create_latent(w, h, batch_size, vae=vae)

                # Seed and fill with Gaussian noise instead of zeros
                if seed_active and actual_seed >= 0:
                    torch.manual_seed(actual_seed)
                gaussian_noise = torch.randn_like(latent["samples"])

                if blend_strength > 0.0:
                    # Spectral blending: inject spatial structure from noise pattern
                    # Resize output_image to latent spatial dimensions as pattern source
                    latent_h, latent_w = latent["samples"].shape[-2], latent["samples"].shape[-1]
                    latent_channels = latent["samples"].shape[1]

                    # output_image is [B, H, W, C] (ComfyUI format) — convert to [B, C, h, w]
                    pattern_pixel = output_image.permute(0, 3, 1, 2)  # [B, 3, H, W]

                    # Resize to latent spatial dims
                    pattern_resized = torch.nn.functional.interpolate(
                        pattern_pixel, size=(latent_h, latent_w), mode='bilinear', align_corners=False
                    )  # [B, 3, latent_h, latent_w]

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
                        alpha=blend_strength, cutoff=0.2
                    )
                    blend_label = f" blend={blend_strength}"
                    latent_source = f"Spectral Noise ({fill_type}{blend_label})"
                    logger.debug(f"Spectral blend: alpha={blend_strength}, cutoff=0.2, "
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
            latent = self.create_latent(w, h, batch_size, vae=vae)
            latent_source = "Empty"

        # Format divisibility info
        div_info = "Exact" if divisible_by == "Exact" else str(divisor)

        # Calculate actual AR from final base dimensions (before scale/rounding)
        # This shows the true aspect ratio regardless of calculation method
        calculated_ar = self.format_aspect_ratio(w, h)

        # Use calculator result for mode display
        # The calculator already provides the complete mode description
        mode_display = result['description']

        logger.debug(f"Mode display from calculator: '{mode_display}' (priority={result['priority']}, mode={result['mode']}, conflicts={len(result['conflicts'])})")

        # Build base info string
        base_info = f"Mode: {mode_display} | {info_detail}"

        # Add AR if not already present in mode_display or info_detail
        # Use regex for word boundaries to avoid matching "Scalar", "Barcelona", etc.
        import re
        info_so_far = base_info.lower()
        has_ar_mention = (
            re.search(r'\bar\b', info_so_far) or  # "ar" as standalone word (e.g., " ar ", "ar:", "(ar)")
            'image ar' in info_so_far or          # "image ar" phrase
            'image_ar' in info_so_far             # "image_ar" identifier
        )

        # Format seed info for display (only when seed is active/ON)
        seed_info = f"Seed: {actual_seed}" if seed_active else ""

        if not has_ar_mention:
            # AR not mentioned yet, add it explicitly
            info = f"{base_info} | AR: {calculated_ar} | Div: {div_info} | Latent: {latent_source}"
        else:
            # AR already mentioned in mode or detail, don't duplicate
            info = f"{base_info} | Div: {div_info} | Latent: {latent_source}"

        if seed_info:
            info = f"{info} | {seed_info}"

        # Add override warning if exact dims mode overrides manual settings
        if exact_dims and override_warning:
            info = f"⚠️ [Manual W/H Ignored] | {info}"

        # ALWAYS log final results
        print(f"[SmartResCalc] RESULT: {info}, resolution={resolution}")
        logger.debug(f"Returning: mp={mp}, w={w}, h={h}, resolution={resolution}, info={info}")

        # Return: (megapixels, width, height, seed, PREVIEW, IMAGE, latent, info)
        return (mp, w, h, actual_seed, preview, output_image, latent, info)

    def create_empty_image(
        self,
        width: int,
        height: int,
        fill_type: str = "black",
        fill_color: str = "#808080",
        batch_size: int = 1,
        fill_image: torch.Tensor = None
    ) -> torch.Tensor:
        """
        Create empty image with specified fill pattern.

        Args:
            width: Image width in pixels
            height: Image height in pixels
            fill_type: Fill pattern - "black", "white", "custom_color", "noise", "random",
                       or DazNoise types when dazzle-comfy-plasma-fast is available
            fill_color: Hex color string for "custom_color" mode (e.g., "#FF0000")
            batch_size: Number of images in batch
            fill_image: Optional custom fill image tensor. When provided, overrides fill_type.

        Returns:
            Tensor of shape [batch_size, height, width, 3] with values 0.0-1.0
        """
        # Priority: fill_image overrides fill_type when connected
        if fill_image is not None:
            # Scale the fill_image to target dimensions
            image = self.transform_image(fill_image, width, height)
            # Handle batch size mismatch
            if image.shape[0] < batch_size:
                image = image.repeat(batch_size, 1, 1, 1)[:batch_size]
            logger.debug(f"Using fill_image ({fill_image.shape[2]}x{fill_image.shape[1]}) scaled to {width}x{height}")
            return image

        # Create base tensor
        if fill_type == "black":
            # All zeros (black)
            image = torch.zeros((batch_size, height, width, 3))

        elif fill_type == "white":
            # All ones (white)
            image = torch.ones((batch_size, height, width, 3))

        elif fill_type == "custom_color":
            # Parse hex color to RGB (0.0-1.0 range)
            try:
                color_hex = fill_color.strip()
                if not color_hex.startswith('#'):
                    color_hex = '#' + color_hex

                r = int(color_hex[1:3], 16) / 255.0
                g = int(color_hex[3:5], 16) / 255.0
                b = int(color_hex[5:7], 16) / 255.0
            except (ValueError, IndexError):
                # Fallback to gray on invalid color
                logger.warning(f"Invalid hex color '{fill_color}', using gray")
                r, g, b = 0.5, 0.5, 0.5

            # Fill with custom color
            image = torch.zeros((batch_size, height, width, 3))
            image[:, :, :, 0] = r
            image[:, :, :, 1] = g
            image[:, :, :, 2] = b

        elif fill_type == "noise":
            # Gaussian noise (mean=0.5, std=0.1)
            image = torch.randn((batch_size, height, width, 3)) * 0.1 + 0.5
            image = torch.clamp(image, 0.0, 1.0)

        elif fill_type == "random":
            # Uniform random values [0.0, 1.0]
            image = torch.rand((batch_size, height, width, 3))

        elif fill_type.startswith("DazNoise:"):
            # Extended noise from dazzle-comfy-plasma-fast
            noise_tensor = _generate_daznoise(fill_type, width, height)
            if noise_tensor is not None:
                # Generator returns (1, H, W, 3) — repeat for batch
                if batch_size > 1:
                    image = noise_tensor.repeat(batch_size, 1, 1, 1)
                else:
                    image = noise_tensor
            else:
                # Fallback: dazzle-comfy-plasma-fast unavailable at execution time
                logger.warning(f"'{fill_type}' requires dazzle-comfy-plasma-fast (not found), using Gaussian noise")
                print(f"[SmartResCalc] WARNING: {fill_type} unavailable, falling back to Gaussian noise")
                image = torch.randn((batch_size, height, width, 3)) * 0.1 + 0.5
                image = torch.clamp(image, 0.0, 1.0)

        else:
            # Fallback to black for unknown types
            logger.warning(f"Unknown fill_type '{fill_type}', using black")
            image = torch.zeros((batch_size, height, width, 3))

        return image

    def transform_image(self, image: torch.Tensor, target_width: int, target_height: int) -> torch.Tensor:
        """
        Transform input image to target dimensions using bilinear interpolation (distort mode).
        Scales image to exactly fit target dimensions without preserving aspect ratio.

        Args:
            image: Input tensor [batch, height, width, channels]
            target_width: Target width in pixels
            target_height: Target height in pixels

        Returns:
            Transformed tensor [batch, target_height, target_width, channels]
        """
        # Convert NHWC -> NCHW for interpolate
        samples = image.movedim(-1, 1)

        # Use ComfyUI's standard upscale function
        # Method: "bilinear" (fast, good quality, general purpose)
        # Crop: "disabled" (scale to fit, no cropping)
        output = comfy.utils.common_upscale(
            samples,
            target_width,
            target_height,
            "bilinear",
            "disabled"
        )

        # Convert back NCHW -> NHWC
        output = output.movedim(1, -1)

        return output

    def transform_image_scale_pad(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int,
        fill_type: str = "black",
        fill_color: str = "#808080",
        fill_image: torch.Tensor = None
    ) -> torch.Tensor:
        """
        Transform input image to target dimensions using scale/pad strategy.
        Scales image to fit within target, then pads to reach exact dimensions.

        Strategy:
        - Scale image to fit INSIDE target dimensions (maintaining aspect ratio)
        - Center the scaled image within target canvas
        - Pad remaining space with specified fill pattern
        - Result always matches target dimensions exactly

        Args:
            image: Input tensor [batch, height, width, channels]
            target_width: Target width in pixels
            target_height: Target height in pixels
            fill_type: Fill pattern for padding areas
            fill_color: Hex color for custom_color fill
            fill_image: Optional custom fill image tensor

        Returns:
            Transformed tensor [batch, target_height, target_width, channels]
        """
        batch_size, source_height, source_width, channels = image.shape

        # Calculate aspect ratios
        source_ar = source_width / source_height
        target_ar = target_width / target_height

        logger.debug(f"Crop/pad transform: source={source_width}×{source_height} (AR={source_ar:.3f}), "
                    f"target={target_width}×{target_height} (AR={target_ar:.3f})")

        # Determine if we need to crop or pad
        if abs(source_ar - target_ar) < 0.001:
            # Aspect ratios match - simple scale to fit
            logger.debug("Aspect ratios match, scaling to fit")
            return self.transform_image(image, target_width, target_height)

        # Calculate scaled dimensions to fit inside target while maintaining AR
        if source_ar > target_ar:
            # Source is wider - fit to target width, height will be smaller
            scale_width = target_width
            scale_height = int(target_width / source_ar)
        else:
            # Source is taller - fit to target height, width will be smaller
            scale_height = target_height
            scale_width = int(target_height * source_ar)

        logger.debug(f"Scaling to {scale_width}×{scale_height} (fits within {target_width}×{target_height})")

        # Scale image to fit within target
        scaled = self.transform_image(image, scale_width, scale_height)

        # Create canvas with target dimensions filled with specified pattern
        # Use batch size from input image, not the parameter
        canvas = self.create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image)

        # Calculate centering offsets
        offset_x = (target_width - scale_width) // 2
        offset_y = (target_height - scale_height) // 2

        logger.debug(f"Centering scaled image at offset ({offset_x}, {offset_y})")

        # Place scaled image in center of canvas
        canvas[:, offset_y:offset_y+scale_height, offset_x:offset_x+scale_width, :] = scaled

        # Verify output dimensions
        assert canvas.shape[1] == target_height and canvas.shape[2] == target_width, \
            f"Output dimensions mismatch: got {canvas.shape[2]}×{canvas.shape[1]}, expected {target_width}×{target_height}"

        return canvas

    def transform_image_crop_pad(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int,
        fill_type: str = "black",
        fill_color: str = "#808080",
        fill_image: torch.Tensor = None
    ) -> torch.Tensor:
        """
        Transform input image to target dimensions using pure crop/pad (NO scaling).
        Crops dimensions larger than target, pads dimensions smaller than target.

        Strategy:
        - NO scaling applied - original image stays at 1:1 scale
        - If dimension > target: Center crop to target size
        - If dimension < target: Center and pad to target size
        - Result always matches target dimensions exactly

        Example: 1024×1024 → 1885×530
        - Width: 1024 < 1885, pad 430.5px left + 430.5px right
        - Height: 1024 > 530, crop 247px top + 247px bottom

        Args:
            image: Input tensor [batch, height, width, channels]
            target_width: Target width in pixels
            target_height: Target height in pixels
            fill_type: Fill pattern for padding areas
            fill_color: Hex color for custom_color fill
            fill_image: Optional custom fill image tensor

        Returns:
            Transformed tensor [batch, target_height, target_width, channels]
        """
        batch_size, source_height, source_width, channels = image.shape

        logger.debug(f"Crop/pad transform (no scaling): source={source_width}×{source_height}, "
                    f"target={target_width}×{target_height}")

        # Determine crop/pad for width
        if source_width == target_width:
            # Width matches - use original
            width_start = 0
            width_end = source_width
            pad_left = 0
            pad_right = 0
            logger.debug(f"Width matches target ({target_width})")
        elif source_width > target_width:
            # Width larger - center crop
            width_start = (source_width - target_width) // 2
            width_end = width_start + target_width
            pad_left = 0
            pad_right = 0
            logger.debug(f"Cropping width: {source_width} → {target_width} (crop from {width_start})")
        else:
            # Width smaller - will need padding
            width_start = 0
            width_end = source_width
            pad_left = (target_width - source_width) // 2
            pad_right = target_width - source_width - pad_left
            logger.debug(f"Padding width: {source_width} → {target_width} (pad left={pad_left}, right={pad_right})")

        # Determine crop/pad for height
        if source_height == target_height:
            # Height matches - use original
            height_start = 0
            height_end = source_height
            pad_top = 0
            pad_bottom = 0
            logger.debug(f"Height matches target ({target_height})")
        elif source_height > target_height:
            # Height larger - center crop
            height_start = (source_height - target_height) // 2
            height_end = height_start + target_height
            pad_top = 0
            pad_bottom = 0
            logger.debug(f"Cropping height: {source_height} → {target_height} (crop from {height_start})")
        else:
            # Height smaller - will need padding
            height_start = 0
            height_end = source_height
            pad_top = (target_height - source_height) // 2
            pad_bottom = target_height - source_height - pad_top
            logger.debug(f"Padding height: {source_height} → {target_height} (pad top={pad_top}, bottom={pad_bottom})")

        # Crop the image (if needed)
        cropped = image[:, height_start:height_end, width_start:width_end, :]

        # If no padding needed, we're done
        if pad_left == 0 and pad_right == 0 and pad_top == 0 and pad_bottom == 0:
            logger.debug("No padding needed, returning cropped image")
            return cropped

        # Create canvas with target dimensions
        canvas = self.create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image)

        # Place cropped image in canvas at correct position
        canvas[:, pad_top:pad_top+cropped.shape[1], pad_left:pad_left+cropped.shape[2], :] = cropped

        # Verify output dimensions
        assert canvas.shape[1] == target_height and canvas.shape[2] == target_width, \
            f"Output dimensions mismatch: got {canvas.shape[2]}×{canvas.shape[1]}, expected {target_width}×{target_height}"

        return canvas

    def transform_image_scale_crop(
        self,
        image: torch.Tensor,
        target_width: int,
        target_height: int
    ) -> torch.Tensor:
        """
        Transform input image to target dimensions using scale/crop strategy.
        Scales image to cover target completely, then crops excess.

        Strategy:
        - Scale image to COVER target dimensions (maintaining aspect ratio)
        - At least one dimension will match target exactly
        - Other dimension will be >= target
        - Center crop the excess
        - Result always matches target dimensions exactly

        Example: 1024×1024 → 1885×530
        - Scale to 1885×1885 (covers target width, maintains square AR)
        - Crop 677.5px from top + 677.5px from bottom

        Args:
            image: Input tensor [batch, height, width, channels]
            target_width: Target width in pixels
            target_height: Target height in pixels

        Returns:
            Transformed tensor [batch, target_height, target_width, channels]
        """
        batch_size, source_height, source_width, channels = image.shape

        # Calculate aspect ratios
        source_ar = source_width / source_height
        target_ar = target_width / target_height

        logger.debug(f"Scale/crop transform: source={source_width}×{source_height} (AR={source_ar:.3f}), "
                    f"target={target_width}×{target_height} (AR={target_ar:.3f})")

        # Check if aspect ratios match
        if abs(source_ar - target_ar) < 0.001:
            # Aspect ratios match - simple scale to fit
            logger.debug("Aspect ratios match, scaling to fit")
            return self.transform_image(image, target_width, target_height)

        # Calculate scaled dimensions to cover target while maintaining AR
        if source_ar > target_ar:
            # Source is wider - fit to target height, width will be larger
            scale_height = target_height
            scale_width = int(target_height * source_ar)
        else:
            # Source is taller - fit to target width, height will be larger
            scale_width = target_width
            scale_height = int(target_width / source_ar)

        logger.debug(f"Scaling to {scale_width}×{scale_height} (covers {target_width}×{target_height})")

        # Scale image to cover target
        scaled = self.transform_image(image, scale_width, scale_height)

        # Center crop to target dimensions
        if scale_width > target_width:
            # Crop width
            crop_left = (scale_width - target_width) // 2
            crop_right = crop_left + target_width
            output = scaled[:, :, crop_left:crop_right, :]
            logger.debug(f"Cropped width from {scale_width} to {target_width} (left={crop_left})")
        else:
            # Crop height
            crop_top = (scale_height - target_height) // 2
            crop_bottom = crop_top + target_height
            output = scaled[:, crop_top:crop_bottom, :, :]
            logger.debug(f"Cropped height from {scale_height} to {target_height} (top={crop_top})")

        # Verify output dimensions
        assert output.shape[1] == target_height and output.shape[2] == target_width, \
            f"Output dimensions mismatch: got {output.shape[2]}×{output.shape[1]}, expected {target_width}×{target_height}"

        return output

    def create_preview_image(self, width, height, resolution, ratio_display, megapixels):
        """
        Create preview image showing aspect ratio box with dimensions.
        Based on controlaltai-nodes implementation.
        """
        # 1024x1024 preview size
        preview_size = (1024, 1024)
        image = Image.new('RGB', preview_size, (0, 0, 0))  # Black background
        draw = ImageDraw.Draw(image)

        # Draw grid with grey lines
        grid_color = '#333333'
        grid_spacing = 50
        for x in range(0, preview_size[0], grid_spacing):
            draw.line([(x, 0), (x, preview_size[1])], fill=grid_color)
        for y in range(0, preview_size[1], grid_spacing):
            draw.line([(0, y), (preview_size[0], y)], fill=grid_color)

        # Calculate preview box dimensions (maintain aspect ratio)
        preview_width = 800
        preview_height = int(preview_width * (height / width))

        # Adjust if height is too tall
        if preview_height > 800:
            preview_height = 800
            preview_width = int(preview_height * (width / height))

        # Calculate center position
        x_offset = (preview_size[0] - preview_width) // 2
        y_offset = (preview_size[1] - preview_height) // 2

        # Draw the aspect ratio box with red outline
        draw.rectangle(
            [(x_offset, y_offset), (x_offset + preview_width, y_offset + preview_height)],
            outline='red',
            width=4
        )

        # Add text with dimension info
        try:
            # Resolution text in center (red)
            text_y = y_offset + preview_height // 2
            draw.text(
                (preview_size[0] // 2, text_y),
                f"{width}x{height}",
                fill='red',
                anchor="mm",
                font=ImageFont.truetype("arial.ttf", 48)
            )

            # Aspect ratio text below resolution (red)
            draw.text(
                (preview_size[0] // 2, text_y + 60),
                f"({ratio_display})",
                fill='red',
                anchor="mm",
                font=ImageFont.truetype("arial.ttf", 36)
            )

            # Megapixels text at bottom (white)
            draw.text(
                (preview_size[0] // 2, y_offset + preview_height + 60),
                f"{megapixels:.2f} MP",
                fill='white',
                anchor="mm",
                font=ImageFont.truetype("arial.ttf", 32)
            )

        except:
            # Fallback if font loading fails (non-Windows systems)
            draw.text((preview_size[0] // 2, text_y), f"{width}x{height}", fill='red', anchor="mm")
            draw.text((preview_size[0] // 2, text_y + 60), f"({ratio_display})", fill='red', anchor="mm")
            draw.text((preview_size[0] // 2, y_offset + preview_height + 60), f"{megapixels:.2f} MP", fill='white', anchor="mm")

        # Convert to tensor
        return pil2tensor(image)

    def create_latent(self, width, height, batch_size=1, vae=None):
        """
        Create empty latent tensor compatible with the connected model.

        Queries the VAE for both latent_channels and spatial compression ratio
        to support all model types (SD1.5=4ch/8x, FLUX=16ch/8x, patchified
        VAEs=16ch/16x, Cascade=16ch/32x, etc.). Falls back to 4 channels and
        8x spatial when no VAE is connected (matches ComfyUI EmptyLatentImage).

        Format depends on VAE type:
        - 2D VAEs (SD1.5, FLUX, etc.): [batch, channels, h//spatial, w//spatial]
        - 3D/Video VAEs (Wan, Qwen, etc.): [batch, channels, 1, h//spatial, w//spatial]
        """
        channels = 4
        spatial_divisor = 8
        if vae is not None:
            if hasattr(vae, 'latent_channels'):
                channels = vae.latent_channels
            if hasattr(vae, 'spacial_compression_encode'):
                spatial_divisor = vae.spacial_compression_encode()

        latent_h = height // spatial_divisor
        latent_w = width // spatial_divisor

        # Video/3D VAEs (Wan, Qwen, Hunyuan Video) have latent_dim=3 and expect
        # 5D tensors with a temporal dimension. For single-image generation we use
        # temporal=1. Without this, VAE.decode() crashes because its memory_used_decode
        # lambda accesses shape[4] which doesn't exist on a 4D tensor.
        if vae is not None and getattr(vae, 'latent_dim', 2) == 3:
            latent = torch.zeros([batch_size, channels, 1, latent_h, latent_w], device=self.device)
            logger.debug(f"Created 5D latent for video VAE: {latent.shape} (latent_dim=3)")
        else:
            latent = torch.zeros([batch_size, channels, latent_h, latent_w], device=self.device)
            logger.debug(f"Created 4D latent: {latent.shape}")

        return {"samples": latent, "downscale_ratio_spacial": spatial_divisor}


NODE_CLASS_MAPPINGS = {
    "SmartResolutionCalc": SmartResolutionCalc,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SmartResolutionCalc": "Smart Resolution Calculator",
}
