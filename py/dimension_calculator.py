"""
DimensionSourceCalculator -- Priority-based dimension resolution system.

Extracted from smart_resolution_calc.py for modularity and reuse.

Manages dimension source priority and aspect ratio determination.
Implements complete state machine with 6 priority levels to resolve
dimension/AR conflicts from toggle-based widget inputs.

Priority Hierarchy:
1. USE IMAGE DIMS = Exact Dims (absolute override)
2. MP + W + H (scalar with AR from W:H)
3. Explicit Dimensions (W+H, MP+W, MP+H)
4. USE IMAGE DIMS = AR Only
5. Single dimension with AR (W/H/MP + AR source)
6. Defaults with AR

Related Issues: #15 (umbrella), #16 (implementation), #19 (Python parity)
"""

import logging
from math import gcd

logger = logging.getLogger('smartrescalc')


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

