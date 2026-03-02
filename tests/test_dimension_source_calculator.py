"""
Test script for DimensionSourceCalculator class.

Validates Python implementation against expected behavior from JavaScript DimensionSourceManager.
Tests all 6 priority levels, conflict detection, and edge cases.

Related Issues: #15, #16, #19 (Python parity)
Version: v0.4.13 testing
"""

import sys
import io
from pathlib import Path

# Fix Windows console encoding for Unicode characters
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add py directory to path to import smart_resolution_calc
sys.path.insert(0, str(Path(__file__).parent.parent / "py"))

# Add ComfyUI root to path for comfy module imports
comfyui_root = Path("C:/code/ComfyUI_experiment")
if comfyui_root.exists():
    sys.path.insert(0, str(comfyui_root))

from smart_resolution_calc import DimensionSourceCalculator


def test_priority_1_exact_dims():
    """Priority 1: USE IMAGE DIMS = Exact Dims (absolute override)"""
    print("\n" + "="*60)
    print("TEST: Priority 1 - Exact Dims")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1200,
        'height_enabled': True,
        'height_value': 800,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 1,  # Exact Dims
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '2.39:1',
        'aspect_ratio_dropdown': '16:9'
    }

    runtime_context = {
        'image_info': {'width': 1920, 'height': 1080}
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'exact_dims', f"Expected mode 'exact_dims', got '{result['mode']}'"
    assert result['priority'] == 1, f"Expected priority 1, got {result['priority']}"
    assert result['baseW'] == 1920, f"Expected width 1920, got {result['baseW']}"
    assert result['baseH'] == 1080, f"Expected height 1080, got {result['baseH']}"
    # Note: source 'image' = USE IMAGE DIMS in Exact Dims mode (not AR Only)
    assert result['source'] == 'image', f"Expected source 'image' (Exact Dims mode), got '{result['source']}'"
    assert len(result['conflicts']) > 0, "Expected conflicts for Exact Dims overriding widgets"

    print("\n✅ Priority 1 test PASSED")


def test_priority_2_mp_scalar_with_ar():
    """Priority 2: MP + W + H (scalar with AR from W:H)"""
    print("\n" + "="*60)
    print("TEST: Priority 2 - MP+W+H Scalar")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1920,
        'height_enabled': True,
        'height_value': 1080,
        'mp_enabled': True,
        'mp_value': 1.5,  # Target 1.5 MP (will scale down from 2.07 MP)
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '2.39:1',
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'mp_scalar_with_ar', f"Expected mode 'mp_scalar_with_ar', got '{result['mode']}'"
    assert result['priority'] == 2, f"Expected priority 2, got {result['priority']}"

    # Calculate expected dimensions: scale to 1.5 MP maintaining 16:9 AR
    # Original: 1920×1080 = 2,073,600 pixels
    # Target: 1.5 MP = 1,500,000 pixels
    # Scale factor: sqrt(1,500,000 / 2,073,600) ≈ 0.8507
    # Expected: W = round(1920 * 0.8507) = 1633, H = round(1080 * 0.8507) = 919
    assert result['baseW'] == 1633, f"Expected width 1633, got {result['baseW']}"
    assert result['baseH'] == 919, f"Expected height 919, got {result['baseH']}"

    # Check aspect ratio maintained from WIDTH:HEIGHT (16:9)
    assert result['ar']['aspectW'] == 16, f"Expected aspectW 16, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected aspectH 9, got {result['ar']['aspectH']}"

    assert len(result['conflicts']) > 0, "Expected conflicts for MP scalar overriding custom_ratio"

    print("\n✅ Priority 2 test PASSED")


def test_priority_3a_width_height_explicit():
    """Priority 3a: W+H Explicit"""
    print("\n" + "="*60)
    print("TEST: Priority 3a - Width + Height Explicit")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1024,
        'height_enabled': True,
        'height_value': 768,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '2.39:1',
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'width_height_explicit', f"Expected mode 'width_height_explicit', got '{result['mode']}'"
    assert result['priority'] == 3, f"Expected priority 3, got {result['priority']}"
    assert result['baseW'] == 1024, f"Expected width 1024, got {result['baseW']}"
    assert result['baseH'] == 768, f"Expected height 768, got {result['baseH']}"
    assert result['source'] == 'widgets_explicit', f"Expected source 'widgets_explicit', got '{result['source']}'"

    # Check aspect ratio computed from dimensions (4:3)
    assert result['ar']['aspectW'] == 4, f"Expected aspectW 4, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 3, f"Expected aspectH 3, got {result['ar']['aspectH']}"

    assert len(result['conflicts']) > 0, "Expected conflicts for explicit dims overriding custom_ratio"

    print("\n✅ Priority 3a test PASSED")


def test_priority_3b_mp_width_explicit():
    """Priority 3b: MP+W Explicit (v0.4.11 bug fix)"""
    print("\n" + "="*60)
    print("TEST: Priority 3b - MP+WIDTH Explicit")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1200,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': True,
        'mp_value': 1.5,  # 1,500,000 pixels
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'mp_width_explicit', f"Expected mode 'mp_width_explicit', got '{result['mode']}'"
    assert result['priority'] == 3, f"Expected priority 3, got {result['priority']}"
    assert result['baseW'] == 1200, f"Expected width 1200, got {result['baseW']}"

    # Expected height: 1,500,000 / 1200 = 1250
    assert result['baseH'] == 1250, f"Expected height 1250, got {result['baseH']}"

    assert result['source'] == 'widgets_mp_computed', f"Expected source 'widgets_mp_computed', got '{result['source']}'"

    # Check aspect ratio computed from resulting dimensions (24:25)
    assert result['ar']['aspectW'] == 24, f"Expected aspectW 24, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 25, f"Expected aspectH 25, got {result['ar']['aspectH']}"

    print("\n✅ Priority 3b test PASSED (v0.4.11 bug fix confirmed)")


def test_priority_3c_mp_height_explicit():
    """Priority 3c: MP+H Explicit (v0.4.11 bug fix)"""
    print("\n" + "="*60)
    print("TEST: Priority 3c - MP+HEIGHT Explicit")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1200,
        'height_enabled': True,
        'height_value': 800,
        'mp_enabled': True,
        'mp_value': 1.5,  # 1,500,000 pixels
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'mp_height_explicit', f"Expected mode 'mp_height_explicit', got '{result['mode']}'"
    assert result['priority'] == 3, f"Expected priority 3, got {result['priority']}"
    assert result['baseH'] == 800, f"Expected height 800, got {result['baseH']}"

    # Expected width: 1,500,000 / 800 = 1875
    assert result['baseW'] == 1875, f"Expected width 1875, got {result['baseW']}"

    assert result['source'] == 'widgets_mp_computed', f"Expected source 'widgets_mp_computed', got '{result['source']}'"

    # Check aspect ratio computed from resulting dimensions (75:32)
    assert result['ar']['aspectW'] == 75, f"Expected aspectW 75, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 32, f"Expected aspectH 32, got {result['ar']['aspectH']}"

    print("\n✅ Priority 3c test PASSED (v0.4.11 bug fix confirmed)")


def test_priority_4_ar_only():
    """Priority 4: USE IMAGE DIMS = AR Only"""
    print("\n" + "="*60)
    print("TEST: Priority 4 - AR Only")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1200,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': True,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 0,  # AR Only
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '2.39:1',
        'aspect_ratio_dropdown': '16:9'
    }

    runtime_context = {
        'image_info': {'width': 2560, 'height': 1440}  # 16:9 image
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'ar_only', f"Expected mode 'ar_only', got '{result['mode']}'"
    assert result['priority'] == 4, f"Expected priority 4, got {result['priority']}"

    # Dimensions calculated from MP + image AR (16:9)
    # 1.5 MP = 1,500,000 pixels at 16:9
    # w*h = 1,500,000, w/h = 16/9
    # w = sqrt(1,500,000 * 16/9) ≈ 1633, h = sqrt(1,500,000 * 9/16) ≈ 919
    assert result['baseW'] == 1633, f"Expected width 1633, got {result['baseW']}"
    assert result['baseH'] == 919, f"Expected height 919, got {result['baseH']}"

    # Note: source 'image_ar' = USE IMAGE DIMS in AR Only mode (uses image AR, not exact dims)
    assert result['source'] == 'image_ar', f"Expected source 'image_ar' (AR Only mode), got '{result['source']}'"

    # Check aspect ratio from image (16:9)
    assert result['ar']['aspectW'] == 16, f"Expected aspectW 16, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected aspectH 9, got {result['ar']['aspectH']}"

    assert len(result['conflicts']) > 0, "Expected conflicts for AR Only overriding custom_ratio"

    print("\n✅ Priority 4 test PASSED")


def test_priority_5_width_with_ar():
    """Priority 5a: Width with AR"""
    print("\n" + "="*60)
    print("TEST: Priority 5a - Width with AR")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1920,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '2.39:1',  # Cinemascope
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'width_with_ar', f"Expected mode 'width_with_ar', got '{result['mode']}'"
    assert result['priority'] == 5, f"Expected priority 5, got {result['priority']}"
    assert result['baseW'] == 1920, f"Expected width 1920, got {result['baseW']}"

    # Expected height: 1920 / 2.39 ≈ 803
    assert result['baseH'] == 803, f"Expected height 803, got {result['baseH']}"

    # Note: source 'widget_with_ar' = single dimension widget (WIDTH) with AR source
    assert result['source'] == 'widget_with_ar', f"Expected source 'widget_with_ar', got '{result['source']}'"

    # Note: AR parsed as decimal form from "2.39:1" input → aspectW=2.39, aspectH=1.0
    assert result['ar']['aspectW'] == 2.39, f"Expected aspectW 2.39, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 1.0, f"Expected aspectH 1.0, got {result['ar']['aspectH']}"

    print("\n✅ Priority 5a test PASSED")


def test_priority_5b_height_with_ar():
    """Priority 5b: Height with AR"""
    print("\n" + "="*60)
    print("TEST: Priority 5b - Height with AR")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1200,
        'height_enabled': True,
        'height_value': 1080,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'height_with_ar', f"Expected mode 'height_with_ar', got '{result['mode']}'"
    assert result['priority'] == 5, f"Expected priority 5, got {result['priority']}"
    assert result['baseH'] == 1080, f"Expected height 1080, got {result['baseH']}"

    # Expected width: 1080 * 16/9 = 1920
    assert result['baseW'] == 1920, f"Expected width 1920, got {result['baseW']}"

    # Note: source 'widget_with_ar' = single dimension widget (HEIGHT) with AR source
    assert result['source'] == 'widget_with_ar', f"Expected source 'widget_with_ar', got '{result['source']}'"

    # Check dropdown aspect ratio used (16:9)
    assert result['ar']['aspectW'] == 16, f"Expected aspectW 16, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected aspectH 9, got {result['ar']['aspectH']}"

    print("\n✅ Priority 5b test PASSED")


def test_priority_5c_mp_with_ar():
    """Priority 5c: MP with AR"""
    print("\n" + "="*60)
    print("TEST: Priority 5c - MP with AR")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1200,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': True,
        'mp_value': 2.0,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '21:9',  # Ultrawide
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    assert result['mode'] == 'mp_with_ar', f"Expected mode 'mp_with_ar', got '{result['mode']}'"
    assert result['priority'] == 5, f"Expected priority 5, got {result['priority']}"

    # 2.0 MP at 21:9
    # 2 MP = 2,000,000 pixels at 21:9
    # w*h = 2,000,000, w/h = 21/9
    # w = sqrt(2,000,000 * 21/9) ≈ 2160, h = sqrt(2,000,000 * 9/21) ≈ 926
    assert result['baseW'] == 2160, f"Expected width 2160, got {result['baseW']}"
    assert result['baseH'] == 926, f"Expected height 926, got {result['baseH']}"

    # Note: source 'widget_with_ar' = single dimension widget (MEGAPIXEL) with AR source
    assert result['source'] == 'widget_with_ar', f"Expected source 'widget_with_ar', got '{result['source']}'"

    # Check custom aspect ratio used (21:9)
    assert result['ar']['aspectW'] == 21, f"Expected aspectW 21, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected aspectH 9, got {result['ar']['aspectH']}"

    print("\n✅ Priority 5c test PASSED")


def test_priority_6_defaults():
    """Priority 6: Defaults with AR"""
    print("\n" + "="*60)
    print("TEST: Priority 6 - Defaults")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1200,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '21:9'  # Ultrawide
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")
    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - {conflict['message']}")

    # Assertions
    # Note: mode 'defaults_with_ar' = no widgets active, using default 1.0 MP with dropdown AR
    assert result['mode'] == 'defaults_with_ar', f"Expected mode 'defaults_with_ar', got '{result['mode']}'"
    assert result['priority'] == 6, f"Expected priority 6, got {result['priority']}"

    # Default 1 MP at 21:9
    # 1 MP = 1,000,000 pixels at 21:9
    # w*h = 1,000,000, w/h = 21/9
    # w = sqrt(1,000,000 * 21/9) ≈ 1528, h = sqrt(1,000,000 * 9/21) ≈ 655
    assert result['baseW'] == 1528, f"Expected width 1528, got {result['baseW']}"
    assert result['baseH'] == 655, f"Expected height 655, got {result['baseH']}"

    # Note: source 'defaults' = default behavior when no widgets active
    assert result['source'] == 'defaults', f"Expected source 'defaults', got '{result['source']}'"

    # Check dropdown aspect ratio used (21:9)
    assert result['ar']['aspectW'] == 21, f"Expected aspectW 21, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected aspectH 9, got {result['ar']['aspectH']}"

    print("\n✅ Priority 6 test PASSED")


def test_edge_case_missing_image():
    """Edge case: AR Only mode with missing image (should fall back)"""
    print("\n" + "="*60)
    print("TEST: Edge Case - Missing Image")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1200,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': True,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 0,  # AR Only (but no image)
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    runtime_context = None  # No image

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")

    # Calculator reports pending state when image mode enabled but no image connected.
    # The fallback to defaults happens in the caller (calculate_dimensions() lines 1122-1130),
    # not in the calculator itself. The calculator correctly reports the true system state.
    assert result['mode'] == 'ar_only_pending', f"Expected pending state 'ar_only_pending', got '{result['mode']}'"
    assert result['priority'] == 4, f"Expected priority 4 (image mode), got {result['priority']}"
    assert result['baseW'] is None, f"Expected None width in pending state, got {result['baseW']}"
    assert result['baseH'] is None, f"Expected None height in pending state, got {result['baseH']}"

    print("\n✅ Edge case test PASSED")


def test_edge_case_invalid_custom_ar():
    """Edge case: Invalid custom AR text (should fall back)"""
    print("\n" + "="*60)
    print("TEST: Edge Case - Invalid Custom AR")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1920,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': 'invalid text',  # Should fall back to 16:9
        'aspect_ratio_dropdown': '21:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")

    # Should use width_with_ar mode with fallback AR (16:9 default)
    assert result['mode'] == 'width_with_ar', f"Expected mode 'width_with_ar', got '{result['mode']}'"

    # Check fallback to default AR (16:9)
    assert result['ar']['aspectW'] == 16, f"Expected fallback aspectW 16, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected fallback aspectH 9, got {result['ar']['aspectH']}"

    print("\n✅ Edge case test PASSED")


def test_edge_case_float_custom_ar():
    """Edge case: Float value for custom AR (regression test for AttributeError bug)"""
    print("\n" + "="*60)
    print("TEST: Edge Case - Float Custom AR (Regression)")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1920,
        'height_enabled': False,
        'height_value': 800,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': 2.39,  # Float instead of string "2.39:1" - should not crash
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Mode: {result['mode']}")
    print(f"Priority: {result['priority']}")
    print(f"Dimensions: {result['baseW']}×{result['baseH']}")
    print(f"Source: {result['source']}")
    print(f"Aspect Ratio: {result['ar']['aspectW']}:{result['ar']['aspectH']}")
    print(f"Description: {result['description']}")
    print(f"Active Sources: {result['activeSources']}")

    # Should use width_with_ar mode (Priority 5a)
    assert result['mode'] == 'width_with_ar', f"Expected mode 'width_with_ar', got '{result['mode']}'"

    # Float "2.39" doesn't match "W:H" pattern, so should fall back to 16:9
    assert result['ar']['aspectW'] == 16, f"Expected fallback aspectW 16, got {result['ar']['aspectW']}"
    assert result['ar']['aspectH'] == 9, f"Expected fallback aspectH 9, got {result['ar']['aspectH']}"

    print("\n✅ Edge case test PASSED (no AttributeError on float input)")


# ============================================================
# CONFLICT DETECTION TESTS (7 types)
# ============================================================

def test_conflict_exact_dims_overrides_widgets():
    """Conflict: Exact Dims mode overrides WIDTH/HEIGHT widgets (info severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - Exact Dims Overrides Widgets")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1024,
        'height_enabled': True,
        'height_value': 768,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 1,  # Exact Dims mode
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    # Mock image data
    runtime_context = {
        'image_info': {'width': 1920, 'height': 1080}
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # Should have exact_dims_overrides_widgets conflict
    assert len(result['conflicts']) > 0, "Expected conflicts to exist"

    # Check for info severity conflict about ignoring WIDTH/HEIGHT
    has_widget_override = any(
        'ignores' in c['message'].lower() and
        ('width' in c['message'].lower() or 'height' in c['message'].lower())
        for c in result['conflicts']
    )
    assert has_widget_override, "Expected conflict about ignoring WIDTH/HEIGHT toggles"

    print("\n✅ Conflict detection test PASSED")


def test_conflict_exact_dims_overrides_mp():
    """Conflict: Exact Dims mode overrides MEGAPIXEL widget (info severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - Exact Dims Overrides MP")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1024,
        'height_enabled': False,
        'height_value': 768,
        'mp_enabled': True,
        'mp_value': 2.0,
        'image_mode_enabled': True,
        'image_mode_value': 1,  # Exact Dims mode
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    # Mock image data
    runtime_context = {
        'image_info': {'width': 1920, 'height': 1080}
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # Should have conflicts (Exact Dims mode overrides everything)
    assert len(result['conflicts']) > 0, "Expected conflicts to exist"

    print("\n✅ Conflict detection test PASSED")


def test_conflict_mp_scalar_overrides_custom_ar():
    """Conflict: MP+W+H scalar mode overrides custom_ratio (warning severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - MP Scalar Overrides Custom AR")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1920,
        'height_enabled': True,
        'height_value': 1080,
        'mp_enabled': True,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '21:9',
        'aspect_ratio_dropdown': '16:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # Should have warning conflict about overriding custom_ratio
    assert len(result['conflicts']) > 0, "Expected conflicts to exist"

    has_custom_ar_override = any(
        'overriding' in c['message'].lower() and
        'custom' in c['message'].lower()
        for c in result['conflicts']
    )
    assert has_custom_ar_override, "Expected conflict about overriding custom_ratio"

    # Check severity
    custom_ar_conflict = next(
        (c for c in result['conflicts']
         if 'overriding' in c['message'].lower() and 'custom' in c['message'].lower()),
        None
    )
    if custom_ar_conflict:
        assert custom_ar_conflict.get('severity') == 'warning', \
            f"Expected warning severity, got {custom_ar_conflict.get('severity')}"

    print("\n✅ Conflict detection test PASSED")


def test_conflict_mp_scalar_overrides_image_ar():
    """Conflict: MP+W+H scalar mode overrides image AR (warning severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - MP Scalar Overrides Image AR")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1920,
        'height_enabled': True,
        'height_value': 1080,
        'mp_enabled': True,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 0,  # AR Only mode
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    # Mock image data with different AR
    runtime_context = {
        'image_info': {
            'width': 2560,
            'height': 1440,  # 16:9 AR
            'aspect_ratio': 16/9
        }
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # MP+W+H takes priority over AR Only mode, should have conflicts
    assert len(result['conflicts']) > 0, "Expected conflicts to exist"

    print("\n✅ Conflict detection test PASSED")


def test_conflict_explicit_dims_overrides_custom_ar():
    """Conflict: Explicit dimensions override custom_ratio (warning severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - Explicit Dims Override Custom AR")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1024,
        'height_enabled': True,
        'height_value': 768,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': False,
        'image_mode_value': 0,
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '21:9'
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, None)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # Should have warning conflicts about overriding custom_ratio and dropdown
    assert len(result['conflicts']) >= 2, f"Expected 2+ conflicts, got {len(result['conflicts'])}"

    has_custom_ar_override = any(
        'overriding' in c['message'].lower() and 'custom' in c['message'].lower()
        for c in result['conflicts']
    )
    assert has_custom_ar_override, "Expected conflict about overriding custom_ratio"

    print("\n✅ Conflict detection test PASSED")


def test_conflict_explicit_dims_overrides_image_ar():
    """Conflict: Explicit dimensions override image AR (warning severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - Explicit Dims Override Image AR")
    print("="*60)

    widgets = {
        'width_enabled': True,
        'width_value': 1024,
        'height_enabled': True,
        'height_value': 768,
        'mp_enabled': False,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 0,  # AR Only mode
        'custom_ratio_enabled': False,
        'custom_aspect_ratio': '16:9',
        'aspect_ratio_dropdown': '16:9'
    }

    # Mock image data
    runtime_context = {
        'image_info': {
            'width': 1920,
            'height': 1080,  # 16:9 AR
            'aspect_ratio': 16/9
        }
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # Explicit dimensions (Priority 3) override AR Only mode (Priority 4)
    # Should not be in AR Only mode
    assert result['mode'] != 'ar_only', "Should not be in AR Only mode when explicit dims provided"

    print("\n✅ Conflict detection test PASSED")


def test_conflict_ar_only_overrides_custom():
    """Conflict: AR Only mode overrides custom_ratio (warning severity)"""
    print("\n" + "="*60)
    print("TEST: Conflict - AR Only Overrides Custom Ratio")
    print("="*60)

    widgets = {
        'width_enabled': False,
        'width_value': 1024,
        'height_enabled': False,
        'height_value': 768,
        'mp_enabled': True,
        'mp_value': 1.5,
        'image_mode_enabled': True,
        'image_mode_value': 0,  # AR Only mode
        'custom_ratio_enabled': True,
        'custom_aspect_ratio': '21:9',
        'aspect_ratio_dropdown': '16:9'
    }

    # Mock image data with different AR
    runtime_context = {
        'image_info': {
            'width': 2560,
            'height': 1440,  # 16:9 AR
            'aspect_ratio': 16/9
        }
    }

    calculator = DimensionSourceCalculator()
    result = calculator.calculate_dimension_source(widgets, runtime_context)

    print(f"Conflicts: {len(result['conflicts'])}")
    for conflict in result['conflicts']:
        print(f"  - [{conflict.get('severity', 'unknown').upper()}] {conflict['message']}")

    # Should have warning conflict about overriding custom_ratio
    assert len(result['conflicts']) > 0, "Expected conflicts to exist"

    has_custom_ar_override = any(
        'overriding' in c['message'].lower() and 'custom' in c['message'].lower()
        for c in result['conflicts']
    )
    assert has_custom_ar_override, "Expected conflict about overriding custom_ratio"

    # Check severity
    custom_ar_conflict = next(
        (c for c in result['conflicts']
         if 'overriding' in c['message'].lower() and 'custom' in c['message'].lower()),
        None
    )
    if custom_ar_conflict:
        assert custom_ar_conflict.get('severity') == 'warning', \
            f"Expected warning severity, got {custom_ar_conflict.get('severity')}"

    print("\n✅ Conflict detection test PASSED")


def run_all_tests():
    """Run all test cases"""
    print("\n" + "="*60)
    print("DIMENSION SOURCE CALCULATOR TEST SUITE")
    print("Testing Python implementation for v0.4.13")
    print("="*60)

    tests = [
        ("Priority 1: Exact Dims", test_priority_1_exact_dims),
        ("Priority 2: MP+W+H Scalar", test_priority_2_mp_scalar_with_ar),
        ("Priority 3a: W+H Explicit", test_priority_3a_width_height_explicit),
        ("Priority 3b: MP+W Explicit", test_priority_3b_mp_width_explicit),
        ("Priority 3c: MP+H Explicit", test_priority_3c_mp_height_explicit),
        ("Priority 4: AR Only", test_priority_4_ar_only),
        ("Priority 5a: Width with AR", test_priority_5_width_with_ar),
        ("Priority 5b: Height with AR", test_priority_5b_height_with_ar),
        ("Priority 5c: MP with AR", test_priority_5c_mp_with_ar),
        ("Priority 6: Defaults", test_priority_6_defaults),
        ("Edge Case: Missing Image", test_edge_case_missing_image),
        ("Edge Case: Invalid Custom AR", test_edge_case_invalid_custom_ar),
        ("Edge Case: Float Custom AR", test_edge_case_float_custom_ar),
        ("Conflict: Exact Dims Overrides Widgets", test_conflict_exact_dims_overrides_widgets),
        ("Conflict: Exact Dims Overrides MP", test_conflict_exact_dims_overrides_mp),
        ("Conflict: MP Scalar Overrides Custom AR", test_conflict_mp_scalar_overrides_custom_ar),
        ("Conflict: MP Scalar Overrides Image AR", test_conflict_mp_scalar_overrides_image_ar),
        ("Conflict: Explicit Dims Override Custom AR", test_conflict_explicit_dims_overrides_custom_ar),
        ("Conflict: Explicit Dims Override Image AR", test_conflict_explicit_dims_overrides_image_ar),
        ("Conflict: AR Only Overrides Custom", test_conflict_ar_only_overrides_custom),
    ]

    passed = 0
    failed = 0
    errors = []

    for test_name, test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            failed += 1
            errors.append((test_name, str(e)))
            print(f"\n❌ {test_name} FAILED: {e}")
        except Exception as e:
            failed += 1
            errors.append((test_name, f"Exception: {e}"))
            print(f"\n❌ {test_name} ERROR: {e}")

    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    print(f"Total Tests: {len(tests)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")

    if errors:
        print("\nFailed Tests:")
        for test_name, error in errors:
            print(f"  - {test_name}: {error}")

    if failed == 0:
        print("\n✅ ALL TESTS PASSED - Python implementation ready for ComfyUI testing")
        return 0
    else:
        print(f"\n❌ {failed} TEST(S) FAILED - Review implementation")
        return 1


if __name__ == '__main__':
    exit_code = run_all_tests()
    sys.exit(exit_code)
