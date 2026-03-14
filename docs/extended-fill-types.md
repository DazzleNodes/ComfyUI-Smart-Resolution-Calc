# Extended Fill Types

**Feature**: Additional noise fill patterns via DazzleNodes integration

## Overview

Smart Resolution Calculator includes 5 built-in fill types for empty image generation: `black`, `white`, `custom_color`, `noise`, and `random`. These are always available regardless of what other nodes are installed.

When [dazzle-comfy-plasma-fast](https://github.com/DazzleNodes/dazzle-comfy-plasma-fast) (included in the [DazzleNodes](https://github.com/DazzleNodes/DazzleNodes) aggregate pack) is detected, 4 additional DazNoise fill patterns are automatically added to the `fill_type` dropdown. No configuration is needed -- detection happens at node registration time.

## DazNoise Fill Types

### DazNoise: Pink

Brightness-biased noise using cube root transformation. Produces lighter, more visible noise compared to standard uniform noise. The cube root mapping shifts the distribution toward higher values, resulting in a predominantly bright, airy texture.

### DazNoise: Brown

Extreme brightness-biased noise using double cube root transformation. Very light, highlight-heavy noise where most pixel values cluster near white. Useful when you want a nearly washed-out noise pattern with subtle variation.

### DazNoise: Plasma

Organic cloud-like patterns generated via diamond-square recursive subdivision. Produces smooth, flowing gradients that resemble plasma or clouds. Good for natural-looking backgrounds, organic textures, or as a starting point for artistic generation.

### DazNoise: Greyscale

Monochrome noise where a single random value is generated per pixel and mapped identically across all three RGB channels. The result is pure grey-tone noise without any color cast.

### DazNoise: Gaussian

Wide Gaussian noise centered on gray (mean=0.5, std=0.25). Produces a broader spread than the built-in `noise` fill type (which uses std=0.1). Generated via OmniNoise with Gaussian distribution mode. Good for backgrounds that need more variation than the tighter built-in Gaussian.

## Custom Fill via fill_image Input

In addition to the dropdown fill types, a `fill_image` IMAGE input is available on the node. When an image is connected to this input, it overrides the `fill_type` selection entirely.

The connected image is scaled to match the calculated target dimensions. This means you can connect any noise generator (such as OmniNoise from DazzleNodes), any preprocessor output, or any image source as your custom fill.

### Usage

1. Connect any IMAGE output to the `fill_image` input on the node
2. The `fill_type` dropdown is ignored when `fill_image` is connected
3. The connected image is resized to the node's calculated width and height

This is useful for workflows where you want precise control over the fill pattern, or want to use a specialized noise generator that produces patterns not covered by the built-in options.

## Seed Control for Noise Fills (v0.8.0+)

The **SEED widget** controls reproducibility of noise fills. When the seed toggle is ON, the RNG is seeded before generating the noise pattern, making the result deterministic.

| Seed Widget State | Behavior |
|-------------------|----------|
| Toggle **ON**, value >= 0 | Fixed seed -- same noise pattern every time |
| Toggle **ON**, value = -1 | Randomize each time (new random seed per queue) |
| Toggle **ON**, value = -2/-3 | Increment/decrement last seed |
| Toggle **OFF** | No RNG seeding; noise is non-reproducible; value passes through literally |

**Buttons** (always functional in both ON/OFF modes):
- **Dice** -- Set value to -1 (randomize each time when ON)
- **Lock** -- Generate a new random seed value
- **Recycle** -- Recall the last seed actually used (grayed when none)

Note: When `fill_type` is `black`, `white`, or `custom_color`, the seed widget has no effect (these fills are deterministic regardless). When `fill_image` is connected, the seed is also irrelevant.

## VAE Encoding of Noise Fills (v0.8.0+)

When a **VAE is connected** to the node and `fill_type` is a non-trivial noise pattern, the generated noise image is VAE-encoded into the **latent output**:

| Condition | Latent output |
|-----------|--------------|
| VAE connected + trivial fill (black/white/custom_color) | Empty zeros latent |
| VAE connected + noise fill (noise/random/DazNoise) | VAE-encoded noise image |
| VAE connected + `fill_image` connected | VAE-encoded fill image |
| VAE not connected | Empty zeros latent (regardless of fill) |

The latent dict includes a `use_as_noise: True` flag when the noise fill is VAE-encoded. This flag is intended for downstream sampler integration (see below).

**Caching**: DazNoise generation and VAE encoding are cached. If the seed, fill_type, and dimensions are unchanged between runs, the cached result is reused (saves ~10s for expensive patterns like Plasma).

### Important: VAE-Encoded Noise vs Diffusion Noise

VAE-encoded noise images are NOT the same as the Gaussian noise that diffusion models expect for sampling. VAE-encoded noise lives in the VAE's learned latent manifold, while diffusion noise is raw `torch.randn()`. At denoise=1.0, using VAE-encoded noise as the sampler's starting noise produces abstract art rather than prompt-adherent images.

For txt2img workflows, a future update will generate raw latent-space noise directly (bypassing VAE encoding) to produce proper diffusion-compatible noise.

## Sampler Integration (Experimental)

The `use_as_noise` latent flag enables downstream samplers to use SmartResCalc's noise-filled latent as initial noise. This requires sampler-side support and does **NOT** work out-of-the-box with standard ComfyUI nodes.

### ClownsharKSampler (RES4LYF)

A pre-patched copy of `beta/samplers.py` is included at [`docs/code/RES4LYF_beta_samplers.py`](code/RES4LYF_beta_samplers.py). To use it, copy it over your existing file:

```
copy docs\code\RES4LYF_beta_samplers.py custom_nodes\RES4LYF\beta\samplers.py
```

The patches make three changes:

1. **Propagate the flag** through `latent_x` (around line 336):
   ```python
   if latent_image.get('use_as_noise', False):
       latent_x['use_as_noise'] = True
   ```

2. **Check the flag** in the noise generation section (around line 549):
   ```python
   use_latent_as_noise = latent_unbatch.get("use_as_noise", False)
   if use_latent_as_noise and noise_seed == -2:
       noise = x.clone()
   ```

3. **Lower the seed minimum** from -1 to -2 in `INPUT_TYPES` (both `SharkSampler` and `ClownsharKSampler_Beta`)

Set ClownsharKSampler's seed to **-2** to activate noise passthrough. All other seed values use standard behavior.

### Standard KSampler

Not supported. The standard KSampler ignores custom keys in the latent dict.

## Detection and Availability

| Condition | Available fill types |
|-----------|---------------------|
| DazzleNodes **not** installed | black, white, custom_color, noise, random |
| DazzleNodes **installed** | All 5 above + DazNoise: Pink, Brown, Plasma, Greyscale, Gaussian |
| `fill_image` **connected** | Fill type dropdown ignored; connected image used instead |

Detection is automatic. The node checks for the presence of `dazzle-comfy-plasma-fast` in ComfyUI's custom nodes at registration time. If found, the extended fill types appear in the dropdown. If not found, only the stock 5 fill types are shown -- no errors or warnings are generated.

## Version History

- **v0.8.0**: Seed widget, VAE encoding of noise fills, noise caching, `fill_type` always visible, sampler integration docs
- **v0.7.0**: Added DazNoise extended fill types and fill_image input
