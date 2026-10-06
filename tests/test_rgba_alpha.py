"""
RGBA (alpha) handling: an image with an alpha channel keeps it through the node.

Covers the three places an RGBA input used to lose its alpha or break the node:
  - VAE encode (img2img latent and img2noise pattern) trimmed to 3 channels, so an
    RGBA-capable VAE (Qwen Image 2.1) never saw the alpha
  - scale/pad and crop/pad pasted a 4-channel image into a 3-channel fill canvas
  - composite_with_mask refused a 3-channel background under a 4-channel image

Fill areas added under an RGBA image are opaque (alpha 1), matching ComfyUI's VAE,
which pads an RGB image with alpha 1.0.

Uses stub VAEs and a torch stand-in for comfy.utils.common_upscale -- no ComfyUI or GPU.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock
import torch
import torch.nn.functional as F

# Mock ComfyUI modules before importing our code; common_upscale gets a real resize
comfy_utils = MagicMock()
comfy_utils.common_upscale = lambda samples, width, height, method, crop: F.interpolate(samples, size=(height, width), mode="nearest")
sys.modules['comfy'] = MagicMock(utils=comfy_utils)
sys.modules['comfy.model_management'] = MagicMock()
sys.modules['comfy.utils'] = comfy_utils

project_root = str(Path(__file__).parent.parent)
sys.path.insert(0, project_root)

from py.image_utils import match_channels, composite_with_mask, transform_image_scale_pad, transform_image_crop_pad
from py.smart_resolution_calc import SmartResolutionCalc
from py.dazzle_options import DazzleOptionsNode, resolve_fill_alpha


class StubVAE:
    """Records what encode() receives. output_channels=None -> attribute absent (ComfyUI < 0.6.0)."""
    def __init__(self, output_channels):
        if output_channels is not None:
            self.output_channels = output_channels
        self.latent_channels = 16
        self.encoded = []

    def spacial_compression_encode(self):
        return 8

    def encode(self, pixels):
        self.encoded.append(tuple(pixels.shape))
        self.last_pixels = pixels
        b, h, w, _ = pixels.shape
        return torch.zeros((b, self.latent_channels, h // 8, w // 8))


def rgba(h=32, w=48):
    """RGBA image: left half transparent (alpha 0), right half opaque."""
    img = torch.rand((1, h, w, 4))
    img[..., 3] = 0.0
    img[:, :, w // 2:, 3] = 1.0
    return img


def encode_latent(vae, image, **kw):
    node = SmartResolutionCalc()
    node.device = "cpu"  # comfy.model_management is mocked
    args = dict(vae=vae, image=image, output_image=image, actual_mode="transform (distort)",
                w=image.shape[2], h=image.shape[1], batch_size=1, fill_type="black", fill_image=None,
                blend_strength=0.0, cutoff=0.2, seed_active=False, actual_seed=-1, cache_key=None)
    args.update(kw)
    return node._generate_latent(**args)


# --- match_channels ---

def test_match_channels_adds_opaque_alpha():
    out = match_channels(torch.zeros((1, 4, 4, 3)), 4)
    assert out.shape == (1, 4, 4, 4)
    assert torch.all(out[..., 3] == 1.0)
    assert torch.all(out[..., :3] == 0.0)


def test_match_channels_trims_and_keeps():
    img = torch.rand((1, 4, 4, 4))
    assert torch.equal(match_channels(img, 3), img[..., :3])
    assert match_channels(img, 4) is img


# --- pad transforms ---

def test_scale_pad_keeps_alpha_and_fill_is_opaque():
    img = rgba(32, 48)  # 3:2
    out = transform_image_scale_pad(img, 48, 48, "black", "#000000", None)  # 1:1 -> pads top/bottom by 8
    assert out.shape == (1, 48, 48, 4)
    assert torch.all(out[:, :8, :, 3] == 1.0), "padded rows should be opaque fill"
    assert torch.all(out[:, 8:40, :24, 3] == 0.0), "transparent half of the image stays transparent"
    assert torch.all(out[:, 8:40, 24:, 3] == 1.0)


def test_crop_pad_keeps_alpha_and_fill_is_opaque():
    img = rgba(32, 48)
    out = transform_image_crop_pad(img, 48, 48, "black", "#000000", None)
    assert out.shape == (1, 48, 48, 4)
    assert torch.all(out[:, :8, :, 3] == 1.0)
    assert torch.all(out[:, 8:40, :24, 3] == 0.0)


def test_scale_pad_rgb_unchanged():
    img = torch.rand((1, 32, 48, 3))
    out = transform_image_scale_pad(img, 48, 48, "black", "#000000", None)
    assert out.shape == (1, 48, 48, 3)


# --- mask composite ---

def test_composite_rgba_over_rgb_fill():
    fg = rgba(16, 16)
    bg = torch.zeros((1, 16, 16, 3))
    mask = torch.zeros((1, 16, 16))
    mask[:, :, 8:] = 1.0  # keep fg on the right, fill on the left
    out = composite_with_mask(fg, bg, mask)
    assert out.shape == (1, 16, 16, 4)
    assert torch.all(out[:, :, :8, 3] == 1.0), "fill area is opaque"
    assert torch.allclose(out[:, :, 8:, :], fg[:, :, 8:, :])


# --- VAE encode ---

def test_encode_passes_alpha_to_rgba_vae():
    vae = StubVAE(output_channels=4)
    encode_latent(vae, rgba())
    assert vae.encoded and vae.encoded[0][-1] == 4, f"RGBA VAE got {vae.encoded}"


def test_encode_trims_alpha_for_rgb_vae():
    vae = StubVAE(output_channels=3)
    encode_latent(vae, rgba())
    assert vae.encoded[0][-1] == 3


def test_encode_trims_alpha_when_vae_has_no_output_channels():
    vae = StubVAE(output_channels=None)  # ComfyUI < 0.6.0
    encode_latent(vae, rgba())
    assert vae.encoded[0][-1] == 3


def test_img2noise_pattern_passes_alpha_to_rgba_vae():
    vae = StubVAE(output_channels=4)
    # raw-noise branch needs a non-trivial fill (has_nontrivial_fill)
    encode_latent(vae, rgba(), fill_type="noise", use_image_for_latent_encode=False, use_image_for_noise_shape=True,
                  noise_shape_transform="transform (distort)", seed_active=True, actual_seed=1)
    assert vae.encoded, "img2noise path should VAE-encode the pattern image"
    assert all(s[-1] == 4 for s in vae.encoded), f"RGBA VAE got {vae.encoded}"


# --- DazzleOptions fill_alpha (default opaque = the behaviour before the option existed) ---

def output_image(image, mode, dazzle_options=None, mask=None, w=48, h=48):
    """Run the node's IMAGE path the way calculate_dimensions does: fill_alpha resolved from the options."""
    node = SmartResolutionCalc()
    node.device = "cpu"
    return node._generate_output_image(mode, image, w, h, "custom_color", "#00ff00", 1, None, None, False, -1,
                                       mask=mask, fill_alpha=resolve_fill_alpha(dazzle_options))


def test_fill_alpha_option_defaults_to_opaque():
    (opts,) = DazzleOptionsNode().configure()
    assert opts["fill_alpha"] == "opaque"
    assert resolve_fill_alpha(opts) == 1.0
    assert resolve_fill_alpha(None) == 1.0, "no DazzleOptions connected = opaque"
    assert resolve_fill_alpha({"norm_mode": "auto"}) == 1.0, "options without fill_alpha = opaque"
    assert resolve_fill_alpha({"fill_alpha": "transparent"}) == 0.0


def test_fill_alpha_widget_is_last():
    # Saved workflows store widget values by position; a widget added anywhere but last would shift them
    optional = list(DazzleOptionsNode.INPUT_TYPES()["optional"])
    assert optional[-1] == "fill_alpha" and optional[:4] == ["norm_mode", "whitening", "cutoff_curve", "phase_randomize"]


def test_scale_pad_transparent_fill():
    out = transform_image_scale_pad(rgba(32, 48), 48, 48, "black", "#000000", None, 0.0)
    assert torch.all(out[:, :8, :, 3] == 0.0), "padded rows should be transparent"
    assert torch.all(out[:, 8:40, 24:, 3] == 1.0), "opaque half of the image stays opaque"


def test_crop_pad_transparent_fill():
    out = transform_image_crop_pad(rgba(32, 48), 48, 48, "black", "#000000", None, 0.0)
    assert torch.all(out[:, :8, :, 3] == 0.0)
    assert torch.all(out[:, 8:40, 24:, 3] == 1.0)


def test_composite_transparent_fill():
    fg = rgba(16, 16)
    fg[..., 3] = 1.0
    mask = torch.zeros((1, 16, 16))
    mask[:, :, 8:] = 1.0
    out = composite_with_mask(fg, torch.zeros((1, 16, 16, 3)), mask, 0.0)
    assert torch.all(out[:, :, :8, 3] == 0.0), "fill area is transparent"
    assert torch.all(out[:, :, 8:, 3] == 1.0)


def test_node_default_pad_is_opaque():
    out = output_image(rgba(32, 48), "transform (scale/pad)")
    assert torch.all(out[:, :8, :, 3] == 1.0), "without DazzleOptions the padding is opaque fill"
    assert torch.all(out[:, :8, :, 1] == 1.0) and torch.all(out[:, :8, :, 0] == 0.0), "padding shows the fill colour"


def test_node_transparent_pad_keeps_fill_rgb():
    out = output_image(rgba(32, 48), "transform (scale/pad)", {"fill_alpha": "transparent"})
    assert torch.all(out[:, :8, :, 3] == 0.0), "fill_alpha=transparent makes the padding transparent"
    assert torch.all(out[:, :8, :, 1] == 1.0), "the fill pattern stays in the RGB underneath"
    assert torch.all(out[:, 8:40, :24, 3] == 0.0) and torch.all(out[:, 8:40, 24:, 3] == 1.0), "image alpha kept"


def test_node_mask_default_uses_opaque_fill():
    mask = torch.zeros((1, 48, 48))
    mask[:, :, 24:] = 1.0  # keep the right half, fill the left
    img = rgba(48, 48)
    img[..., 3] = 1.0
    out = output_image(img, "transform (distort)", mask=mask)
    assert torch.all(out[:, :, :24, 3] == 1.0) and torch.all(out[:, :, :24, 1] == 1.0), "mask fill is the opaque fill pattern"


def test_node_mask_transparent_fill():
    mask = torch.zeros((1, 48, 48))
    mask[:, :, 24:] = 1.0
    img = rgba(48, 48)
    img[..., 3] = 1.0
    out = output_image(img, "transform (distort)", {"fill_alpha": "transparent"}, mask=mask)
    assert torch.all(out[:, :, :24, 3] == 0.0), "mask fill area is transparent"
    assert torch.all(out[:, :, 24:, 3] == 1.0)


def test_context_resolves_fill_alpha_from_options():
    from py.smart_resolution_calc import CalculationContext
    base = dict(aspect_ratio="1:1", divisible_by="16", custom_ratio=False, custom_aspect_ratio="1:1", batch_size=1,
                scale=1.0, image=None, vae=None, image_purpose="img2img", output_image_mode="auto", fill_type="black",
                fill_color="#000000", blend_strength=0.0, cutoff=0.2, feature_size=-1, fill_image=None, mask=None,
                fill_seed=None, kwargs={})
    assert CalculationContext(dazzle_options=None, **base).fill_alpha == 1.0
    assert CalculationContext(dazzle_options={"fill_alpha": "transparent"}, **base).fill_alpha == 0.0


def test_img2noise_cache_misses_when_fill_alpha_changes():
    # The pattern source differs with fill_alpha, so a cached noise latent from the other setting must not be reused
    node = SmartResolutionCalc()
    node.device = "cpu"
    vae = StubVAE(output_channels=4)
    args = dict(vae=vae, image=rgba(32, 48), output_image=rgba(32, 48), actual_mode="transform (distort)", w=48, h=48,
                batch_size=1, fill_type="noise", fill_image=None, blend_strength=0.0, cutoff=0.2, seed_active=True,
                actual_seed=1, cache_key=("k",), use_image_for_latent_encode=False, use_image_for_noise_shape=True,
                noise_shape_transform="transform (scale/pad)")
    node._generate_latent(dazzle_options={"fill_alpha": "opaque"}, **args)
    n = len(vae.encoded)
    node._generate_latent(dazzle_options={"fill_alpha": "transparent"}, **args)
    assert len(vae.encoded) > n, "changing fill_alpha should regenerate the img2noise pattern"


def test_node_crop_pad_transparent_fill():
    out = output_image(rgba(32, 48), "transform (crop/pad)", {"fill_alpha": "transparent"})
    assert torch.all(out[:, :8, :, 3] == 0.0)


def test_img2noise_pattern_pad_follows_fill_alpha():
    for mode, expected in (("opaque", 1.0), ("transparent", 0.0)):
        vae = StubVAE(output_channels=4)
        encode_latent(vae, rgba(32, 48), w=48, h=48, fill_type="noise", use_image_for_latent_encode=False,
                      use_image_for_noise_shape=True, noise_shape_transform="transform (scale/pad)",
                      seed_active=True, actual_seed=1, dazzle_options={"fill_alpha": mode})
        assert torch.all(vae.last_pixels[:, :8, :, 3] == expected), f"img2noise pattern padding with fill_alpha={mode}"


def test_calculate_dimensions_passes_fill_alpha_to_output():
    # The node's entry point: DazzleOptions -> context -> IMAGE output (the wiring between them)
    node = SmartResolutionCalc()
    node.device = "cpu"
    common = dict(aspect_ratio="1:1 (Square - Instagram/Profile)", divisible_by="16", image=rgba(32, 48),
                  output_image_mode="transform (scale/pad)", fill_type="custom_color", fill_color="#00ff00",
                  dimension_height={"on": True, "value": 48}, image_mode={"on": False, "value": 0})
    opaque = node.calculate_dimensions(**common)[5]
    node2 = SmartResolutionCalc()
    node2.device = "cpu"
    transparent = node2.calculate_dimensions(dazzle_options={"fill_alpha": "transparent"}, **common)[5]
    assert opaque.shape[1:] == (48, 48, 4) and transparent.shape[1:] == (48, 48, 4)
    assert torch.all(opaque[:, :8, :, 3] == 1.0)
    assert torch.all(transparent[:, :8, :, 3] == 0.0)


def test_node_rgb_image_ignores_fill_alpha():
    out = output_image(torch.rand((1, 32, 48, 3)), "transform (scale/pad)", {"fill_alpha": "transparent"})
    assert out.shape[-1] == 3, "an RGB image stays RGB"


if __name__ == '__main__':
    import traceback

    tests = [
        test_match_channels_adds_opaque_alpha,
        test_match_channels_trims_and_keeps,
        test_scale_pad_keeps_alpha_and_fill_is_opaque,
        test_crop_pad_keeps_alpha_and_fill_is_opaque,
        test_scale_pad_rgb_unchanged,
        test_composite_rgba_over_rgb_fill,
        test_encode_passes_alpha_to_rgba_vae,
        test_encode_trims_alpha_for_rgb_vae,
        test_encode_trims_alpha_when_vae_has_no_output_channels,
        test_img2noise_pattern_passes_alpha_to_rgba_vae,
        test_fill_alpha_option_defaults_to_opaque,
        test_fill_alpha_widget_is_last,
        test_scale_pad_transparent_fill,
        test_crop_pad_transparent_fill,
        test_composite_transparent_fill,
        test_node_default_pad_is_opaque,
        test_node_transparent_pad_keeps_fill_rgb,
        test_node_mask_default_uses_opaque_fill,
        test_node_mask_transparent_fill,
        test_context_resolves_fill_alpha_from_options,
        test_img2noise_cache_misses_when_fill_alpha_changes,
        test_node_crop_pad_transparent_fill,
        test_img2noise_pattern_pad_follows_fill_alpha,
        test_calculate_dimensions_passes_fill_alpha_to_output,
        test_node_rgb_image_ignores_fill_alpha,
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
        sys.exit(1)
