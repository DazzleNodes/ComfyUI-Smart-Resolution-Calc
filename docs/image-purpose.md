# Image Purpose Guide

**Version**: 0.10.0+
**Feature**: Control how the connected image affects the IMAGE and LATENT outputs

## Overview

When you connect an image to Smart Resolution Calculator, the `image_purpose` dropdown controls **what the node does with that image**. By default (`img2img`), the node transforms the image and VAE-encodes it to the latent output — standard img2img behavior. But you might want the image only for its dimensions, or to use its spatial structure to shape noise for composition control.

`image_purpose` decouples three things that were previously linked:
1. **Dimension extraction** — using the image's width/height/aspect ratio
2. **IMAGE output** — what appears on the IMAGE output nub
3. **LATENT output** — what appears on the LATENT output nub

## Quick Reference

| image_purpose | INPUT image used for | OUTPUT image | OUTPUT latent |
|---------------|---------------------|-------------|--------------|
| **img2img** | Dimensions + transform + encode | Transformed image | VAE-encoded image |
| **dimensions only** | Dimensions/AR only | fill_type pattern | Seeded noise |
| **img2noise** | Dimensions + noise shaping | fill_type pattern | Image-shaped noise |
| **image + noise** | Dimensions + transform | Transformed image | Seeded noise |
| **img2img + img2noise** | Dimensions + transform + encode + noise | Transformed image | VAE-encoded + image-shaped noise |

## Modes in Detail

### img2img

**What it does**: Exactly what SmartResCalc has always done. Connecting an image transforms it per `output_image_mode` and VAE-encodes it into the latent.

**Use case**: Standard img2img workflows, upscaling, dimension matching.

**Outputs**:
- **IMAGE**: Input image transformed to target dimensions (distort, crop/pad, scale/crop, scale/pad)
- **LATENT**: VAE-encoded transformed image (ready for KSampler at denoise 0.3-0.7)

**When to use**: You want to refine or modify an existing image.

### dimensions only

**What it does**: Uses the input image purely for dimension and aspect ratio extraction. The image does NOT appear in any output. The IMAGE output shows whatever `fill_type` pattern you've selected, and the LATENT output contains seeded Gaussian noise (optionally with spectral blending from the fill pattern).

**Use case**: You have a reference image whose proportions you want to match, but you're generating from scratch (txt2img).

**Outputs**:
- **IMAGE**: fill_type pattern (Plasma, Gaussian, etc.) at the image's dimensions
- **LATENT**: Seeded noise shaped by fill_type (if `blend_strength > 0`)

**When to use**: "Match this photo's aspect ratio but generate something completely new."

### img2noise

**What it does**: Uses the input image's spatial structure (composition, layout, color distribution) as the pattern source for spectral noise blending. Instead of using the fill_type noise as the blend pattern, it uses the IMAGE itself. The result is noise that carries the image's low-frequency spatial structure — objects tend to appear where the image had similar features.

**Use case**: Composition transfer. A photo's layout guides where the model places objects, but style and content are fully prompt-driven.

**Outputs**:
- **IMAGE**: fill_type pattern (not the input image)
- **LATENT**: Spectrally-blended noise where the input image shapes the spatial structure

**Key parameters**:
- `blend_strength`: Controls how much image structure influences noise (defaults to 0.15 if not set). Real images have much more low-frequency content than noise patterns, so use lower values than you would with DazNoise fills.
- `fill_seed`: Controls the base Gaussian noise pattern. Same seed = same base noise.

**When to use**: "Use this photo as a composition blueprint but generate with full creative freedom."

**Empirical thresholds** (may vary by model and image):
- Photos: 0.05-0.15 (strong low-frequency content)
- Sketches: 0.10-0.25 (less low-frequency energy)
- Noise patterns: 0.15-0.50 (similar to existing DazNoise behavior)

### image + noise

**What it does**: Independent output paths. The IMAGE output gets the transformed input image (per `output_image_mode`), but the LATENT output gets seeded noise — NOT a VAE-encoded version of the image.

**Use case**: You want the transformed image for preview or downstream processing, but the latent should be fresh noise for txt2img generation.

**Outputs**:
- **IMAGE**: Input image transformed to target dimensions
- **LATENT**: Seeded noise from fill_type (with optional spectral blending)

**When to use**: "Show me the transformed image, but generate the latent from scratch."

### img2img + img2noise (layered)

**What it does**: The most advanced mode. Both VAE-encodes the image AND generates image-shaped noise. The latent dict contains both `samples` (VAE-encoded image) and `noise` (spectrally-blended noise shaped by the same image).

Standard img2img adds random noise to corrupt the image. This mode instead adds **image-shaped noise** — noise that reinforces the image's own spatial structure. The corruption noise agrees with the image's composition instead of fighting it.

**Use case**: Higher-denoise img2img that maintains structural fidelity. Because both the preserved image AND the added noise share the same spatial frequency profile, you can use higher denoise values while keeping composition.

**Outputs**:
- **IMAGE**: Input image transformed to target dimensions
- **LATENT**: Dict with `samples` (VAE-encoded) + `noise` (image-shaped) + `use_as_noise` flag

**Requirements**: The sampler must support reading the `noise` key from the latent dict. ClownsharKSampler with `seed=-2` supports this.

**When to use**: "Img2img but with self-consistent noise for more creative freedom at higher denoise."

## Widget Visibility

When `image_purpose` is set to a mode that uses image transforms (`auto`, `image + noise`, `img2img + img2noise`), the `output_image_mode` dropdown is visible so you can choose the transform type.

When set to `dimensions only` or `img2noise`, `output_image_mode` is hidden because the IMAGE output shows the fill pattern, not the transformed image.

## Relationship to Other Parameters

| Parameter | Interaction with image_purpose |
|-----------|-------------------------------|
| **USE IMAGE DIMS** | Always works — dimension extraction is independent of image_purpose |
| **output_image_mode** | Only visible/relevant when image_purpose uses transforms |
| **fill_type** | Controls IMAGE output pattern when image_purpose doesn't use image for output |
| **blend_strength** | Controls spectral blend for noise latent. For img2noise, defaults to 0.15 if 0.0 |
| **fill_seed** | Controls noise RNG. Same seed = same noise pattern regardless of image_purpose |

## Examples

### Composition Transfer with img2noise

```
Load Image (photo of a landscape)
  -> Smart Resolution Calculator
       image_purpose: img2noise
       blend_strength: 0.10
       fill_seed: ON, value: 42
       fill_type: DazNoise: Gaussian
  -> KSampler
       denoise: 1.0 (full generation)
       prompt: "beautiful sunset over mountains, oil painting"
```

The generated image will have objects and color regions roughly following the photo's spatial layout, but rendered as an oil painting per the prompt.

### Dimension Matching without Image Influence

```
Load Image (reference photo)
  -> Smart Resolution Calculator
       image_purpose: dimensions only
       USE IMAGE DIMS: ON, AR Only
       fill_type: black
  -> KSampler
       denoise: 1.0
       prompt: "portrait of a woman"
```

The generated image matches the reference photo's aspect ratio but the image itself has zero influence on the output.

## Related Documentation

- **[Spectral Blending Guide](spectral-blending.md)** — algorithm details, blend_strength thresholds, cutoff parameter, and the math behind FFT-based noise shaping
- **[Extended Fill Types](extended-fill-types.md)** — DazNoise fill patterns, seed control, and sampler integration
- **[Image Input Guide](image-input.md)** — dimension extraction, USE IMAGE DIMS, and Copy from Image

## Version History

- **v0.10.0**: Added image_purpose widget with 5 modes (img2img, dimensions only, img2noise, image + noise, img2img + img2noise)
