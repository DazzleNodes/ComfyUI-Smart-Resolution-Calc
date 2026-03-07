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

## Detection and Availability

| Condition | Available fill types |
|-----------|---------------------|
| DazzleNodes **not** installed | black, white, custom_color, noise, random |
| DazzleNodes **installed** | All 5 above + DazNoise: Pink, Brown, Plasma, Greyscale, Gaussian |
| `fill_image` **connected** | Fill type dropdown ignored; connected image used instead |

Detection is automatic. The node checks for the presence of `dazzle-comfy-plasma-fast` in ComfyUI's custom nodes at registration time. If found, the extended fill types appear in the dropdown. If not found, only the stock 5 fill types are shown -- no errors or warnings are generated.

## Version History

- **v0.7.0**: Added DazNoise extended fill types and fill_image input
