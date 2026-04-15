# Mask Input — Image Cutout Composite

Added in **v0.12.0**.

The `mask` input lets Smart Resolution Calculator cut regions out of the input image and fill the cut region with either a connected `fill_image` or the configured `fill_type` pattern — all at the calculated target resolution. It combines the behavior of [FitMaskToImage](https://github.com/DazzleNodes/ComfyUI-FitMaskToImage) (auto-fit mask to image dims) and ComfyUI core's `ImageCompositeMasked` (alpha-blend foreground over background) into a single node.

## TL;DR

1. Connect an `IMAGE` to the `image` input.
2. Connect a `MASK` to the `mask` input (e.g., from `LoadImage`'s MASK output, or from MaskEditor in clipspace).
3. Choose a `fill_type` (or connect a `fill_image` to override it).
4. Queue. Wherever the mask is `0`, the fill shows through. Wherever the mask is `1`, the input image shows through.

The mask is auto-fit (nearest-exact) to whatever the calculator's output resolution ends up being, so it works regardless of scale, divisibility rounding, or `output_image_mode`.

## Where the socket lives

The `mask` nub appears on the left side of the node, directly above `dazzle_options` and `dazzle_signal`. It's `optional` — the node runs identically to v0.11.x when the socket is empty.

## Convention

- **mask = 1** → keep the input image pixel
- **mask = 0** → replace with fill (`fill_image` if connected, else `fill_type` pattern)
- **fractional values** → smooth alpha-blend between the two

Matches ComfyUI's standard `MASK` convention. The cut is done with `out = mask * fg + (1 - mask) * bg`.

## Interaction with `output_image_mode`

The composite is applied **after** the transform mode runs, so the mask automatically fits the final output dimensions:

| `output_image_mode` | Behavior with mask |
|---|---|
| `auto` / `transform (distort)` | Image distorted to target dims, then composited |
| `transform (crop/pad)` | Image cropped/padded, then composited |
| `transform (scale/crop)` | Image scaled-to-cover, then composited |
| `transform (scale/pad)` | Image scaled-to-fit with padding, then composited |
| `empty` | **Mask ignored** — no input-image content to cut |

## Interaction with `image_purpose`

The mask only applies when the input image is being emitted to the IMAGE output. The `image_purpose` routing determines this:

| `image_purpose` | Mask behavior |
|---|---|
| `img2img` | Composite applied to IMAGE; LATENT = VAE-encoded composite |
| `image + noise` | Composite applied to IMAGE; LATENT = independent noise (unaffected by mask) |
| `img2img + img2noise` | Composite applied to IMAGE and to LATENT (VAE-encoded composite) + image-shaped spectral noise derived from the composite |
| `img2noise` | IMAGE = fill pattern (no input image to cut). **Mask still applied** to the spectral pattern source so noise shape reflects the cut region, not the full image. |
| `dimensions only` | Input image not emitted; mask ignored with a debug log |

## Examples

### Simple cutout onto noise
- `image_purpose = img2img`
- `fill_type = DazNoise:pink`
- `mask = <masked region of interest>`

Result: input image with masked-out regions replaced by pink-brightness-biased noise, at the calculator's target resolution.

### Composite onto a custom fill image
- `image_purpose = img2img`
- `fill_image = <connected secondary image>`
- `mask = <shape to cut from the primary image>`

Result: `ImageCompositeMasked`-style blend. The `fill_image` is scaled to target dims and shows where the mask is 0; the primary image shows where the mask is 1.

### Composition transfer from a cut region only
- `image_purpose = img2noise`
- `blend_strength = 1.0`, `cutoff = 0.2`
- `mask = <cut region>`

Result: IMAGE output is pure fill. LATENT carries image-shaped noise whose spatial structure is derived **only** from the masked region of the input image, not the full image.

## Caching & mask edits

The node's `IS_CHANGED` fingerprints the mask (shape + sum + mean) so editing the mask in ComfyUI's MaskEditor and re-queuing triggers re-execution. No manual cache clear is needed.

## Notes & gotchas

- **Device alignment** is handled automatically — GPU-bound fills (like `DazNoise:*`) compose correctly with CPU-bound masks from `LoadImage`.
- **Batch broadcasting** — if the mask batch size differs from the image batch size (one is `1`, the other is `N`), the smaller one is expanded.
- **Different-resolution masks** — the mask is auto-fit (nearest-exact) to the calculator's output dims, so a `512×512` mask on a `1024×1024` image works without pre-scaling.
- **Empty mask** (all-zero) — the input image becomes fully invisible; output is the fill pattern only.
- **Full mask** (all-one) — the input image is preserved; the fill is invisible.
- For true inpainting (attach a `noise_mask` to the latent so KSampler only denoises the cut region), chain a dedicated inpainting node; this release is composite-only.

## See Also

- [Image Purpose Guide](image-purpose.md)
- [Extended Fill Types](extended-fill-types.md)
- [Spectral Blending](spectral-blending.md)
- Shipped workflow fixture: `docs/workflow/SmartResCalc-Mask-Test-Workflow.json`
