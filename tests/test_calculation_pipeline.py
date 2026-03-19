"""
Integration tests for SmartResolutionCalc's CalculationContext pipeline.

Tests individual pipeline stages by creating a CalculationContext,
calling helper methods, and verifying state mutations.

Uses mock tensors (torch.zeros/rand) and MagicMock for VAE —
no ComfyUI or GPU required.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock
import torch

# Mock ComfyUI modules before importing our code
# This allows testing without ComfyUI/CUDA installed
sys.modules['comfy'] = MagicMock()
sys.modules['comfy.model_management'] = MagicMock()
sys.modules['comfy.utils'] = MagicMock()

# Add project root to path so 'py' package works with relative imports
project_root = str(Path(__file__).parent.parent)
sys.path.insert(0, project_root)

from py.smart_resolution_calc import SmartResolutionCalc, CalculationContext


def make_ctx(**overrides):
    """Create a CalculationContext with sensible defaults. Override any param."""
    defaults = {
        'aspect_ratio': '3:4 (SD Video Portrait)',
        'divisible_by': '16',
        'custom_ratio': False,
        'custom_aspect_ratio': '16:9',
        'batch_size': 1,
        'scale': 1.0,
        'image': None,
        'vae': None,
        'output_image_mode': 'auto',
        'fill_type': 'black',
        'fill_color': '#808080',
        'blend_strength': 0.0,
        'fill_image': None,
        'fill_seed': None,
        'kwargs': {
            'dimension_megapixel': {'on': False, 'value': 1.0},
            'dimension_width': {'on': False, 'value': 1024},
            'dimension_height': {'on': False, 'value': 1024},
            'image_mode': {'on': False, 'value': 0},
        },
    }
    defaults.update(overrides)
    return CalculationContext(**defaults)


def make_node():
    """Create a SmartResolutionCalc instance with mock device."""
    # Mock comfy.model_management which is imported at module level
    node = SmartResolutionCalc.__new__(SmartResolutionCalc)
    node._noise_cache_key = None
    node._noise_cache_image = None
    node._noise_cache_latent = None
    return node


# ============================================================================
# CalculationContext Tests
# ============================================================================

def test_context_defaults():
    """Context initializes with correct default values."""
    ctx = make_ctx()
    assert ctx.w == 0
    assert ctx.h == 0
    assert ctx.mp == 0.0
    assert ctx.seed_active == False
    assert ctx.actual_seed == 0
    assert ctx.output_image is None
    assert ctx.latent is None
    assert ctx.info == ""
    assert ctx.divisor == 16

def test_context_exact_divisor():
    """'Exact' divisible_by sets divisor to 1."""
    ctx = make_ctx(divisible_by='Exact')
    assert ctx.divisor == 1

def test_context_parses_image_mode():
    """Context parses image_mode from kwargs correctly."""
    ctx = make_ctx(kwargs={
        'image_mode': {'on': True, 'value': 1},
        'dimension_megapixel': {'on': False, 'value': 1.0},
        'dimension_width': {'on': False, 'value': 1024},
        'dimension_height': {'on': False, 'value': 1024},
    })
    assert ctx.use_image == True
    assert ctx.exact_dims == True

def test_context_parses_widget_state():
    """Context parses dimension widget state from kwargs."""
    ctx = make_ctx(kwargs={
        'image_mode': {'on': False, 'value': 0},
        'dimension_megapixel': {'on': True, 'value': 2.0},
        'dimension_width': {'on': True, 'value': 1920},
        'dimension_height': {'on': False, 'value': 1080},
    })
    assert ctx.use_mp == True
    assert ctx.megapixel_val == 2.0
    assert ctx.use_width == True
    assert ctx.width_val == 1920
    assert ctx.use_height == False
    assert ctx.height_val == 1080

def test_context_to_tuple():
    """to_tuple returns correct structure."""
    ctx = make_ctx()
    ctx.mp = 1.5
    ctx.w = 1200
    ctx.h = 1250
    ctx.actual_seed = 42
    ctx.preview = torch.zeros(1, 1024, 1024, 3)
    ctx.output_image = torch.zeros(1, 1250, 1200, 3)
    ctx.latent = {"samples": torch.zeros(1, 4, 156, 150)}
    ctx.info = "test info"

    result = ctx.to_tuple()
    assert len(result) == 8
    assert result[0] == 1.5      # mp
    assert result[1] == 1200     # w
    assert result[2] == 1250     # h
    assert result[3] == 42       # seed
    assert result[7] == "test info"


# ============================================================================
# _handle_image_input Tests
# ============================================================================

def test_handle_image_input_no_image():
    """No-op when image is None."""
    node = make_node()
    ctx = make_ctx()
    node._handle_image_input(ctx)
    assert ctx.mode_info is None
    assert ctx.override_warning == False

def test_handle_image_input_exact_dims():
    """Exact dims mode forces width/height from image."""
    node = make_node()
    fake_image = torch.zeros(1, 1080, 1920, 3)  # [B, H, W, C]
    ctx = make_ctx(image=fake_image, kwargs={
        'image_mode': {'on': True, 'value': 1},  # Exact Dims
        'dimension_megapixel': {'on': False, 'value': 1.0},
        'dimension_width': {'on': False, 'value': 1024},
        'dimension_height': {'on': False, 'value': 1024},
    })
    node._handle_image_input(ctx)
    assert ctx.use_width == True
    assert ctx.width_val == 1920
    assert ctx.use_height == True
    assert ctx.height_val == 1080
    assert "Exact" in ctx.mode_info

def test_handle_image_input_ar_only():
    """AR Only mode extracts aspect ratio from image."""
    node = make_node()
    fake_image = torch.zeros(1, 1080, 1920, 3)
    ctx = make_ctx(image=fake_image, kwargs={
        'image_mode': {'on': True, 'value': 0},  # AR Only
        'dimension_megapixel': {'on': False, 'value': 1.0},
        'dimension_width': {'on': False, 'value': 1024},
        'dimension_height': {'on': False, 'value': 1024},
    })
    node._handle_image_input(ctx)
    assert ctx.custom_ratio == True
    assert "16:9" in ctx.custom_aspect_ratio or "16" in ctx.custom_aspect_ratio
    assert "AR" in ctx.mode_info

def test_handle_image_input_override_warning():
    """Override warning when exact dims + manual W/H enabled."""
    node = make_node()
    fake_image = torch.zeros(1, 1080, 1920, 3)
    ctx = make_ctx(image=fake_image, kwargs={
        'image_mode': {'on': True, 'value': 1},  # Exact Dims
        'dimension_megapixel': {'on': False, 'value': 1.0},
        'dimension_width': {'on': True, 'value': 512},   # Manual W enabled
        'dimension_height': {'on': False, 'value': 1024},
    })
    node._handle_image_input(ctx)
    assert ctx.override_warning == True


# ============================================================================
# _resolve_dimensions Tests
# ============================================================================

def test_resolve_dimensions_defaults():
    """Default state (no toggles) resolves to valid dimensions."""
    node = make_node()
    ctx = make_ctx()
    node._resolve_dimensions(ctx)
    assert ctx.w > 0
    assert ctx.h > 0
    assert ctx.result is not None
    assert ctx.calculated_ar != ""

def test_resolve_dimensions_width_height():
    """Width + Height enabled resolves to those values."""
    node = make_node()
    ctx = make_ctx(kwargs={
        'image_mode': {'on': False, 'value': 0},
        'dimension_megapixel': {'on': False, 'value': 1.0},
        'dimension_width': {'on': True, 'value': 1920},
        'dimension_height': {'on': True, 'value': 1080},
    })
    node._resolve_dimensions(ctx)
    assert ctx.w == 1920
    assert ctx.h == 1080


# ============================================================================
# _apply_scale_and_divisibility Tests
# ============================================================================

def test_scale_and_divisibility_no_scale():
    """No scale (1.0x) with div=16 rounds dimensions."""
    node = make_node()
    ctx = make_ctx(divisible_by='16')
    ctx.w = 1920
    ctx.h = 1080
    ctx.info_detail_base = "test"
    node._apply_scale_and_divisibility(ctx)
    assert ctx.w % 16 == 0
    assert ctx.h % 16 == 0
    assert ctx.mp > 0

def test_scale_and_divisibility_with_scale():
    """Scale 2.0x doubles dimensions."""
    node = make_node()
    ctx = make_ctx(scale=2.0, divisible_by='8')
    ctx.w = 512
    ctx.h = 512
    ctx.info_detail_base = "test"
    node._apply_scale_and_divisibility(ctx)
    assert ctx.w == 1024
    assert ctx.h == 1024
    assert "Scale" in ctx.info_detail

def test_scale_and_divisibility_exact():
    """Exact divisibility preserves dimensions."""
    node = make_node()
    ctx = make_ctx(divisible_by='Exact')
    ctx.w = 1919
    ctx.h = 1079
    ctx.info_detail_base = "test"
    node._apply_scale_and_divisibility(ctx)
    assert ctx.w == 1919
    assert ctx.h == 1079


# ============================================================================
# _resolve_seed Tests
# ============================================================================

def test_resolve_seed_active():
    """Active seed with valid value sets seed_active and actual_seed."""
    node = make_node()
    ctx = make_ctx(fill_seed={'on': True, 'value': 42})
    node._resolve_seed(ctx)
    assert ctx.seed_active == True
    assert ctx.actual_seed == 42

def test_resolve_seed_inactive():
    """Inactive seed passes through value but seed_active is False."""
    node = make_node()
    ctx = make_ctx(fill_seed={'on': False, 'value': 42})
    node._resolve_seed(ctx)
    assert ctx.seed_active == False
    assert ctx.actual_seed == 42

def test_resolve_seed_none():
    """No seed data defaults to 0."""
    node = make_node()
    ctx = make_ctx(fill_seed=None)
    node._resolve_seed(ctx)
    assert ctx.seed_active == False
    assert ctx.actual_seed == 0

def test_resolve_seed_vestigial_random():
    """Unresolved special value -1 generates Python-side random."""
    node = make_node()
    ctx = make_ctx(fill_seed={'on': True, 'value': -1})
    node._resolve_seed(ctx)
    assert ctx.seed_active == True
    assert ctx.actual_seed >= 0  # Should be a random positive value


# ============================================================================
# _prepare_output_mode Tests
# ============================================================================

def test_prepare_output_mode_auto_no_image():
    """Auto mode without image selects 'empty'."""
    node = make_node()
    ctx = make_ctx(output_image_mode='auto')
    node._prepare_output_mode(ctx)
    assert ctx.actual_mode == "empty"

def test_prepare_output_mode_auto_with_image():
    """Auto mode with image selects 'transform (distort)'."""
    node = make_node()
    ctx = make_ctx(output_image_mode='auto', image=torch.zeros(1, 512, 512, 3))
    node._prepare_output_mode(ctx)
    assert ctx.actual_mode == "transform (distort)"

def test_prepare_output_mode_transform_no_image():
    """Transform mode without image falls back to 'empty'."""
    node = make_node()
    ctx = make_ctx(output_image_mode='transform (crop/pad)')
    node._prepare_output_mode(ctx)
    assert ctx.actual_mode == "empty"


# ============================================================================
# _build_info_string Tests
# ============================================================================

def test_build_info_string_basic():
    """Info string contains mode, detail, div, and latent source."""
    node = make_node()
    ctx = make_ctx()
    ctx.w = 1024
    ctx.h = 1024
    ctx.info_detail = "W: 1024 x H: 1024 | MP: 1.05"
    ctx.result = {'description': 'Defaults (1.0MP + 3:4)', 'priority': 6,
                  'mode': 'defaults', 'conflicts': []}
    ctx.latent_source = "Empty"
    node._build_info_string(ctx)
    assert "Mode:" in ctx.info
    assert "Div:" in ctx.info
    assert "Latent:" in ctx.info

def test_build_info_string_with_seed():
    """Info string includes seed when active."""
    node = make_node()
    ctx = make_ctx()
    ctx.w = 1024
    ctx.h = 1024
    ctx.info_detail = "test"
    ctx.result = {'description': 'test', 'priority': 6, 'mode': 'defaults', 'conflicts': []}
    ctx.latent_source = "Empty"
    ctx.seed_active = True
    ctx.actual_seed = 42
    node._build_info_string(ctx)
    assert "Seed: 42" in ctx.info


# ============================================================================
# Run all tests
# ============================================================================

if __name__ == '__main__':
    import traceback

    tests = [
        # CalculationContext
        test_context_defaults,
        test_context_exact_divisor,
        test_context_parses_image_mode,
        test_context_parses_widget_state,
        test_context_to_tuple,
        # _handle_image_input
        test_handle_image_input_no_image,
        test_handle_image_input_exact_dims,
        test_handle_image_input_ar_only,
        test_handle_image_input_override_warning,
        # _resolve_dimensions
        test_resolve_dimensions_defaults,
        test_resolve_dimensions_width_height,
        # _apply_scale_and_divisibility
        test_scale_and_divisibility_no_scale,
        test_scale_and_divisibility_with_scale,
        test_scale_and_divisibility_exact,
        # _resolve_seed
        test_resolve_seed_active,
        test_resolve_seed_inactive,
        test_resolve_seed_none,
        test_resolve_seed_vestigial_random,
        # _prepare_output_mode
        test_prepare_output_mode_auto_no_image,
        test_prepare_output_mode_auto_with_image,
        test_prepare_output_mode_transform_no_image,
        # _build_info_string
        test_build_info_string_basic,
        test_build_info_string_with_seed,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
            print(f"  PASS: {test.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL: {test.__name__}: {e}")
            traceback.print_exc()

    print(f"\n{'='*60}")
    print(f"Total: {len(tests)}, Passed: {passed}, Failed: {failed}")
    if failed == 0:
        print("ALL TESTS PASSED")
    else:
        print(f"{failed} TESTS FAILED")
