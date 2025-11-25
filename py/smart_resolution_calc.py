from PIL import Image, ImageDraw, ImageFont
import numpy as np
import torch
import comfy.model_management
import comfy.utils
import logging
import os
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


def pil2tensor(image):
    """Convert PIL image to tensor in the correct format"""
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)


class DimensionSourceCalculator:
    """
    Python equivalent of JavaScript DimensionSourceManager.

    Manages dimension source priority and aspect ratio determination.
    Implements complete state machine with 6 priority levels to resolve dimension/AR conflicts.

    Priority Hierarchy:
    1. USE IMAGE DIMS = Exact Dims (absolute override)
    2. MP + W + H (scalar with AR from W:H)
    3. Explicit Dimensions (W+H, MP+W, MP+H)
    4. USE IMAGE DIMS = AR Only
    5. Single dimension with AR (W/H/MP + AR source)
    6. Defaults with AR

    Related Issues: #15 (umbrella), #16 (implementation), #19 (Python parity)
    """

    def __init__(self):
        """Initialize dimension source calculator"""
        pass

    def calculate_dimension_source(self, widgets, runtime_context=None):
        """
        Determine active dimension source and calculate base dimensions.
        Returns complete calculation context including mode, dimensions, AR, conflicts.

        Args:
            widgets (dict): Widget state dictionary with keys:
                - width_enabled, width_value
                - height_enabled, height_value
                - mp_enabled, mp_value
                - image_mode_enabled, image_mode_value (0=AR Only, 1=Exact Dims)
                - custom_ratio_enabled
                - custom_aspect_ratio (text)
                - aspect_ratio_dropdown (dropdown selection)
            runtime_context (dict): Runtime data including:
                - image_info: dict with width, height (if image loaded)
                - exact_dims: bool (whether exact dims mode is active)

        Returns:
            dict: {
                'mode': str,           # e.g. "mp_width_explicit"
                'priority': int,       # 1-6
                'baseW': int,
                'baseH': int,
                'source': str,         # e.g. "widgets_mp_computed"
                'ar': dict,            # {ratio, aspectW, aspectH}
                'conflicts': list,     # [{type, severity, message, affectedWidgets}]
                'description': str,    # e.g. "MP+W: 1200×1250 (...)"
                'activeSources': list  # e.g. ['WIDTH', 'MEGAPIXEL']
            }
        """
        runtime_context = runtime_context or {}

        logger.debug(f'[Calculator] widgets: {widgets}')
        logger.debug(f'[Calculator] runtime_context: {runtime_context}')

        # PRIORITY 1: Exact Dims mode
        if widgets.get('image_mode_enabled') and widgets.get('image_mode_value') == 1:
            logger.debug('[Calculator] Taking Priority 1: Exact Dims')
            return self._calculate_exact_dims(widgets, runtime_context)

        # Check which dimension widgets are enabled
        has_mp = widgets.get('mp_enabled', False)
        has_width = widgets.get('width_enabled', False)
        has_height = widgets.get('height_enabled', False)

        logger.debug(f'[Calculator] has_mp: {has_mp}, has_width: {has_width}, has_height: {has_height}')

        # PRIORITY 2: WIDTH + HEIGHT + MEGAPIXEL (all three)
        if has_mp and has_width and has_height:
            logger.debug('[Calculator] Taking Priority 2: MP+W+H')
            return self._calculate_mp_scalar_with_ar(widgets)

        # PRIORITY 3: Explicit dimensions (three variants)
        if has_width and has_height:
            logger.debug('[Calculator] Taking Priority 3: W+H explicit')
            return self._calculate_width_height_explicit(widgets)
        if has_mp and has_width:
            logger.debug('[Calculator] Taking Priority 3: MP+W explicit')
            return self._calculate_mp_width_explicit(widgets)
        if has_mp and has_height:
            logger.debug('[Calculator] Taking Priority 3: MP+H explicit')
            return self._calculate_mp_height_explicit(widgets)

        # PRIORITY 4: AR Only mode (image AR + dimension widgets)
        # PRIORITY 4: AR Only mode
        if widgets.get('image_mode_enabled') and widgets.get('image_mode_value') == 0:
            logger.debug('[Calculator] Taking Priority 4: AR Only')
            return self._calculate_ar_only(widgets, runtime_context)

        # PRIORITY 5: Single dimension with AR
        if has_width:
            logger.debug('[Calculator] Taking Priority 5: Width with AR')
            return self._calculate_width_with_ar(widgets)
        if has_height:
            logger.debug('[Calculator] Taking Priority 5: Height with AR')
            return self._calculate_height_with_ar(widgets)
        if has_mp:
            logger.debug('[Calculator] Taking Priority 5: MP with AR')
            return self._calculate_mp_with_ar(widgets)

        # PRIORITY 6: Defaults
        logger.debug('[Calculator] Taking Priority 6: Defaults')
        return self._calculate_defaults(widgets)

    # ========================================
    # Priority Level Implementations
    # ========================================

    def _calculate_exact_dims(self, widgets, runtime_context):
        """Priority 1: USE IMAGE DIMS = Exact Dims

        Returns actual dimensions when image_info available, or pending state
        when user enabled Exact Dims but image data not yet available (e.g., generator nodes).
        """
        image_info = runtime_context.get('image_info')

        if not image_info:
            # User wants image dimensions but data unavailable (generator node, pre-execution)
            # Return pending state preserving user intent
            logger.debug('[Calculator] Exact Dims requested but image_info unavailable - returning pending state')
            return {
                'mode': 'exact_dims_pending',
                'priority': 1,
                'baseW': None,  # Explicitly None, not undefined
                'baseH': None,
                'source': 'image_pending',
                'ar': {
                    'aspectW': None,
                    'aspectH': None,
                    'ratio': None,
                    'source': 'image_pending'
                },
                'conflicts': [],
                'description': 'IMG Exact Dims (awaiting image data)',
                'activeSources': []
            }

        # Image info available - normal calculation
        w = image_info['width']
        h = image_info['height']
        ar = self._compute_ar_from_dimensions(w, h)

        return {
            'mode': 'exact_dims',
            'priority': 1,
            'baseW': w,
            'baseH': h,
            'source': 'image',
            'ar': ar,
            'conflicts': self._detect_conflicts('exact_dims', widgets),
            'description': 'USE IMAGE DIMS = Exact Dims (overrides all widgets)',
            'activeSources': []
        }

    def _calculate_mp_scalar_with_ar(self, widgets):
        """Priority 2: WIDTH + HEIGHT + MEGAPIXEL (scalar with AR from W:H)"""
        w = widgets['width_value']
        h = widgets['height_value']
        target_mp = widgets['mp_value'] * 1_000_000

        # Compute AR from WIDTH/HEIGHT
        ar = self._compute_ar_from_dimensions(w, h)

        # Scale to MEGAPIXEL target maintaining AR
        # Solve: scaledW × scaledH = targetMP, scaledW/scaledH = ar['ratio']
        import math
        scaled_h = math.sqrt(target_mp / ar['ratio'])
        scaled_w = scaled_h * ar['ratio']

        return {
            'mode': 'mp_scalar_with_ar',
            'priority': 2,
            'baseW': round(scaled_w),
            'baseH': round(scaled_h),
            'source': 'widgets_mp_scalar',
            'ar': ar,
            'conflicts': self._detect_conflicts('mp_scalar_with_ar', widgets),
            'description': f"MP+W+H: AR {ar['aspectW']}:{ar['aspectH']} from {w}×{h}, scaled to {widgets['mp_value']}MP",
            'activeSources': ['WIDTH', 'HEIGHT', 'MEGAPIXEL']
        }

    def _calculate_width_height_explicit(self, widgets):
        """Priority 3a: WIDTH + HEIGHT (both specified)"""
        w = widgets['width_value']
        h = widgets['height_value']
        ar = self._compute_ar_from_dimensions(w, h)

        return {
            'mode': 'width_height_explicit',
            'priority': 3,
            'baseW': w,
            'baseH': h,
            'source': 'widgets_explicit',
            'ar': ar,
            'conflicts': self._detect_conflicts('width_height_explicit', widgets),
            'description': f"Explicit dimensions: {w}×{h} (AR {ar['aspectW']}:{ar['aspectH']} implied)",
            'activeSources': ['WIDTH', 'HEIGHT']
        }

    def _calculate_mp_width_explicit(self, widgets):
        """Priority 3b: WIDTH + MEGAPIXEL → calculate height"""
        w = widgets['width_value']
        target_mp = widgets['mp_value'] * 1_000_000

        # Calculate: H = (MP × 1,000,000) / W
        h = round(target_mp / w) if w > 0 else 1080
        if w <= 0:
            logger.warning(f'[Calculator] Invalid width ({w}) in MP+W mode, using fallback H=1080')

        ar = self._compute_ar_from_dimensions(w, h)

        return {
            'mode': 'mp_width_explicit',
            'priority': 3,
            'baseW': w,
            'baseH': h,
            'source': 'widgets_mp_computed',
            'ar': ar,
            'conflicts': self._detect_conflicts('mp_width_explicit', widgets),
            'description': f"MP+W: {w}×{h} (H computed from {widgets['mp_value']}MP, AR {ar['aspectW']}:{ar['aspectH']} implied)",
            'activeSources': ['WIDTH', 'MEGAPIXEL']
        }

    def _calculate_mp_height_explicit(self, widgets):
        """Priority 3c: HEIGHT + MEGAPIXEL → calculate width"""
        h = widgets['height_value']
        target_mp = widgets['mp_value'] * 1_000_000

        # Calculate: W = (MP × 1,000,000) / H
        w = round(target_mp / h) if h > 0 else 1920
        if h <= 0:
            logger.warning(f'[Calculator] Invalid height ({h}) in MP+H mode, using fallback W=1920')

        ar = self._compute_ar_from_dimensions(w, h)

        return {
            'mode': 'mp_height_explicit',
            'priority': 3,
            'baseW': w,
            'baseH': h,
            'source': 'widgets_mp_computed',
            'ar': ar,
            'conflicts': self._detect_conflicts('mp_height_explicit', widgets),
            'description': f"MP+H: {w}×{h} (W computed from {widgets['mp_value']}MP, AR {ar['aspectW']}:{ar['aspectH']} implied)",
            'activeSources': ['HEIGHT', 'MEGAPIXEL']
        }

    def _get_primary_dimension_source(self, widgets):
        """
        Determine which dimension source would be active in AR Only mode.

        Returns the primary dimension source name based on widget state:
        - 'WIDTH' if width enabled
        - 'HEIGHT' if height enabled
        - 'MEGAPIXEL' if megapixel enabled
        - 'defaults' if no dimension widgets enabled

        Args:
            widgets: Widget state dictionary

        Returns:
            str: Dimension source name ('WIDTH', 'HEIGHT', 'MEGAPIXEL', or 'defaults')
        """
        if widgets.get('width_enabled', False):
            return 'WIDTH'
        elif widgets.get('height_enabled', False):
            return 'HEIGHT'
        elif widgets.get('mp_enabled', False):
            return 'MEGAPIXEL'
        else:
            return 'defaults'

    def _calculate_ar_only(self, widgets, runtime_context):
        """Priority 4: USE IMAGE DIMS = AR Only (image AR + dimension widgets)

        Returns image AR with dimension widget when image_info available, or pending state
        when user enabled AR Only but image data not yet available (e.g., generator nodes).
        """
        image_info = runtime_context.get('image_info')

        if not image_info:
            # User wants AR Only but data unavailable (generator node, pre-execution)
            # Return pending state preserving user intent
            dimension_source = self._get_primary_dimension_source(widgets)

            logger.debug(f'[Calculator] AR Only requested but image_info unavailable - returning pending state with {dimension_source}')

            return {
                'mode': 'ar_only_pending',
                'priority': 4,
                'baseW': None,  # Explicitly None, not undefined
                'baseH': None,
                'source': 'image_pending',
                'ar': {
                    'aspectW': None,
                    'aspectH': None,
                    'ratio': None,
                    'source': 'image_pending'
                },
                'conflicts': [],
                'description': f"{dimension_source} & IMG AR Only (awaiting image data)",
                'activeSources': [dimension_source] if dimension_source != 'defaults' else []
            }

        # Get image AR
        img_w = image_info['width']
        img_h = image_info['height']
        image_ar = self._compute_ar_from_dimensions(img_w, img_h)

        # Use image AR with dimension widgets
        has_width = widgets.get('width_enabled', False)
        has_height = widgets.get('height_enabled', False)
        has_mp = widgets.get('mp_enabled', False)

        if has_width:
            base_w = widgets['width_value']
            base_h = round(base_w / image_ar['ratio'])
            dimension_source = 'WIDTH'
        elif has_height:
            base_h = widgets['height_value']
            base_w = round(base_h * image_ar['ratio'])
            dimension_source = 'HEIGHT'
        elif has_mp:
            target_mp = widgets['mp_value'] * 1_000_000
            import math
            base_h = math.sqrt(target_mp / image_ar['ratio'])
            base_w = round(base_h * image_ar['ratio'])
            base_h = round(base_h)
            dimension_source = 'MEGAPIXEL'
        else:
            # No dimension widget, use defaults with image AR
            default_mp = 1.0 * 1_000_000
            import math
            base_h = math.sqrt(default_mp / image_ar['ratio'])
            base_w = round(base_h * image_ar['ratio'])
            base_h = round(base_h)
            dimension_source = 'defaults'

        return {
            'mode': 'ar_only',
            'priority': 4,
            'baseW': base_w,
            'baseH': base_h,
            'source': 'image_ar',
            'ar': image_ar,
            'conflicts': self._detect_conflicts('ar_only', widgets),
            'description': f"{dimension_source} & image_ar: {image_ar['aspectW']}:{image_ar['aspectH']} ({img_w}×{img_h})",
            'activeSources': [dimension_source] if dimension_source != 'defaults' else []
        }

    def _calculate_width_with_ar(self, widgets):
        """Priority 5a: WIDTH + Aspect Ratio"""
        w = widgets['width_value']
        ar = self._get_active_aspect_ratio(widgets)
        h = round(w / ar['ratio'])

        return {
            'mode': 'width_with_ar',
            'priority': 5,
            'baseW': w,
            'baseH': h,
            'source': 'widget_with_ar',
            'ar': ar,
            'conflicts': self._detect_conflicts('width_with_ar', widgets),
            'description': f"WIDTH {w} with AR {ar['aspectW']}:{ar['aspectH']} ({ar['source']})",
            'activeSources': ['WIDTH']
        }

    def _calculate_height_with_ar(self, widgets):
        """Priority 5b: HEIGHT + Aspect Ratio"""
        h = widgets['height_value']
        ar = self._get_active_aspect_ratio(widgets)
        w = round(h * ar['ratio'])

        return {
            'mode': 'height_with_ar',
            'priority': 5,
            'baseW': w,
            'baseH': h,
            'source': 'widget_with_ar',
            'ar': ar,
            'conflicts': self._detect_conflicts('height_with_ar', widgets),
            'description': f"HEIGHT {h} with AR {ar['aspectW']}:{ar['aspectH']} ({ar['source']})",
            'activeSources': ['HEIGHT']
        }

    def _calculate_mp_with_ar(self, widgets):
        """Priority 5c: MEGAPIXEL + Aspect Ratio"""
        target_mp = widgets['mp_value'] * 1_000_000
        ar = self._get_active_aspect_ratio(widgets)

        import math
        h = math.sqrt(target_mp / ar['ratio'])
        w = h * ar['ratio']

        return {
            'mode': 'mp_with_ar',
            'priority': 5,
            'baseW': round(w),
            'baseH': round(h),
            'source': 'widget_with_ar',
            'ar': ar,
            'conflicts': self._detect_conflicts('mp_with_ar', widgets),
            'description': f"MEGAPIXEL {widgets['mp_value']}MP with AR {ar['aspectW']}:{ar['aspectH']} ({ar['source']})",
            'activeSources': ['MEGAPIXEL']
        }

    def _calculate_defaults(self, widgets):
        """Priority 6: Defaults (1.0 MP + Aspect Ratio)"""
        ar = self._get_active_aspect_ratio(widgets)
        default_mp = 1.0 * 1_000_000

        import math
        h = math.sqrt(default_mp / ar['ratio'])
        w = h * ar['ratio']

        return {
            'mode': 'defaults_with_ar',
            'priority': 6,
            'baseW': round(w),
            'baseH': round(h),
            'source': 'defaults',
            'ar': ar,
            'conflicts': [],
            'description': f"Defaults: 1.0MP with AR {ar['aspectW']}:{ar['aspectH']} ({ar['source']})",
            'activeSources': []
        }

    # ========================================
    # Aspect Ratio Determination
    # ========================================

    def _get_active_aspect_ratio(self, widgets):
        """
        Get active aspect ratio based on context.
        Priority: custom_ratio > dropdown aspect_ratio

        Note: Image AR is handled separately in Priority 4 (AR Only mode)
        """
        # Priority 1: custom_ratio (if enabled)
        if widgets.get('custom_ratio_enabled'):
            custom_ar_text = widgets.get('custom_aspect_ratio', '1:1')
            return self._parse_custom_aspect_ratio(custom_ar_text)

        # Priority 2: aspect_ratio dropdown
        ar_value = widgets.get('aspect_ratio_dropdown', '16:9 (HD Video/YouTube/TV)')
        return self._parse_dropdown_aspect_ratio(ar_value)

    # ========================================
    # Helper Methods
    # ========================================

    def _compute_ar_from_dimensions(self, w, h):
        """Compute aspect ratio from dimensions using GCD reduction"""
        divisor = gcd(w, h)
        aspect_w = w // divisor
        aspect_h = h // divisor
        ratio = w / h

        return {
            'ratio': ratio,
            'aspectW': aspect_w,
            'aspectH': aspect_h
        }

    def _parse_custom_aspect_ratio(self, text):
        """Parse custom aspect ratio text (e.g. '16:9' or '2.39:1')"""
        import re

        # Handle case where text is a number instead of string (widget value bug)
        if not isinstance(text, str):
            text = str(text)

        # Match patterns like "16:9" or "2.39:1"
        match = re.match(r'^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$', text.strip())
        if match:
            w = float(match.group(1))
            h = float(match.group(2))
            return {
                'ratio': w / h,
                'aspectW': w,
                'aspectH': h,
                'source': 'custom_ratio'
            }

        # Fallback to 16:9
        logger.warning(f'[Calculator] Invalid custom AR text: "{text}", falling back to 16:9')
        return {
            'ratio': 16 / 9,
            'aspectW': 16,
            'aspectH': 9,
            'source': 'fallback'
        }

    def _parse_dropdown_aspect_ratio(self, value):
        """Parse dropdown aspect ratio (e.g. '16:9 (HD Video/YouTube/TV)' → 16:9)"""
        import re

        # Extract "W:H" from dropdown text
        match = re.match(r'^(\d+):(\d+)', value)
        if match:
            w = int(match.group(1))
            h = int(match.group(2))
            return {
                'ratio': w / h,
                'aspectW': w,
                'aspectH': h,
                'source': 'dropdown'
            }

        # Fallback to 16:9
        logger.warning(f'[Calculator] Invalid dropdown AR: "{value}", falling back to 16:9')
        return {
            'ratio': 16 / 9,
            'aspectW': 16,
            'aspectH': 9,
            'source': 'fallback'
        }

    def _detect_conflicts(self, active_mode, widgets):
        """
        Detect conflicts between active mode and widget states.
        Returns list of conflict dicts: {type, severity, message, affectedWidgets}
        """
        conflicts = []

        # Exact Dims conflicts
        if active_mode == 'exact_dims':
            if widgets.get('width_enabled') or widgets.get('height_enabled'):
                conflicts.append({
                    'type': 'exact_dims_overrides_widgets',
                    'severity': 'info',
                    'message': '⚠️ Exact Dims mode ignores WIDTH/HEIGHT toggles',
                    'affectedWidgets': ['dimension_width', 'dimension_height']
                })
            if widgets.get('mp_enabled'):
                conflicts.append({
                    'type': 'exact_dims_overrides_mp',
                    'severity': 'info',
                    'message': '⚠️ Exact Dims mode ignores MEGAPIXEL setting',
                    'affectedWidgets': ['dimension_megapixel']
                })

        # MP Scalar conflicts (Priority 2)
        if active_mode == 'mp_scalar_with_ar':
            if widgets.get('custom_ratio_enabled'):
                conflicts.append({
                    'type': 'mp_scalar_overrides_custom_ar',
                    'severity': 'warning',
                    'message': '⚠️ WIDTH+HEIGHT creates explicit AR, overriding custom_ratio',
                    'affectedWidgets': ['custom_ratio', 'custom_aspect_ratio']
                })
            if widgets.get('image_mode_enabled') and widgets.get('image_mode_value') == 0:
                conflicts.append({
                    'type': 'mp_scalar_overrides_image_ar',
                    'severity': 'warning',
                    'message': '⚠️ WIDTH+HEIGHT creates explicit AR, overriding image AR',
                    'affectedWidgets': ['image_mode']
                })

        # Explicit dimension conflicts (Priority 3)
        if active_mode in ['width_height_explicit', 'mp_width_explicit', 'mp_height_explicit']:
            if widgets.get('custom_ratio_enabled'):
                conflicts.append({
                    'type': 'explicit_dims_overrides_custom_ar',
                    'severity': 'warning',
                    'message': '⚠️ Explicit dimensions create implied AR, overriding custom_ratio',
                    'affectedWidgets': ['custom_ratio', 'custom_aspect_ratio']
                })
            if widgets.get('image_mode_enabled') and widgets.get('image_mode_value') == 0:
                conflicts.append({
                    'type': 'explicit_dims_overrides_image_ar',
                    'severity': 'warning',
                    'message': '⚠️ Explicit dimensions create implied AR, overriding image AR',
                    'affectedWidgets': ['image_mode']
                })
            # Dropdown AR is always overridden by explicit dimensions (info level)
            conflicts.append({
                'type': 'explicit_dims_overrides_dropdown_ar',
                'severity': 'info',
                'message': '⚠️ Explicit dimensions create implied AR, ignoring dropdown',
                'affectedWidgets': ['aspect_ratio']
            })

        # AR Only conflicts
        if active_mode == 'ar_only':
            if widgets.get('custom_ratio_enabled'):
                conflicts.append({
                    'type': 'ar_only_overrides_custom',
                    'severity': 'warning',
                    'message': '⚠️ AR Only mode uses image AR, overriding custom_ratio',
                    'affectedWidgets': ['custom_ratio', 'custom_aspect_ratio']
                })

        return conflicts


class SmartResolutionCalc:
    """
    Smart Resolution Calculator - Flexible resolution and latent generation node.

    Accepts any combination of megapixels/width/height + aspect ratio, automatically
    calculates missing values, and generates both preview and latent images.

    Toggle-based input system allows explicit control over which dimensions to use.
    """

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
                # NEW: Image output parameters (hidden by JavaScript until output connected)
                "output_image_mode": (["auto", "empty", "transform (distort)", "transform (crop/pad)", "transform (scale/crop)", "transform (scale/pad)"], {
                    "default": "auto",
                    "tooltip": "Image output mode:\n• auto: Smart default (transform (distort) if image input, empty otherwise)\n• empty: Generate new image with fill pattern\n• transform (distort): Scale to exact dimensions (ignores aspect ratio)\n• transform (crop/pad): No scaling, crop if larger or pad if smaller\n• transform (scale/crop): Scale to cover target (maintains AR), crop excess\n• transform (scale/pad): Scale to fit inside target (maintains AR), pad remainder"
                }),
                "fill_type": (["black", "white", "custom_color", "noise", "random"], {
                    "default": "black",
                    "tooltip": "Fill pattern for empty images:\n• black: Solid black (#000000)\n• white: Solid white (#FFFFFF)\n• custom_color: Use fill_color hex value\n• noise: Gaussian noise (camera-like, centered around gray)\n• random: Uniform random pixels (TV static, full color range)"
                }),
                "fill_color": ("STRING", {
                    "default": "#522525",
                    "tooltip": "Hex color code for custom_color fill type.\nFormat: #RRGGBB (e.g., #FF0000=red, #00FF00=green, #0000FF=blue)\nWith or without # prefix. Only used when fill_type is 'custom_color'."
                }),
            },
            # Custom widgets added via JavaScript - declare in hidden so ComfyUI passes them to Python
            # Widget data structure: {'on': bool, 'value': number}
            "hidden": {
                "image_mode": "IMAGE_MODE_WIDGET",  # {on: bool, value: 0|1} - 0=AR Only, 1=Exact Dims
                "dimension_megapixel": "DIMENSION_WIDGET",
                "dimension_width": "DIMENSION_WIDGET",
                "dimension_height": "DIMENSION_WIDGET",
            },
        }

    RETURN_TYPES = ("FLOAT", "INT", "INT", "STRING", "IMAGE", "IMAGE", "LATENT", "STRING")
    RETURN_NAMES = ("megapixels", "width", "height", "resolution", "preview", "image", "latent", "info")
    FUNCTION = "calculate_dimensions"
    CATEGORY = "DazzleNodes"

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
                            image=None, vae=None, output_image_mode="none", fill_type="black",
                            fill_color="#808080", **kwargs):
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
            Tuple: (megapixels, width, height, resolution, preview, image, latent, info)
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
        image_mode = kwargs.get('image_mode', {'on': True, 'value': 0})  # Default: enabled, AR Only
        use_image = image_mode.get('on', True) if isinstance(image_mode, dict) else True
        exact_dims = image_mode.get('value', 0) == 1 if isinstance(image_mode, dict) else False

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
        resolution = f"{w} x {h}"

        # ===== PREVIEW OUTPUT (UNCHANGED) =====
        # Always generate preview grid visualization (1024x1024)
        # This output is NEVER modified - maintains exact current behavior
        preview = self.create_preview_image(w, h, resolution, ratio_display, mp)

        # ===== IMAGE OUTPUT (NEW) =====
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
        if actual_mode == "empty":
            # Generate image with specified fill pattern at calculated dimensions
            output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size)
            logger.debug(f"Generated empty image: {w}×{h}, fill={fill_type}")

        elif actual_mode == "transform (distort)":
            if image is not None:
                # Transform input image to calculated dimensions (may distort aspect ratio)
                # Note: Use input image's batch size, not batch_size parameter
                output_image = self.transform_image(image, w, h)
                logger.debug(f"Transformed (distort) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (distort) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size)

        elif actual_mode == "transform (crop/pad)":
            if image is not None:
                # No scaling - crop if larger, pad if smaller
                output_image = self.transform_image_crop_pad(image, w, h, fill_type, fill_color)
                logger.debug(f"Transformed (crop/pad) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (crop/pad) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size)

        elif actual_mode == "transform (scale/crop)":
            if image is not None:
                # Scale to cover target (maintaining AR), crop excess
                output_image = self.transform_image_scale_crop(image, w, h)
                logger.debug(f"Transformed (scale/crop) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (scale/crop) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size)

        elif actual_mode == "transform (scale/pad)":
            if image is not None:
                # Scale to fit inside target (maintaining AR), pad remainder
                output_image = self.transform_image_scale_pad(image, w, h, fill_type, fill_color)
                logger.debug(f"Transformed (scale/pad) input image to {w}×{h}")
            else:
                # No image connected - fallback to empty image with current fill settings
                logger.warning("Transform (scale/pad) mode selected but no image connected, generating empty image")
                output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size)

        else:  # Safety fallback for invalid mode values
            logger.warning(f"Invalid output_image_mode '{actual_mode}', using empty image")
            output_image = self.create_empty_image(w, h, fill_type, fill_color, batch_size)

        # ===== LATENT OUTPUT (NEW: VAE ENCODING SUPPORT) =====
        # Auto-detection: VAE + image + transform mode → encode image, otherwise → empty latent
        latent_source = "Empty"  # Default for info output

        if vae is not None and image is not None and actual_mode != "empty":
            # VAE connected with valid image transform - encode the output_image to latent
            try:
                # Debug: Log tensor info for troubleshooting
                logger.debug(f"VAE connected, preparing to encode output_image")
                logger.debug(f"  output_image shape: {output_image.shape}")
                logger.debug(f"  output_image dtype: {output_image.dtype}")
                logger.debug(f"  output_image device: {output_image.device}")
                logger.debug(f"  output_image is_contiguous: {output_image.is_contiguous()}")

                # Prepare pixels for VAE encoding
                # VAE.encode expects: [batch, height, width, channels] in range [0,1]
                # Take only RGB channels (first 3) to handle RGBA images
                pixels = output_image

                # Ensure we have the right number of channels
                if pixels.shape[3] > 3:
                    # More than 3 channels (e.g., RGBA) - take only RGB
                    pixels = pixels[:, :, :, :3]
                    logger.debug(f"  Trimmed to RGB: {pixels.shape}")

                # Ensure tensor is contiguous (required by some VAEs)
                if not pixels.is_contiguous():
                    pixels = pixels.contiguous()
                    logger.debug(f"  Made contiguous")

                # Encode with VAE (matches ComfyUI's VAEEncode node exactly)
                logger.debug(f"  Calling vae.encode() with shape {pixels.shape}")
                encoded = vae.encode(pixels)

                # Wrap in latent dict format (ComfyUI standard)
                latent = {"samples": encoded}

                latent_source = "VAE Encoded"
                logger.debug(f"VAE encoding successful, latent shape: {latent['samples'].shape}")

            except Exception as e:
                # Graceful fallback: VAE encoding failed, use empty latent
                import traceback
                logger.error(f"VAE encoding failed: {e}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                print(f"[SmartResCalc] WARNING: VAE encoding failed ({e}), using empty latent")
                latent = self.create_latent(w, h, batch_size)
                latent_source = "Empty (VAE failed)"
        else:
            # Generate empty latent for txt2img workflows (backward compatible)
            # Reasons: VAE not connected, no input image, or mode is "empty"
            logger.debug(f"Generating empty latent (txt2img workflow)")
            latent = self.create_latent(w, h, batch_size)
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

        if not has_ar_mention:
            # AR not mentioned yet, add it explicitly
            info = f"{base_info} | AR: {calculated_ar} | Div: {div_info} | Latent: {latent_source}"
        else:
            # AR already mentioned in mode or detail, don't duplicate
            info = f"{base_info} | Div: {div_info} | Latent: {latent_source}"

        # Add override warning if exact dims mode overrides manual settings
        if exact_dims and override_warning:
            info = f"⚠️ [Manual W/H Ignored] | {info}"

        # ALWAYS log final results
        print(f"[SmartResCalc] RESULT: {info}, resolution={resolution}")
        logger.debug(f"Returning: mp={mp}, w={w}, h={h}, resolution={resolution}, info={info}")

        # Return: (megapixels, width, height, resolution, PREVIEW, IMAGE, latent, info)
        return (mp, w, h, resolution, preview, output_image, latent, info)

    def create_empty_image(
        self,
        width: int,
        height: int,
        fill_type: str = "black",
        fill_color: str = "#808080",
        batch_size: int = 1
    ) -> torch.Tensor:
        """
        Create empty image with specified fill pattern.

        Args:
            width: Image width in pixels
            height: Image height in pixels
            fill_type: Fill pattern - "black", "white", "custom_color", "noise", "random"
            fill_color: Hex color string for "custom_color" mode (e.g., "#FF0000")
            batch_size: Number of images in batch

        Returns:
            Tensor of shape [batch_size, height, width, 3] with values 0.0-1.0
        """
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
        fill_color: str = "#808080"
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
        canvas = self.create_empty_image(target_width, target_height, fill_type, fill_color, batch_size)

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
        fill_color: str = "#808080"
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
        canvas = self.create_empty_image(target_width, target_height, fill_type, fill_color, batch_size)

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

    def create_latent(self, width, height, batch_size=1):
        """
        Create latent tensor compatible with SD/Flux models.

        Latent dimensions are downsampled by 8x from pixel dimensions.
        Format: [batch_size, 4_channels, height//8, width//8]
        """
        latent = torch.zeros([batch_size, 4, height // 8, width // 8], device=self.device)
        return {"samples": latent}


NODE_CLASS_MAPPINGS = {
    "SmartResolutionCalc": SmartResolutionCalc,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SmartResolutionCalc": "Smart Resolution Calculator",
}
