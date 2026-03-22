"""
Smart Resolution Calculator - Flexible resolution and latent generation node

Author: Claude & User
Description: Toggle-based resolution calculator that accepts any combination of
            megapixels/width/height + aspect ratio, automatically calculates
            missing values, and generates both preview and latent images.

Features:
- Explicit toggle control for which dimensions to use
- Automatic calculation of missing values
- Preview image showing aspect ratio and dimensions
- Direct latent generation for sampling
- rgthree-style custom widgets
"""

from .py.smart_resolution_calc import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, SmartResolutionCalc
from .py.image_utils import get_image_dimensions_from_path
from .py.dazzle_options import DazzleOptionsNode

# Register DazzleOptions node
NODE_CLASS_MAPPINGS["DazzleOptions"] = DazzleOptionsNode
NODE_DISPLAY_NAME_MAPPINGS["DazzleOptions"] = "Dazzle Options"
from .version import __version__, VERSION, BASE_VERSION, get_version, get_base_version

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', '__version__', 'VERSION', 'BASE_VERSION']

# Web directory for JavaScript widgets
WEB_DIRECTORY = "./web"

# Register API endpoint for image dimension extraction
try:
    import server
    from aiohttp import web
    import json

    @server.PromptServer.instance.routes.post("/smart-resolution/get-dimensions")
    async def get_image_dimensions(request):
        """
        API endpoint to extract image dimensions from file path.

        POST body: {"image_path": "/path/to/image.png"}
        Returns: {"width": 1920, "height": 1080, "success": true}
        """
        try:
            data = await request.json()
            image_path = data.get('image_path')

            if not image_path:
                return web.json_response({
                    'success': False,
                    'error': 'No image_path provided'
                }, status=400)

            # Use the static method from SmartResolutionCalc
            result = get_image_dimensions_from_path(image_path)

            if result['success']:
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)

    @server.PromptServer.instance.routes.post("/smart-resolution/calculate-dimensions")
    async def calculate_dimensions(request):
        """
        API endpoint for dimension calculation using DimensionSourceCalculator.

        This is the single source of truth for dimension calculations.
        JavaScript calls this instead of calculating locally to prevent drift.

        POST body: {
            "widgets": {
                "width_enabled": true,
                "width_value": 1200,
                "height_enabled": false,
                "height_value": 800,
                "mp_enabled": true,
                "mp_value": 1.5,
                "image_mode_enabled": false,
                "image_mode_value": 0,
                "custom_ratio_enabled": false,
                "custom_aspect_ratio": "16:9",
                "aspect_ratio_dropdown": "16:9"
            },
            "runtime_context": {
                "image_info": {"width": 1920, "height": 1080}  // optional
            }
        }

        Returns: {
            "mode": "mp_width_explicit",
            "priority": 3,
            "baseW": 1200,
            "baseH": 1250,
            "source": "widgets_mp_computed",
            "ar": {"ratio": 0.96, "aspectW": 24, "aspectH": 25, "source": "computed"},
            "conflicts": [],
            "description": "MP+W: 1200×1250 (H computed from 1.5MP, AR 24:25 implied)",
            "activeSources": ["WIDTH", "MEGAPIXEL"],
            "success": true
        }
        """
        try:
            data = await request.json()
            widgets = data.get('widgets')
            runtime_context = data.get('runtime_context', {})

            # Diagnostic logging available by uncommenting below (useful for debugging timing issues)
            # print("[API-ENDPOINT] /smart-resolution/calculate-dimensions called")
            # print(f"[API-ENDPOINT] image_mode_enabled: {widgets.get('image_mode_enabled') if widgets else None}")
            # print(f"[API-ENDPOINT] image_info present: {bool(runtime_context.get('image_info'))}")

            if not widgets:
                return web.json_response({
                    'success': False,
                    'error': 'No widgets provided'
                }, status=400)

            # Call static method to calculate dimensions
            result = SmartResolutionCalc.calculate_dimensions_api(widgets, runtime_context)

            if result.get('success'):
                return web.json_response(result)
            else:
                return web.json_response(result, status=400)

        except Exception as e:
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)

    print("[SmartResCalc] Registered API endpoint: /smart-resolution/get-dimensions")
    print("[SmartResCalc] Registered API endpoint: /smart-resolution/calculate-dimensions")

except Exception as e:
    print(f"[SmartResCalc] Warning: Could not register API endpoint: {e}")
