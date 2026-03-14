# Spectral Blending

**Feature**: Inject noise pattern spatial structure into latent noise for composition control

## Overview

Spectral blending lets you influence the spatial composition of generated images by blending the low-frequency structure of a noise pattern (Plasma, Gaussian, etc.) into the latent noise that the diffusion model uses for generation. The result: your noise pattern's spatial layout subtly guides where objects, colors, and features appear in the generated image — while maintaining full prompt adherence.

This works by operating in the frequency domain (FFT), replacing low-frequency components of standard Gaussian noise with normalized components from your chosen noise pattern. A power-preserving quadrature blend ensures the noise maintains the N(0,1) statistics that diffusion models require.

## How to Use

1. Set `fill_type` to a noise pattern (e.g., DazNoise: Plasma)
2. Connect a **VAE** to the node
3. Set `blend_strength` to a value > 0 (start with 0.1)
4. Connect the **latent** output to your sampler
5. Set the sampler's seed to **-2** (if using patched ClownsharKSampler)

The `fill_type` controls the visual pattern (visible in the IMAGE output). The `blend_strength` controls how much that pattern's spatial structure influences the latent noise.

## Blend Strength Guide

The maximum usable `blend_strength` varies by noise type. Higher values inject more spatial structure but may reduce prompt adherence. The threshold depends on how much low-frequency energy the noise pattern contains.

### Empirical Thresholds (Qwen model, denoise=1.0, 19 steps)

| fill_type | Recommended | Max coherent | Notes |
|-----------|-------------|-------------|-------|
| DazNoise: Plasma | 0.10 - 0.15 | ~0.17 | Very strong low-frequency blobs. Only noise type that breaks coherence at moderate values. Most aesthetically distinctive at low blend. |
| DazNoise: Gaussian | 0.20 - 0.50 | 1.0 | Per-pixel noise, very close to standard Gaussian. Works at full blend. |
| DazNoise: Pink | 0.20 - 0.50 | 1.0 | Per-pixel noise with brightness bias. Works at full blend. |
| DazNoise: Brown | 0.20 - 0.50 | 1.0 | Per-pixel noise with extreme brightness bias. Produces more defined edges at high blend. Works at full blend. |
| DazNoise: Greyscale | 0.20 - 0.50 | 1.0 | Monochrome per-pixel noise. Works at full blend. |
| noise (built-in) | 0.20 - 0.50 | ~1.0 | Gaussian, std=0.1. Expected to match DazNoise: Gaussian behavior. |
| random (built-in) | 0.20 - 0.50 | ~1.0 | Uniform random per-pixel. Expected to work at full blend. |

**Key finding**: All per-pixel noise types (everything except Plasma) work at `blend_strength=1.0`. The coherence threshold is determined by **spatial correlation scale**, not noise distribution. Plasma has large coherent blobs (high spatial autocorrelation) that overwhelm the model; per-pixel noise types have minimal spatial correlation and are safe at any blend value.

**Note**: These thresholds were measured with Qwen Image model and may vary with other models (SD1.5, SDXL, FLUX, etc.). Models with stronger text conditioning may tolerate higher blend values.

### What Happens at Different Strengths

| blend_strength | Effect |
|---------------|--------|
| 0.0 | Pure Gaussian noise. No pattern influence. Identical to standard generation. |
| 0.05 - 0.10 | Very subtle. Slight spatial bias barely visible in output. Good for gentle composition nudging. |
| 0.10 - 0.15 | Moderate. Visible spatial influence on where objects/colors appear. Recommended starting point for Plasma. |
| 0.15 - 0.20 | Strong for Plasma, moderate for Gaussian. Composition clearly influenced by pattern layout. |
| 0.20 - 0.40 | Works well with Gaussian/flatter noise types. Plasma becomes abstract at these values. |
| 0.40 - 0.70 | Only works with noise types close to Gaussian distribution. Strong compositional control. |
| 0.70+ | Most noise types produce abstract output. Only very flat-spectrum noise remains coherent. |

### The Coherence Boundary

At the exact threshold (e.g., 0.17 for Plasma), something interesting happens: the model takes the dominant concept from the CLIP prompt and renders it coherently but with the **styling** of the noise pattern. This is effectively a novel form of **style transfer via initial noise** — the noise pattern's spatial structure becomes an aesthetic influence rather than a compositional one.

## Why Plasma Is Different

The coherence threshold is determined by **spatial correlation scale** — how large the coherent structures in the noise pattern are.

- **Per-pixel noise types** (Gaussian, Pink, Brown, Greyscale): Each pixel is independently generated. Even though Pink/Brown have frequency-biased distributions, their spatial autocorrelation is minimal — neighboring pixels are not strongly correlated. The diffusion model can denoise from these at any blend strength because the noise doesn't impose large-scale spatial structure.

- **Plasma**: Generated via diamond-square recursive subdivision, producing large coherent blobs where neighboring pixels are highly correlated across tens or hundreds of pixels. When this spatial structure is injected into latent noise (even after normalization), it creates strong low-frequency bias that overrides the model's ability to impose prompt-driven composition.

The spectral blending function normalizes the total power to match Gaussian noise, but it preserves the **spatial correlation structure** of the pattern. For per-pixel noise, this structure is minimal. For Plasma, it's dominant.

**Practical implication**: When using Plasma, keep blend_strength below ~0.17. For all other noise types, blend_strength=1.0 is safe. The visual differences between noise types at high blend create subtle aesthetic variations — Brown produces more defined edges, Pink has a brighter feel, Greyscale is more neutral.

## Workflow Patterns

### Diversity from a Single Seed

Keep the same `fill_seed` value but change `fill_type`:
- Same seed preserves facial structure and character identity
- Different noise types produce different compositions and styles
- This is a powerful tool for exploring visual variations without losing the "character" defined by the seed

### Style Exploration at the Boundary

Set `blend_strength` to the coherence boundary for your noise type:
- The output maintains the CLIP prompt's subject/concept
- But the spatial composition and visual style shift based on the noise pattern
- Plasma at 0.17-0.18 produces particularly striking stylized output

### Composition Control

Use noise patterns with specific spatial structure:
- Plasma blobs bias where large features appear
- Vertical/horizontal noise patterns could bias portrait vs landscape composition
- Asymmetric patterns bias object placement (future noise types could exploit this)

## Technical Details

### The Blending Algorithm

1. Generate pure Gaussian noise (`torch.randn`) in latent space, seeded by `fill_seed`
2. Generate the visual noise pattern (DazNoise, etc.) in pixel space
3. Resize the pixel pattern to latent spatial dimensions via bilinear interpolation
4. Tile RGB channels to match latent channel count (e.g., 3 -> 16 for Qwen)
5. FFT both tensors
6. Normalize pattern FFT to match Gaussian expected power (global RMS)
7. Build radial Gaussian rolloff frequency mask (cutoff=0.2 Nyquist)
8. Power-preserving quadrature blend: `sin(W*pi/2) * pattern + cos(W*pi/2) * gaussian`
9. Interpolate between pure Gaussian and blended by `blend_strength`
10. IFFT back to spatial domain
11. Per-channel normalization to unit standard deviation

### Why Quadrature Blend?

A naive linear blend `W*P + (1-W)*G` drops the variance at intermediate W values (since `W^2 + (1-W)^2 < 1` for W in (0,1)). The quadrature blend uses `sin^2 + cos^2 = 1` to preserve power at every frequency bin.

### Sampler Requirements

The blended noise is output via the **latent** pin with a `use_as_noise: True` flag. Standard ComfyUI samplers ignore this flag. To use the noise:

- **ClownsharKSampler (RES4LYF)**: Set seed to **-2**. Requires patched `beta/samplers.py` (included in `docs/code/`).
- **Standard KSampler**: Not supported. The sampler generates its own noise from seed.

See [extended-fill-types.md](extended-fill-types.md#sampler-integration-experimental) for patching instructions.

## Version History

- **v0.8.2**: Added spectral blending with `blend_strength` parameter
- **v0.8.1**: Raw `torch.randn()` latent noise (no pattern influence)
- **v0.8.0**: Seed widget, 5D VAE support, noise-to-latent pipeline
- **v0.7.0**: DazNoise extended fill types
