"""
Noise generation utilities for DazzleNodes.

Contains:
- DazNoise detection and generation (_get_plasma_fast, _generate_daznoise)
- Spectral noise blending (spectral_noise_blend) — FFT-based pattern injection
- PIL to tensor conversion (pil2tensor)

These utilities are independent of SmartResolutionCalc and can be
reused by other DazzleNodes projects.
"""

import numpy as np
import torch
import logging
import os
import sys
import random as py_random

# Configure debug logging (shared with SmartResCalc)
logger = logging.getLogger('SmartResolutionCalc')
DEBUG_ENABLED = os.getenv('COMFY_DEBUG_SMART_RES_CALC', 'false').lower() == 'true'


# ===== Optional dependency: dazzle-comfy-plasma-fast noise generators =====
_plasma_fast_module = None

# Extended fill types available when dazzle-comfy-plasma-fast is installed
DAZNOISE_FILL_TYPES = [
    "DazNoise: Pink", "DazNoise: Brown", "DazNoise: Plasma",
    "DazNoise: Greyscale", "DazNoise: Gaussian",
]

# Maps DazNoise fill_type values to (NODE_CLASS_MAPPINGS key, method_name, extra_kwargs)
_DAZNOISE_TYPE_MAP = {
    "DazNoise: Pink": ("JDC_PinkNoise", "generate_noise", {}),
    "DazNoise: Brown": ("JDC_BrownNoise", "generate_noise", {}),
    "DazNoise: Plasma": ("JDC_Plasma", "generate_plasma", {"turbulence": 2.75}),
    "DazNoise: Greyscale": ("JDC_GreyNoise", "generate_noise", {}),
    "DazNoise: Gaussian": ("JDC_OmniNoise", "generate_noise", {
        "noise_type": "Random", "random_distribution": "Gaussian (Centered Gray)",
    }),
}


def _get_plasma_fast():
    """Detect and return dazzle-comfy-plasma-fast's NODE_CLASS_MAPPINGS if available.

    Searches sys.modules for a module with NODE_CLASS_MAPPINGS containing JDC_OmniNoise
    (a reliable indicator of dazzle-comfy-plasma-fast). Falls back to path-based importlib.
    Only caches positive results — re-checks each call until found, since
    DazzleNodes may load smart-resolution-calc before dazzle-comfy-plasma-fast.

    Returns:
        dict (NODE_CLASS_MAPPINGS) or None
    """
    global _plasma_fast_module
    if _plasma_fast_module is not None:
        return _plasma_fast_module

    import sys

    # Check sys.modules for module with NODE_CLASS_MAPPINGS containing our target nodes.
    # We check for NODE_CLASS_MAPPINGS (ComfyUI-specific dict) to avoid false positives
    # from PyTorch's torch.ops which returns True for hasattr() on any attribute name.
    for name, mod in list(sys.modules.items()):
        if mod is None:
            continue
        try:
            mappings = getattr(mod, 'NODE_CLASS_MAPPINGS', None)
        except Exception:
            # Some modules have custom __getattr__ that raise non-AttributeError
            # exceptions (e.g. ImportError from SeedVR2's compatibility.py).
            # getattr's default only catches AttributeError, so we catch broadly.
            continue
        if isinstance(mappings, dict) and 'JDC_OmniNoise' in mappings:
            _plasma_fast_module = mappings
            logger.debug(f"Found dazzle-comfy-plasma-fast via sys.modules: {name}")
            print(f"[SmartResCalc] Detected dazzle-comfy-plasma-fast (DazNoise fill types enabled)")
            return mappings

    # Fallback: try known file paths with importlib
    import importlib.util
    try:
        import folder_paths
        base = folder_paths.base_path
        candidates = [
            os.path.join(base, 'custom_nodes', 'dazzle-comfy-plasma-fast', 'nodes.py'),
            os.path.join(base, 'custom_nodes', 'DazzleNodes', 'nodes', 'dazzle-comfy-plasma-fast', 'nodes.py'),
        ]
        for path in candidates:
            if os.path.exists(path):
                spec = importlib.util.spec_from_file_location("_plasma_fast_nodes", path)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                mappings = getattr(mod, 'NODE_CLASS_MAPPINGS', None)
                if isinstance(mappings, dict):
                    _plasma_fast_module = mappings
                    logger.debug(f"Found dazzle-comfy-plasma-fast via path: {path}")
                    print(f"[SmartResCalc] Detected dazzle-comfy-plasma-fast (DazNoise fill types enabled)")
                    return mappings
    except Exception as e:
        logger.debug(f"Path-based detection failed: {e}")

    return None


def _generate_daznoise(fill_type, width, height):
    """Generate noise using dazzle-comfy-plasma-fast generators.

    Args:
        fill_type: A DazNoise fill type string (e.g., "DazNoise: Pink")
        width: Image width
        height: Image height

    Returns:
        Tensor of shape (1, height, width, 3) with values 0.0-1.0,
        or None if generator is unavailable.
    """
    mappings = _get_plasma_fast()
    if mappings is None:
        return None

    node_id, method_name, extra_kwargs = _DAZNOISE_TYPE_MAP[fill_type]
    generator_class = mappings.get(node_id)
    if generator_class is None:
        logger.warning(f"Node '{node_id}' not found in dazzle-comfy-plasma-fast NODE_CLASS_MAPPINGS")
        return None

    generator = generator_class()
    # py_random was seeded by fill_seed earlier, so this randint is deterministic
    # when seed widget is ON. The py_random state determines the DazNoise seed.
    seed = py_random.randint(0, 2**32 - 1)
    generate_fn = getattr(generator, method_name)
    logger.debug(f"DazNoise: fill_type='{fill_type}', node_id='{node_id}', method='{method_name}', "
                 f"generator_seed={seed} (derived from py_random state), size={width}x{height}")

    try:
        result = generate_fn(
            width=width, height=height,
            value_min=-1, value_max=-1,
            red_min=-1, red_max=-1,
            green_min=-1, green_max=-1,
            blue_min=-1, blue_max=-1,
            seed=seed,
            **extra_kwargs
        )
        tensor = result[0]  # Unwrap from (tensor,) tuple
        logger.debug(f"DazNoise result: shape={tensor.shape}, min={tensor.min():.4f}, max={tensor.max():.4f}, mean={tensor.mean():.4f}")
        return tensor
    except Exception as e:
        logger.error(f"DazNoise generation failed for '{fill_type}': {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None


def spectral_noise_blend(pattern, gaussian, alpha=0.5, cutoff=0.2):
    """Blend structured noise pattern into Gaussian noise via spectral interpolation.

    Injects the low-frequency spatial structure of `pattern` into `gaussian` noise
    while preserving Gaussian statistics at each frequency bin. Uses power-preserving
    quadrature weights (sin/cos) to maintain correct variance.

    Args:
        pattern: Structured noise tensor (same shape as gaussian). Can be any
                 distribution — will be normalized to match Gaussian power.
        gaussian: Pure Gaussian noise tensor (torch.randn output).
        alpha: Blend strength 0.0-1.0. 0.0=pure Gaussian, 1.0=maximum blend.
        cutoff: Low-frequency cutoff as fraction of Nyquist (0.0-1.0).
                0.2 = blob-scale structure (~5 latent pixels = ~40 pixel-space pixels).

    Returns:
        Blended tensor with approximately N(0,1) per-channel statistics.
    """
    import math

    if alpha <= 0.0:
        return gaussian
    alpha = min(alpha, 1.0)

    H, W_spatial = gaussian.shape[-2], gaussian.shape[-1]
    device = gaussian.device
    dtype = gaussian.dtype

    # Ensure pattern is on the same device as gaussian
    pattern = pattern.to(device=device, dtype=dtype)

    # FFT both inputs (operates on last two dims = spatial H, W)
    F_gaussian = torch.fft.rfft2(gaussian, dim=(-2, -1))
    F_pattern = torch.fft.rfft2(pattern, dim=(-2, -1))

    # Normalize pattern FFT to match Gaussian expected power (global RMS)
    expected_rms = (H * W_spatial) ** 0.5
    pattern_rms = torch.sqrt(
        (torch.abs(F_pattern) ** 2).mean(dim=(-2, -1), keepdim=True) + 1e-8
    )
    F_pattern_norm = F_pattern * (expected_rms / (pattern_rms + 1e-8))

    # Build radial frequency mask with Gaussian rolloff
    freq_h = torch.fft.fftfreq(H, device=device, dtype=dtype)
    freq_w = torch.fft.rfftfreq(W_spatial, device=device, dtype=dtype)
    Fu, Fv = torch.meshgrid(freq_h, freq_w, indexing="ij")
    radial_norm = torch.sqrt(Fu ** 2 + Fv ** 2) / 0.5  # normalize: 1.0 = Nyquist

    W_mask = torch.exp(-0.5 * (radial_norm / cutoff) ** 2)
    # Expand to broadcast over batch and channel dims
    while W_mask.ndim < F_gaussian.ndim:
        W_mask = W_mask.unsqueeze(0)

    # Power-preserving quadrature blend at full strength
    # sin^2 + cos^2 = 1 guarantees power preservation at each frequency bin
    W_q = torch.sin(W_mask * (math.pi / 2))
    one_minus_W_q = torch.cos(W_mask * (math.pi / 2))
    F_full_blend = W_q * F_pattern_norm + one_minus_W_q * F_gaussian

    # Interpolate between pure Gaussian and full blend by alpha
    F_blended = (1.0 - alpha) * F_gaussian + alpha * F_full_blend

    # IFFT back to spatial domain
    blended = torch.fft.irfft2(F_blended, s=(H, W_spatial), dim=(-2, -1))

    # Post-blend per-channel normalization to unit std (safety correction)
    # This is the universal rule from the literature: always renormalize after
    # any spectral manipulation to maintain N(0,1) statistics
    std = blended.std(dim=(-2, -1), keepdim=True)
    blended = blended / (std + 1e-8)

    return blended


def pil2tensor(image):
    """Convert PIL image to tensor in the correct format"""
    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)
