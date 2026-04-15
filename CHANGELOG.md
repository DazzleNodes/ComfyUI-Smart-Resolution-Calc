# Changelog

All notable changes to ComfyUI Smart Resolution Calculator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.0] - 2026-04-15

### Added
- **Mask input** — new optional `MASK` socket on `SmartResolutionCalc`, positioned
  above `dazzle_options` / `dazzle_signal`. When connected, cuts regions out of the
  input image and replaces them with the connected `fill_image` (if present) or the
  configured `fill_type` pattern. Blend: `out = mask*fg + (1-mask)*bg`. Mask is
  auto-fit (nearest-exact) to the calculated output dimensions, so it works
  uniformly across all five `output_image_mode` transforms (distort, crop/pad,
  scale/crop, scale/pad, empty). Absent mask = bitwise-identical to v0.11.x.
- **`fit_mask_to_target` / `composite_with_mask`** helpers in `py/image_utils.py`
  — vendored from `FitMaskToImage` and `ImageCompositeMasked` references; no
  cross-repo import (smart-res-calc remains standalone-installable).
- **Mask-aware spectral pattern in `img2noise`** — when `image_purpose = img2noise`,
  the spectral pattern source is composited with the mask before VAE-encoding, so
  the noise shape reflects the cut region rather than the full input image. Also
  applies to `img2img + img2noise` (inherits via `vae.encode(output_image)`).
- **`IS_CHANGED` mask fingerprint** — shape + sum + mean so editing the mask in
  ComfyUI's MaskEditor and re-queuing triggers re-execution (no more stale cached
  output when only the mask changes).
- **Device + dtype alignment** in `composite_with_mask` so GPU-bound fills (e.g.,
  `DazNoise:pink/plasma/brown/greyscale/gaussian`) compose correctly with
  CPU-bound masks from `LoadImage`.
- **Info string** — appends `| Mask: cut` when the composite was applied.
- **New documentation**: `docs/mask-input.md` — full guide with examples and
  interaction matrices for `output_image_mode` and `image_purpose`.
- **New workflow fixture**: `docs/workflow/SmartResCalc-Mask-Test-Workflow.json`
  for drag-and-drop reproducibility of the mask-composite behavior.
- **Human test checklist**: `tests/checklists/v0.12.0__Feature__mask-input-composite.md`.

### Changed
- `CalculationContext` and `calculate_dimensions` gained a `mask` parameter.
- `_generate_output_image` and `_generate_latent` gained `mask=` kwargs.
- `cache_key` in `_prepare_output_mode` now includes mask identity.
- README: added "Mask input" feature bullet, "Mask Input (v0.12.0+)" usage
  subsection, and a link to the new guide under Documentation.

## [0.11.4] - 2026-03-30

### Changed
- **Updated dazzle-command.md** -- noodle-required connection (no graph scan fallback),
  multi-DC support, per-node state, companion versions v0.2.3-alpha / v0.4.2-alpha

## [0.11.3] - 2026-03-30

### Fixed
- **Per-node DazzleCommand state lookup** (DazzleCommand#5) -- `_apply_signal` reads seed
  intent from per-node `sys._dazzle_command_states` registry via `_dazzle_dc_id` marker
  injected by JS. Each SmartResCalc reads only its connected DazzleCommand's state.
  Removed legacy global `sys._dazzle_command_state` fallback.

### Companion versions
- Requires [DazzleCommand v0.2.3-alpha](https://github.com/DazzleNodes/ComfyUI-DazzleCommand)
  for per-node state registry
- Requires [PBE v0.4.2-alpha](https://github.com/DazzleNodes/ComfyUI-PreviewBridgeExtended)
  for deterministic preview filenames (cache-compatible)

## [0.11.2] - 2026-03-29

### Fixed
- **Standalone SmartResCalc not affected by unconnected DazzleCommand** (#56) -- JS seed
  intercept now finds DazzleCommand via noodle only (no graph scan fallback). Standalone
  SmartResCalc nodes in the same workflow are no longer influenced by DazzleCommand nodes
  they aren't connected to.
- **Python `_apply_signal` respects noodle connection** (#56) -- `_apply_signal` now checks
  `_dazzle_connected` marker before reading `sys._dazzle_command_state`. Standalone nodes
  without a connected DazzleCommand noodle skip orchestration entirely.
- **Python seed override with stale value** -- `_apply_signal` with `seed_intent='lock'`
  ("reuse last seed") no longer overrides the JS-resolved seed with a potentially stale
  `_last_resolved_seed`. JS is the source of truth for seed values since it performs the
  noodle lookup and knows which DazzleCommand controls which SmartResCalc.

### Added
- **`_dazzle_connected` marker** -- JS sets `_dazzle_connected=true` in prompt inputs before
  stripping the `dazzle_signal` noodle. Python `_apply_signal` checks this marker to decide
  whether to read `sys._dazzle_command_state`. Standalone nodes (no marker) skip orchestration.
- **Diagnostic seed intercept log** -- JS logs `cmdNode`, `cmdState`, `activeSeedWidget`, and
  `seedValue` for each SmartResCalc node during prompt dispatch (requires DEBUG_SMART_RES_CALC).

## [0.11.1] - 2026-03-28

### Fixed
- **Seed green mode on manual -1 entry** (#52) -- typing -1 in seed field or using +/- to
  reach -1 now activates the green random mode indicator. All value-changing paths (manual
  edit, increment, decrement) set randomizeMode based on whether the result equals -1.
- **Custom color picker visibility** (#55) -- color picker now shows/hides based on
  `fill_type = custom_color` instead of image connection state. Users can set custom fill
  colors for dimensions-only workflows without an image input.
- **Debug logging** -- moved per-execution `calculate_dimensions() CALLED` and `PARAMS` print
  statements to `logger.debug`. RESULT line kept as print for user feedback.

### Changed
- Updated README screenshot and test workflow

## [0.11.0] - 2026-03-28

### Changed
- **5-option seed control** -- DazzleCommand seed options expanded: "one run then random"
  (default, transient lock), "new seed each run" (force random), "reuse last seed" (lock
  previous), "keep widget value" (persistent), "SmartResCalc decides" (no interference).
  Applied in both pause and play states via JS prompt hook.
- **Transient seed with deferred reset** -- when "one run then random" uses a fixed widget
  seed, the widget resets to random mode after prompt dispatch via deferred setTimeout.
  Next run generates a fresh random seed automatically.
- **DazzleCommand seed bar priority** -- seeds entered via DazzleCommand's seed bar take
  priority over SmartResCalc widget values. Cleared after transient use.
- **Prompt input stripping** -- `dazzle_signal` input removed from prompt data during
  serialization to prevent ComfyUI cache cascade while preserving noodle for multi-node binding.

### Companion versions
- Requires [DazzleCommand v0.2.0-alpha](https://github.com/DazzleNodes/ComfyUI-DazzleCommand)
  for play/pause orchestration, seed bar entry, API state management
- Requires [PBE v0.4.0-alpha](https://github.com/DazzleNodes/ComfyUI-PreviewBridgeExtended)
  for DAZZLE_SIGNAL gate control and IS_CHANGED dazzle state

## [0.10.8] - 2026-03-27

### Added
- **DAZZLE_SIGNAL input** -- optional input for Dazzle Command orchestration node. Accepts
  seed control signals (lock/random/lock_current) via sys side-channel for cache-transparent
  operation. Noodle provides multi-node binding; seed intent communicated without cache cascade.
- **`_apply_signal()` pipeline stage** -- reads seed_intent from Dazzle Command side-channel,
  applies lock/random overrides after seed resolution.
- **JS seed lock in prompt hook** -- when connected DazzleCommand is "playing" with "lock last
  seed", the prompt interception hook reuses `lastSeed` instead of generating a new random seed.
  Preserves ComfyUI cache (identical input values = cache hit). Falls back to graph scan when
  noodle is not connected.

### Fixed
- **SpectralBlend2D node resize** -- expanding/collapsing the spectral widget no longer resets
  the node width. Preserves user's layout.

## [0.10.7] - 2026-03-26

### Fixed
- **Noise cache key collision** -- image and latent caches shared a single `_noise_cache_key`
  variable but stored incompatible tuple formats (6-tuple vs extended tuple), causing perpetual
  cache misses when both paths executed. Split into `_image_cache_key` (image cache) and
  `_noise_cache_key` (latent cache). Regression introduced in v0.8.2 when spectral blending
  expanded the latent cache key.
- **DazzleOptions not in noise cache key** -- changing `norm_mode` in DazzleOptionsNode served
  stale cached latent results. Added `opts_cache_key` to `noise_cache_key` tuple.
- **Seed random mode visual state** -- clicking +/- buttons or manually typing a seed value while
  in random mode (dice active) did not clear the green background or dice button highlight.
  Consolidated all randomizeMode transitions through new `setRandomMode(active)` method.

## [0.10.6] - 2026-03-22

### Added
- **Per-bin normalization (spectral whitening)** — each frequency bin individually normalized
  to match Gaussian magnitude, transferring spatial structure via phase only. Resolution-
  independent by construction. Dramatically expands usable blend_strength range (Plasma
  coherent at 0.30+ vs previous 0.17 limit). Auto-enabled for img2noise image patterns.
  (#49)
- **DazzleOptionsNode** — new extensible configuration node (`py/dazzle_options.py`).
  Outputs `DAZZLE_OPTIONS` dict consumed by SmartResCalc. Options: norm_mode (auto/per_bin/
  global_rms), whitening, cutoff_curve, phase_randomize. Chain input (`options_in`) enables
  compositor pattern. (#48)
- **feature_size parameter** — decoupled from cutoff. When set (> 0), cutoff auto-adjusts
  with resolution to maintain fixed pixel feature size. -1 = disabled (use cutoff directly).
  Display in bottom-right of expanded graph: `~NNNpx` (computed) vs `NNNpx` (locked).
- **SpectralBlend2DWidget enhancements** — hover preview with zone-colored axis labels,
  axis tooltips, feature_size display with click-to-edit, double-click to reset cutoff,
  spectral tooltip with shift+click docsUrl
- **Pixel cutoff mode** — cutoff values > 1.0 auto-convert to Nyquist-relative

### Fixed
- **ColorPickerButton canvas corruption** — guard against non-string fill_color from old
  workflows (`.startsWith` on non-string threw every frame)
- **Canvas state leak** — expanded SpectralBlend2DWidget now wraps draw in ctx.save/restore,
  preventing font/style leakage to subsequent widgets
- **Widget margins** — DazzleWidget default height 24→20px, ColorPickerButton, CopyImageButton,
  ModeStatusWidget adjusted to match native ComfyUI spacing

### Changed
- **Backward compatibility** — connect DazzleOptions with `norm_mode: global_rms` to reproduce
  exact v0.10.4 and earlier spectral blend behavior
- **blend_strength step** — 0.05 → 0.001 for finer control
- **Tooltip text** — rewritten for natural line breaks, spectral blend tooltip added with docsUrl
- **docs/spectral-blending.md** — new blend threshold tables for whitened vs legacy modes,
  DazzleOptions section, "What Changed" explanation, updated version history

## [0.10.5] - 2026-03-22

### Added
- **Pixel cutoff mode** — cutoff values > 1.0 are interpreted as pixel-space feature size
  and auto-converted to Nyquist-relative internally based on current resolution
- **Feature size display** — `~448px` shown in bottom-right of expanded spectral graph,
  computed from `cutoff * latent_size * spatial_divisor`. Click to enter pixel value that
  back-calculates cutoff. Enter -1 to reset to default.
- **Spectral tooltip** — SPECTRAL label triggers custom tooltip with usage guide and
  shift+click opens spectral-blending.md docs
- **Axis tooltips** — hover "blend", "cutoff", or feature size in expanded graph for
  inline explanations
- **Hover value preview** — moving cursor over 2D pad shows blend/cutoff values at that
  position without committing. Axis labels update with zone-colored values.
- **Resolution tips** in docs — notes about resolution affecting blend behavior and
  desaturation recommendation for img2noise

### Fixed
- **ColorPickerButton canvas corruption** — guard against non-string fill_color values
  from old workflows (`currentColor.startsWith is not a function` error on every frame)
- **Widget margins** — reduced DazzleWidget default height from 24 to 20px, adjusted
  ColorPickerButton, CopyImageButton, ModeStatusWidget to match native ComfyUI spacing.
  Hidden fill_color widget uses -4 height to eliminate extra gap.

### Changed
- **SpectralBlend2DWidget** — hover preview with zone-colored axis labels (split: label
  in zone color, number in readable #ddd), adaptive outline (black for green/yellow zones),
  letter-spacing 0.3px for readability, cutoff reset button
- **Tooltip text** — rewritten for natural line breaks in native tooltip system, spectral
  blend tooltip added to tooltip_content.js with docsUrl
- **Native widget suppression** — blend/cutoff native tooltips kept (not suppressed),
  widgets use zero-height approach instead of hideWidget

## [0.10.4] - 2026-03-21

### Fixed
- **Spectral blend cutoff cache miss** — `cutoff` was missing from the noise cache key,
  causing cached noise to be served when only cutoff changed. Changing cutoff now correctly
  invalidates the cache and regenerates with the new frequency threshold.

## [0.10.3] - 2026-03-21

### Fixed
- **SpectralBlend2DWidget canvas corruption** — `_readValues()` now coerces widget values
  to numbers via `Number()` before calling `.toFixed()`. On older ComfyUI frontend versions
  (e.g., 1.39.19), widget values deserialize as strings instead of numbers, causing
  `toFixed()` to throw on every `requestAnimationFrame` (60fps) and corrupting the
  canvas render pipeline. The error was silent (no visible console error in some browsers)
  but broke scroll/zoom/selection on the entire canvas.

## [0.10.2] - 2026-03-21

### Added
- **`cutoff` parameter** — exposed as user-facing FLOAT (0.01-0.50, default 0.20, step 0.001).
  Controls which spatial frequencies get pattern influence during spectral blending.
  Previously hardcoded at 0.20. (#35)
- **SpectralBlend2DWidget** — interactive 2D XY pad for visualizing blend_strength + cutoff
  interaction. Collapsed view shows values with zone indicator dot; click to expand full graph
  with heatmap (green=safe, yellow=boundary, red=abstract), draggable point, and crosshairs.
  Click values for inline editing. Reset button snaps cutoff to default 0.200. (#45)
- **Phase randomization** for img2img+img2noise layered mode — decorrelates noise pattern
  from VAE-encoded samples by preserving amplitude spectrum (spatial structure) while
  randomizing phases. Reduces artifacts from signal-noise correlation. (#47)

### Changed
- **blend_strength step** — 0.05 -> 0.001 for finer control
- Native blend_strength and cutoff sliders hidden when SpectralBlend2DWidget is active
  (values still accessible via widget augmentation pattern for noodle input compatibility)

## [0.10.1] - 2026-03-20

### Fixed
- **img2noise spectral blend**: VAE-encode the input image as pattern source instead of
  pixel-space resize + channel tiling. Eliminates diagonal hatching artifacts caused by
  correlated RGB channels being naively tiled to 16 latent channels. (#47)
- **img2img + img2noise layered path**: Reuse VAE-encoded image as noise pattern source
  (same fix, zero extra cost since image is already VAE-encoded for samples)

### Known Issues
- **img2img + img2noise at high blend_strength**: Artifacts appear at blend > ~0.15 because
  the same VAE-encoded image serves as both signal (samples) and noise pattern source,
  creating correlated signal-noise that the diffusion model can't properly denoise.
  Workaround: keep blend_strength low (0.05-0.15) in layered mode. (#47)

## [0.10.0] - 2026-03-20

### Added
- **`image_purpose` widget** — dropdown controlling how connected images affect outputs.
  5 modes: `img2img` (default, unchanged behavior), `dimensions only`, `img2noise`,
  `image + noise`, `img2img + img2noise`. Shown when image is connected, hidden otherwise.
  ([docs](docs/image-purpose.md), #36, #42)
- **`_resolve_image_purpose()`** — new pipeline stage decomposing dropdown into routing flags
  (`use_image_for_output`, `use_image_for_latent_encode`, `use_image_for_noise_shape`)
- **img2noise mode** — use input image's spatial structure as spectral blend pattern source
  for composition transfer. `output_image_mode` controls how image is transformed before
  noise shaping. Known issue: diagonal artifacts at blend_strength > 0.3 with real images
  (pixel-space channel tiling; fix planned via VAE-encode pattern source)
- **img2img + img2noise mode** — layered: VAE-encode image + generate image-shaped noise.
  Latent dict includes `samples`, `noise`, and `use_as_noise` keys. Experimental,
  requires ClownsharKSampler support.
- **Preview thumbnail** — transformed input image shown at 70% opacity inside preview box
  when image is connected. Compact text layout (dims+AR above, MP below) when thumbnail
  present; original centered layout when no image. (#46)
- **`docs/image-purpose.md`** — guide with behavior matrix, mode details, workflow examples
- **"Now you're thinking with noise"** — tagline and branding images

### Changed
- **README.md** — restructured features into 4 categories (Resolution, Image/Latent,
  Noise/Composition, Widget UX). New tagline, branding image, approachable language.
- **`docs/spectral-blending.md`** — expanded with cutoff parameter explanation,
  blend_strength + cutoff interaction, frequency mask math, image-to-noise section,
  research citations (InitNo, FreeNoise, SDEdit)
- **`docs/extended-fill-types.md`** — replaced stale "Future: Spectral Blending" note
  with current status, added image-to-noise cross-reference

### Fixed
- **`IS_CHANGED` caching** — only forces re-execution for special seeds (< 0, e.g. random).
  Fixed seeds (>= 0) now allow ComfyUI to cache normally, avoiding unnecessary regeneration
  of expensive noise patterns like DazNoise:Plasma
- **Noise cache key** — includes image_purpose routing flags and image shape, preventing
  stale cache hits when switching between modes

## [0.9.10] - 2026-03-19

### Added
- **`py/image_utils.py`** — extracted image creation, 4 transform modes, preview generation,
  latent creation, and get_image_dimensions_from_path as standalone functions (540 lines)
- **`tests/test_calculation_pipeline.py`** — 23 integration tests for CalculationContext pipeline
  stages (context defaults, image input handling, dimension resolution, scale/divisibility,
  seed resolution, output mode, info string assembly)
- **Seed prompt interception** (`app.api.queuePrompt` hook) — resolves seeds at queue time only,
  patches prompt and workflow data with resolved values. Follows rgthree's API hijacking pattern.
  Fixes seed recycle tracking (lastSeed only updated during actual execution, not auto-save).
- **Seed regression tests** — randomizeMode state tests, lock/recycle workflow test (Vitest + Playwright)

### Changed
- **CalculationContext pipeline** — `calculate_dimensions()` refactored from 594 to 57 lines.
  7 named helper methods with typed context object tracking field lifecycle.
- **`py/smart_resolution_calc.py`** — reduced from 1,504 to 1,024 lines (image utils extracted)
- **SeedWidget.serializeValue** — now pure passthrough (no seed resolution, no side effects).
  Seed resolution moved to queuePrompt hook to prevent auto-save cycles from overwriting lastSeed.
- **SeedWidget constructor** — `randomizeMode` defaults to true when value is -1
- **Root `__init__.py`** — imports get_image_dimensions_from_path from image_utils

### Fixed
- **Seed recycle button** — lastSeed now only updated during actual prompt execution (via
  queuePrompt hook), not during auto-save/serialize cycles that overwrote it with random values
- **Lock button** — saves current seed to lastSeed before generating new random
- **Native combo widget visibility** — hideWidget/showWidget now correctly handles native ComfyUI
  widgets by deleting no-op overrides (output_image_mode was disappearing after hide/show cycle)
- **randomizeMode on workflow load** — cleared when configure restores a resolved (non-special) seed
- **Seed in image metadata** — queuePrompt hook patches both widgets_values and
  widgets_values_by_name in workflow data with resolved seed value

## [0.9.9] - 2026-03-19

### Overview
Python backend modularization begins. The 2,296-line Python monolith is being
decomposed into focused modules, mirroring the JS refactoring approach.

### Added
- **`py/dimension_calculator.py`** (625 lines) — DimensionSourceCalculator extracted from
  monolith. 6-priority dimension resolution system with zero ComfyUI dependencies.
  Now independently testable (no CUDA/comfy imports needed).
- **`py/noise_utils.py`** (234 lines) — Noise generation utilities extracted: DazNoise
  detection/generation, spectral noise blending (FFT), pil2tensor conversion.
- **`py/__init__.py`** — Package marker enabling relative imports between py/ modules.
- **`scripts/extract_lines.py`** — Reusable line-range extraction tool for future modularization.

### Changed
- **`py/smart_resolution_calc.py`** — reduced from 2,296 to 1,504 lines (35% reduction).
  DimensionSourceCalculator and noise utilities now imported from extracted modules.

### References
- Analysis: `2026-03-19__04-46-49__dev-workflow-python-modularization-and-remaining-js.md`
- Original design: `2025-11-06__14-41-11__smart-res-calc-refactor-design.md`

## [0.9.8] - 2026-03-19 — JS Refactoring Complete

**Milestone: JavaScript modularization finished (v0.9.0 -> v0.9.8).** The 5,379-line monolith
has been decomposed into 16 focused ES6 modules with a two-level widget class hierarchy,
3 correctness fixes, 70 automated tests, and a reusable library entry point. The refactor
began at v0.9.0 (branched from v0.8.5) and spans 12 commits on `refactor/js-modularization`.

### Added
- **Library barrel file** (`web/dazzle.js`) — single import point for the DazzleNodes widget
  framework. Re-exports all public API: DazzleWidget, DazzleToggleWidget, TooltipSystem,
  WidgetValidation, serialization utilities, constants, and hide/show functions.

## [0.9.7] - 2026-03-19

### Added
- **`applyDazzleSerialization()` reusable helper** (`web/utils/serialization.js`) — name-based
  widget serialization as a plug-and-play library function. Any DazzleNodes node can use it
  with optional `onSerialize`/`onConfigure` hooks for node-specific config.

### Changed
- **Orchestrator serialization refactored** — inline serialize/configure overrides replaced
  with `applyDazzleSerialization(nodeType, { onSerialize, onConfigure })`. Scale widget step
  config preserved via hooks. Orchestrator: 968 -> 920 lines.

## [0.9.6] - 2026-03-19

### Added
- **Services pattern for testability** — DazzleWidget constructor accepts `config.services`
  with injectable dependencies (prompt, etc.). Defaults to ComfyUI globals for backward
  compatibility. Tests inject mocks for fast, isolated unit testing.
- **Vitest unit test suite** — 40 tests running in <2 seconds
  - SeedWidget: constructor, generateRandomSeed, resolveActualSeed (6 cases), serializeValue
  - DimensionWidget: constructor, changeValue (7 cases), serializeValue, handleToggleClick
  - WidgetValidation: output_image_mode, fill_type, dimension widgets, fill_color, unknown widgets
- `vitest.config.js`, `tests/unit/setup.js` (global mocks), `package.json` test:unit script

### Changed
- **`app.canvas.prompt()` migrated to `this.services.prompt()`** in 4 widgets:
  DimensionWidget, SeedWidget, ScaleWidget, CopyImageButton
- ScaleWidget tooltip check simplified to use inherited `handleTooltipMouse()`
- Total test count: 70 (40 unit + 30 E2E)

### References
- Collaborate3 analysis: `2026-03-18__22-17-04__DISCUSS_Rnd4_FINAL_ASSESSMENT_js-refactor-complete-review.md`

## [0.9.5] - 2026-03-19

### Added
- **DazzleToggleWidget intermediate class** (`web/components/DazzleToggleWidget.js`) — thin
  base for toggle-based widgets (DimensionWidget, SeedWidget, ImageModeWidget)
  - Value shape enforcement: `{ on: boolean, value: any }`
  - `handleToggleClick(event, pos)` helper for toggle mouse handling
  - `drawToggle()`, `drawWidgetFrame()`, `drawNumberWidget()` moved from DazzleWidget
  - `ToggleBehavior`, `ValueBehavior` constants moved from WidgetValidation.js (UI contracts)

### Changed
- **DazzleWidget cleaned** — now contains only universally shared methods (isInBounds,
  handleTooltipMouse, computeSize, hideWidget/showWidget). Toggle-specific code removed.
- **Widget hierarchy refined**: DimensionWidget, SeedWidget, ImageModeWidget now extend
  DazzleToggleWidget. ScaleWidget, buttons, ModeStatusWidget extend DazzleWidget directly.
- **WidgetValidation.js** — ToggleBehavior/ValueBehavior removed (moved to DazzleToggleWidget)

### References
- Collaborate3 analysis: `2026-03-18__22-17-04__DISCUSS_Rnd4_FINAL_ASSESSMENT_js-refactor-complete-review.md`
- Issue #5: Refactor web/smart_resolution_calc.js into separate class modules

## [0.9.4] - 2026-03-18

### Changed
- **Serialization simplified to name-based only** — removed diagnostics-based restore (Path B,
  v0.5.1) and heuristic matching restore (Path C, legacy). Only `widgets_values_by_name`
  remains. Serialize override: 78 -> 25 lines. Configure override: 180 -> 30 lines.
  Removed `_serialization_diagnostics` capture, before/after state tracking, position change
  detection, and combo widget post-load validation (no longer needed without splice).
- **Connection detection simplified to single event + one-shot delay** — removed redundant
  `onConnectionsRemove` handler and 500ms `setInterval` polling. Single `onConnectionsChange`
  with 50ms `setTimeout` for LiteGraph timing (VHS pattern). 3 mechanisms -> 1.

### Removed
- Serialization Path B (diagnostics-based restore, ~46 lines)
- Serialization Path C (heuristic type-matching restore, ~100 lines) — was marked "may corrupt"
- Serialization diagnostics capture (~40 lines in serialize, ~40 lines in configure)
- `onConnectionsRemove` handler (~16 lines)
- `setInterval` 500ms connection polling (~15 lines)
- `_lastImageConnectionState` tracking
- `imageOutputWidgetValues` tracking (no longer needed without splice)

### References
- Analysis: `2026-03-18__18-27-55__dev-workflow-orchestrator-correctness-audit.md`
- Orchestrator reduced from 1,232 to 955 lines (277 lines removed)

## [0.9.3] - 2026-03-18

### Changed
- **Widget visibility: splice replaced with draw override** — widgets now stay in the
  array at all times. Hidden widgets have draw/computeSize/mouse overridden to no-ops
  instead of being spliced in/out. Eliminates root cause of widget state corruption,
  index drift, and type mutation (Issues #8, #25, #26).
  - `hideWidget()`/`showWidget()` utilities added to DazzleWidget.js
  - `updateImageOutputVisibility()` rewritten: 225 lines -> ~55 lines
  - Removed: `imageOutputWidgetIndices`, `origType` tracking, reverse-order splice logic,
    anchor-based sequential insertion, widget type mutation during show/restore
  - Orchestrator reduced from 1,447 to 1,232 lines

### Added
- **Widget visibility Playwright tests** (3 new, 30 total)
  - `_hidden` flag pattern verification (widgets always in array)
  - hide/show mechanism matches image connection state
  - `updateImageOutputVisibility` shows widgets when image connected

### References
- Analysis: `2026-03-18__18-27-55__dev-workflow-orchestrator-correctness-audit.md`
- Root cause: `2025-11-11__10-47-00__canvas-corruption-fix-learnings.md`
- Issues #8, #25, #26

## [0.9.2] - 2026-03-18

### Added
- **DazzleWidget base class** (`web/components/DazzleWidget.js`) — shared foundation for all
  custom ComfyUI widgets with `isInBounds()`, `drawToggle()`, `drawNumberWidget()`,
  `drawWidgetFrame()`, `computeSize()`, `handleTooltipMouse()`, and standard constructor
- **Shared draw constants** — `WIDGET_MARGIN`, `WIDGET_INNER_MARGIN`, `WIDGET_BG_COLOR`,
  `WIDGET_LABEL_FONT`, `WIDGET_LABEL_COLOR_ON/OFF`, `WIDGET_TOGGLE_COLOR_ON/OFF` exported
  from DazzleWidget for consistent styling across all widgets

### Changed
- **All 7 interactive widget classes now extend DazzleWidget** — eliminates duplicated
  `isInBounds` (8x), `drawToggle` (3x), `drawNumberWidget` (2x), `computeSize` (7x),
  and constructor boilerplate
- **`drawWidgetFrame()` template method** — DimensionWidget, SeedWidget, ImageModeWidget now
  call `this.drawWidgetFrame()` for the shared draw skeleton (background, toggle, hit areas)
  instead of duplicating the same 15 lines each
- Establishes consistent widget interface for future DazzleNodes library extraction

### References
- Issue #5: Refactor web/smart_resolution_calc.js into separate class modules
- Analysis: `2026-03-18__14-24-08__dev-workflow-js-widget-abstraction-strategy.md`
- Plan: `2026-03-18__14-24-08__claude-plan__dazzle-widget-base-class.md`

## [0.9.1] - 2026-03-18

### Changed
- **Phases 7-10: Extract ModeStatusWidget, ImageModeWidget, ColorPickerButton, CopyImageButton**
  - `web/components/ModeStatusWidget.js`: read-only mode display (~355 lines)
  - `web/components/ImageModeWidget.js`: USE IMAGE DIMS toggle + mode selector (~301 lines)
  - `web/components/ColorPickerButton.js`: color picker popup button (~197 lines)
  - `web/components/CopyImageButton.js`: copy dimensions from connected image (~354 lines)
  - `web/smart_resolution_calc.js`: 2,720 -> 1,447 lines (73% total reduction from original 5,379)
  - All 9 widget classes now in separate ES6 modules under `web/components/`
  - Extraction comment cruft cleaned from orchestrator (~58 lines removed)

### Changed
- **Phases 3-6: Extract WidgetValidation, DimensionWidget, SeedWidget, ScaleWidget**
  - `web/components/WidgetValidation.js`: WIDGET_SCHEMAS, validateWidgetValue,
    logCorruptionDiagnostics, ToggleBehavior, ValueBehavior (~210 lines)
  - `web/components/DimensionWidget.js`: toggle-based dimension input class (~346 lines)
  - `web/components/SeedWidget.js`: seed widget + seed constants (~462 lines)
  - `web/components/ScaleWidget.js`: scale multiplier slider (~1,143 lines)
  - `web/utils/ImageDimensionUtils.js`: shared image dimension utilities (~111 lines)
  - `web/smart_resolution_calc.js`: 4,939 -> 2,720 lines (49% reduction from original 5,379)
  - All 27 Playwright tests pass after extraction

### Added
- **Playwright test coverage for Phases 3-5** (13 new tests, 27 total)
  - DimensionWidget: structure, toggle, +/- buttons, megapixel float increments, serialization
  - SeedWidget: dice/lock/recycle buttons, resolveActualSeed, toggle, randomize mode
  - WidgetValidation: corrupt value correction, behavior constant application

### Fixed
- **`_get_plasma_fast()` crash** when `ComfyUI-SeedVR2_VideoUpscaler` installed — its custom
  `__getattr__` raises `ImportError` instead of `AttributeError`, bypassing `getattr`'s default.
  Added broad `try/except` around module scan. (Issue #43)

### References
- Issue #5: Refactor web/smart_resolution_calc.js into separate class modules
- Issue #14: Refactor: Split large smart_resolution_calc.js file
- Issue #43: Node not found after installation (SeedVR2 compatibility)

## [0.9.0] - 2026-03-17

### Overview
The 0.9.x series is dedicated to JavaScript modularization — decomposing the 5,379-line
monolith (`web/smart_resolution_calc.js`) into reusable, testable modules. No new features;
purely structural refactoring with Playwright E2E test verification at every step.

### Added
- **Playwright E2E test suite** — automated browser testing against running ComfyUI
  - `tests/e2e/smoke.spec.js`: 5 smoke tests (console errors, node loading, widgets, outputs, screenshot)
  - `tests/e2e/widget-interaction.spec.js`: 9 interaction tests (tooltip hover activation,
    delay timing, seed widget structure, randomize generation, button hit areas,
    serialization roundtrip, seed value persistence)
  - `playwright.config.js`: Chromium, localhost:8188, single worker (shared server)
  - `package.json`: test scripts (npm test, test:smoke, test:headed, test:ui)

### Changed
- **Phase 2: TooltipSystem extraction** — first module extracted from monolith
  - `web/components/TooltipSystem.js`: TooltipManager, InfoIcon, tooltipManager singleton,
    wrapWidgetWithTooltip (~440 lines extracted)
  - `web/smart_resolution_calc.js`: 5,379 -> 4,939 lines, imports from TooltipSystem.js
  - All 14 Playwright tests pass after extraction

### References
- Issue #5: Refactor web/smart_resolution_calc.js into separate class modules
- Issue #14: Refactor: Split large smart_resolution_calc.js file
- Plan: `2026-03-17__00-15-00__claude-plan__js-refactor-playwright-testing.md`

## [0.8.5] - 2026-03-17

### Added
- **Minimum node width** (320px) — prevents seed widget buttons from overflowing on narrow nodes
- **Green tint on seed value** when randomize mode active — visual indicator that seed changes each queue

### Fixed
- **pyproject.toml version sync** — was stuck at 0.8.4, causing ComfyUI Registry publish to fail

## [0.8.4] - 2026-03-14

### Fixed
- **Seed serialization simplified** — seed value now correctly preserved in saved workflows
  using the same serialize/configure pattern as all other widgets (Height, Width, Megapixel)
  - `serializeValue` returns a **copy** with the resolved seed for workflow JSON, while
    keeping `this.value` at -1 when randomize mode is active (for next queue)
  - `randomizeMode` flag tracks persistent random mode: set by dice button, cleared by
    lock/recycle/manual entry. Each queue generates a new random without user intervention.
  - Removed all seed resolution from serialize hook (44 lines) — no longer needed
  - Removed debug console.log statements from serialize and configure hooks
  - Python -1/-2/-3 fallback marked as vestigial with warning log if hit unexpectedly
  - No API hijacking required — clean, simple, matches existing widget patterns

### Design
- `2026-03-14__19-07-51__dev-workflow-simplify-seed-serialization.md`
- `2026-03-14__19-00-14__full-postmortem_seed-serialization-timing-bug.md`

## [0.8.3] - 2026-03-14

### Changed
- **WIP: Seed serialization baseline** — partially working seed preservation using
  serialize hook approach. Superseded by v0.8.4's simplified approach.

## [0.8.2] - 2026-03-14

### Added
- **Spectral blending** — inject noise pattern spatial structure into latent noise while
  maintaining Gaussian statistics for prompt-adherent generation
  - New `blend_strength` parameter (0.0-1.0): controls how much the fill_type pattern's
    spatial layout influences the generated image composition
  - Power-preserving quadrature blend (sin/cos weights) in the frequency domain
  - Gaussian rolloff mask at 0.2 Nyquist cutoff for low-frequency structure injection
  - Per-channel post-blend normalization ensures N(0,1) statistics
  - Different noise types tolerate different blend strengths:
    - DazNoise: Plasma — up to ~0.17 (strong low-frequency structure)
    - DazNoise: Gaussian — up to ~0.4+ (flatter spectrum, more tolerant)
  - At the coherence boundary, noise pattern acts as a style transfer via initial noise
  - Same seed + different fill_type = diverse compositions of the same "character"

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - `spectral_noise_blend()`: FFT-based blending with power normalization, quadrature weights,
    Gaussian rolloff mask, and per-channel std correction (~50 lines)
  - `blend_strength` FLOAT parameter in optional inputs (default 0.0, backward compatible)
  - Pattern resized to latent dims via bilinear interpolation, tiled across latent channels
  - Device-aware: pattern tensor moved to match gaussian device before FFT
  - Cache key includes blend_strength for proper invalidation
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Seed widget repositioned after blend_strength (not fill_type) to prevent widget
    serialization conflicts

### Design
- `2026-03-14__09-26-37__dev-workflow-spectral-blending-implementation.md`

## [0.8.1] - 2026-03-14

### Changed
- **Latent noise output uses raw `torch.randn()`** instead of VAE-encoding pixel noise
  - VAE-encoded noise produces abstract art because it lives on the VAE's learned manifold,
    not in the Gaussian noise space that diffusion models expect
  - Raw latent noise is proper iid Gaussian noise seeded by `fill_seed`, producing
    prompt-adherent images identical to standard seed-based generation
  - The `fill_type` dropdown now only affects the IMAGE output (visual preview), not
    the LATENT output — the latent is always seeded Gaussian regardless of fill_type
  - This is functional but limited: the visual noise pattern does not influence generation
  - Future: spectral blending will inject our noise patterns' spatial structure into
    the latent while maintaining Gaussian statistics for prompt adherence
- **Debug prints converted to logger.debug()** — all diagnostic output now gated behind
  `COMFY_DEBUG_SMART_RES_CALC=true` environment variable

### Design
- `2026-03-14__08-13-48__dev-workflow-latent-noise-space-mismatch.md`

## [0.8.0] - 2026-03-14

### Added
- **Seed widget** — New SeedWidget for reproducible noise fills, modeled after rgthree Seed
  - Toggle ON = active (special values -1/-2/-3 interpreted, RNG seeded)
  - Toggle OFF = passthrough (literal value, no RNG seeding)
  - Three action buttons: Randomize (set -1), New Fixed Random, Recall Last Seed
  - Last-seed tracking via JS `serializeValue` resolution
  - Tooltip with usage documentation
- **`seed` output** — New INT output replaces vestigial `resolution` STRING output (slot 3)
  - Returns the actual seed used for noise generation
  - When seed widget is OFF, returns the literal value (passthrough)
- **5D latent tensor support** — `create_latent()` detects video VAEs (`latent_dim=3`)
  and produces `[batch, channels, 1, h//s, w//s]` for Wan/Qwen/HunyuanVideo models
  - Fixes `IndexError: tuple index out of range` crash when VAE-decoding empty latents
- **VAE-encoding of noise fills** — When VAE is connected and `fill_type` is non-trivial
  (noise, random, DazNoise variants, or fill_image), the fill image is VAE-encoded into
  the latent output instead of returning empty zeros
  - Sets `use_as_noise: True` flag in latent dict for downstream sampler integration
- **Noise generation caching** — DazNoise and VAE-encoded latent results are cached
  and reused when seed, fill_type, and dimensions are unchanged (saves ~10s per run)
- **`IS_CHANGED` implementation** — Forces re-execution when seed widget is active,
  preventing stale cache results across runs

### Changed
- **`fill_type` always visible** — Promoted from hidden widget group; now visible even
  when no image input is connected, enabling noise fill selection for latent-only workflows
- **Widget order** — `fill_type` moved before `output_image_mode` in Python INPUT_TYPES;
  seed widget positioned after `fill_type` via JS splice
- **`output_image_mode` default** — Changed from `"none"` (invalid) to `"auto"`, eliminating
  the `Invalid output_image_mode 'none'` warning from Issue #8 widget corruption

### Breaking Changes
- **`resolution` output removed** — Replaced by `seed` (INT) at output slot 3. Workflows
  using the `resolution` STRING output will need to be updated (can be reconstructed from
  `width` + `height` outputs if needed)

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - `create_latent()`: Added `latent_dim` detection for 5D video VAE tensors
  - Seed resolution logic: Handles `{on, value}` dict from SeedWidget hidden input
  - RNG seeding positioned after preview generation, before image generation
  - `_generate_daznoise()`: Enhanced debug logging (gated by `COMFY_DEBUG_SMART_RES_CALC`)
  - Noise/latent caching via `_noise_cache_key`, `_noise_cache_image`, `_noise_cache_latent`
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - New `SeedWidget` class (~300 lines): toggle, buttons, value display, serializeValue with
    seed resolution and lastSeed tracking
  - `fill_type` removed from `imageOutputWidgets` hide group
  - Widget restore anchor changed from `batch_size` to `fill_type`
- **Tooltip** (`web/tooltip_content.js`):
  - Added `fill_seed` tooltip entry with toggle/button documentation

### Upstream Integration Note
- The `use_as_noise` latent flag enables downstream samplers to use the noise-filled latent
  as initial noise instead of generating their own. This requires sampler-side support:
  - **ClownsharKSampler** (RES4LYF): Set seed to `-2` and patch `beta/samplers.py` to check
    for `use_as_noise` flag and propagate it through `latent_x`. Does NOT work out-of-the-box.
  - **Standard KSampler**: Not supported (ignores the flag)

### Design
- `2026-03-13__21-56-36__dev-workflow-wan-vae-5d-latent-and-fill-type-visibility.md`
- `2026-03-13__23-02-03__dev-workflow-fill-seed-widget-and-ksampler-noise-passthrough.md`
- `2026-03-14__08-13-48__dev-workflow-latent-noise-space-mismatch.md`

## [0.7.0] - 2026-03-06

### Added
- **DazNoise extended fill types** - 5 additional noise fill patterns when [dazzle-comfy-plasma-fast](https://github.com/DazzleNodes/dazzle-comfy-plasma-fast) or [DazzleNodes](https://github.com/DazzleNodes/DazzleNodes) is installed
  - `DazNoise: Pink` — Brightness-biased noise (cube root transformation)
  - `DazNoise: Brown` — Extreme brightness-biased noise (double cube root)
  - `DazNoise: Plasma` — Organic cloud-like patterns (diamond-square subdivision)
  - `DazNoise: Greyscale` — Monochrome noise mapped to RGB channels
  - `DazNoise: Gaussian` — Wide Gaussian noise via OmniNoise (mean=0.5, std=0.25)
  - Automatic detection — options appear/hide based on package availability
  - Graceful fallback to Gaussian noise if dependency removed after workflow saved
- **Custom fill image input** - New optional `fill_image` IMAGE input
  - Overrides `fill_type` dropdown when connected
  - Accepts any image source (OmniNoise, preprocessors, etc.) as custom fill
  - Scaled to match target dimensions automatically

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - `_get_plasma_fast()`: Detects dazzle-comfy-plasma-fast via `NODE_CLASS_MAPPINGS` in `sys.modules`, with importlib fallback
  - `_generate_daznoise()`: Routes fill types to generator classes using per-type method names
  - `create_empty_image()`: Extended with DazNoise routing and `fill_image` override
  - `transform_image_scale_pad()`, `transform_image_crop_pad()`: Accept `fill_image` parameter

### Documentation
- `docs/extended-fill-types.md` — Detailed guide for DazNoise fill patterns and fill_image usage
- `README.md` — Added feature bullet with links

### Design
- `2026-03-06__16-19-45__dev-workflow-adding-plasma-fast-fill-types.md`

## [0.6.8] - 2026-03-01

### Added
- **Traffic analytics via ghtraf** - Integrated [GitHub Traffic Tracker](https://github.com/djdarcy/github-traffic-tracker) for download/clone/view tracking
  - Daily collection via GitHub Actions workflow (`traffic-badges.yml`)
  - Gist-backed storage with shields.io badge endpoints
  - Static HTML dashboard at `docs/stats/`
- **README badges** - Added Installs and Views badges linking to traffic dashboard
- **Project config** - Added `.ghtraf.json` for traffic tracker configuration

## [0.6.7] - 2026-03-01

### Fixed
- **Empty latent channel mismatch** - Fixed crash when VAE-decoding empty latent with non-SD1.5 models
  - `create_latent()` hardcoded 4 channels, causing `RuntimeError: tensor size mismatch` with
    FLUX (16ch), patchified (16ch), Cosmos (128ch), and other non-4-channel VAEs
  - Now queries `vae.latent_channels` when VAE is connected, falls back to 4 for compatibility
- **Empty latent spatial ratio mismatch** - Fixed decoded image being 2x expected dimensions
  - `create_latent()` hardcoded `height//8` spatial downscale, wrong for patchified VAEs (16x),
    Stable Cascade (32x), and other non-8x models
  - Now queries `vae.spacial_compression_encode()` for the actual ratio, falls back to 8x
- **Missing latent metadata** - Added `downscale_ratio_spacial` key to empty latent dict
  - Matches ComfyUI's `EmptyLatentImage` output format
  - Enables `fix_empty_latent_channels()` to correct shape when latent flows through KSampler
- **Test assertion for missing image edge case** - Fixed `test_edge_case_missing_image()` expectation
  - Test expected `defaults_with_ar` (priority 6), but calculator correctly returns `ar_only_pending` (priority 4)
  - The fallback to defaults happens in the caller (`calculate_dimensions()`), not the calculator
  - Now asserts correct pending state: mode, priority, and None dimensions

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - `create_latent()`: Added `vae` parameter, queries `latent_channels` and `spacial_compression_encode()`
  - Both call sites (VAE-encode failure fallback and no-image empty latent) now pass `vae=vae`
  - Defensive `hasattr` checks ensure graceful fallback if VAE API changes
- **Test fix** (`tests/test_dimension_source_calculator.py`):
  - `test_edge_case_missing_image()`: Corrected assertion from `defaults_with_ar`/priority 6 to `ar_only_pending`/priority 4
  - Added assertions for None dimensions in pending state
- **Gitignore** (`.gitignore`):
  - Added pattern for numbered backup variants of README screenshots

### Design
- `2026-03-01__21-59-13__empty-latent-generation-bug-analysis.md`
- `2026-03-01__22-15-39__latent-spatial-ratio-2x-decode-bug.md`

## [0.6.6] - 2025-01-26

### Fixed
- **Image Mode Default Crash** - Fixed crash when image_mode widget not in kwargs
  - Previous behavior: `image_mode` defaulted to `{'on': True}` causing crash when no image connected
  - New behavior: Defaults to `{'on': False}` - image mode disabled unless explicitly enabled
  - Root cause: When image mode enabled but no image connected, calculator returned `None` dimensions
  - Added safeguard: Pending states (None dimensions) now fall back to defaults with dropdown AR

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - Line 999: Changed `image_mode` default from `{'on': True, 'value': 0}` to `{'on': False, 'value': 0}`
  - Line 1000: Changed `use_image` default from `True` to `False`
  - Lines 1119-1127: Added safeguard to detect pending states and recalculate without image mode
  - Added debug logging for image_mode state (gated by `COMFY_DEBUG_SMART_RES_CALC` env var)

### Developer
- **Pre-commit Hook Improvements** (`scripts/hooks/pre-commit`):
  - Added `cd` to repo root before calling update script (fixes path resolution issues)
  - Always stage version.py to ensure inclusion in commits
  - Fixed regex patterns: properly escape dots for file extension matching

## [0.6.5] - 2025-11-12

### Fixed
- **SCALE Tooltip Timeout** - Tooltip now stays visible while hovering over handle
  - Previous behavior: Tooltip disappeared after 2 seconds even while hovering
  - New behavior: Tooltip remains visible indefinitely while mouse over handle
  - Timeout only starts when mouse leaves the handle area
  - After leaving handle, 2-second grace period before tooltip disappears
- **SCALE Tooltip Hover Precision** - Tooltip only appears when hovering over green handle knob
  - Previous behavior: Tooltip showed for entire slider track, handle, and value text
  - New behavior: Tooltip only shows when directly over the small green handle
  - Less intrusive - allows viewing elements below SCALE widget without tooltip blocking
  - More precise hover target reduces accidental tooltip triggering

### Technical
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Lines 1877-1916: Refactored pointermove handler to detect hover state transitions
  - Timeout only starts on hover→not-hover transition (wasHovering && !this.isHovering)
  - While hovering, any pending timeout is cleared (keeps tooltip visible)
  - Hover detection simplified to `this.isInBounds(pos, this.hitAreas.handle)` only
  - Removed slider track and value text from hover detection areas

### Benefits
- ✅ **Better UX for Dense Workflows**: Tooltip doesn't block view of nodes below
- ✅ **Persistent Calculations**: Users can examine tooltip without it disappearing
- ✅ **Precise Interaction**: Only shows tooltip when intentionally hovering over handle
- ✅ **Natural Behavior**: Tooltip stays as long as you're hovering, hides when you leave

## [0.6.4] - 2025-11-12

### Fixed
- **Info Output Duplication** - Removed duplicate "From Image" and "Scale" information
  - Eliminated mode_info prepending that showed dimensions twice
  - Info output now shows clean, consolidated information
  - Example fix: `From Image (Exact: 1200×1200) @ 1.2x | Mode: ... | From Image: 1200×1200 | Scale: 1.2x` → `Mode: USE IMAGE DIMS = Exact Dims | From Image: 1200×1200 | Scale: 1.2x`
- **Aspect Ratio Field Addition** - Info output now always includes AR when not already mentioned
  - Conditionally adds `| AR: X:Y |` field to info string
  - Uses regex word boundaries to detect existing AR mentions (avoids false positives like "Scalar")
  - Ensures AR is visible for all modes (Exact Dims, WIDTH/HEIGHT explicit, etc.)
  - Case-insensitive detection with `.lower()` preprocessing
- **Mutual Exclusivity Bug** - Fixed incomplete mutual exclusivity between custom_ratio and USE IMAGE DIMS
  - Both Exact Dims and AR Only modes now properly disable custom_ratio when enabled
  - custom_ratio enabling now properly disables USE IMAGE DIMS regardless of mode
  - Previous bug: Exact Dims mode allowed both custom_ratio and USE IMAGE DIMS enabled simultaneously
  - AR Only mode already worked, but Exact Dims case was missing

### Changed
- **Info Output Display** - Enhanced info output to show latent source
  - Now shows "Latent: VAE Encoded" when VAE input connected
  - Clearly indicates whether using empty latent (txt2img) or VAE-encoded latent (img2img)
  - Visible in node info output and new screenshot

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - Lines 1346-1366: Removed duplicate mode_info prepending, added intelligent AR field detection
  - Uses `re.search(r'\bar\b', info_so_far)` with word boundaries for accurate AR detection
  - Conditionally adds `| AR: X:Y |` when AR not already mentioned in mode display or info detail
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Line 2898: Removed `&& this.value.value === 0` condition to extend mutual exclusivity to both modes
  - Line 3864: Removed `&& imageModeWidget.value?.value === 0` condition to cover both Exact Dims and AR Only
  - Both ImageModeWidget and custom_ratio callbacks now enforce mutual exclusivity bidirectionally

### Benefits
- ✅ **Cleaner Info Output**: No duplicate information, easier to read calculation results
- ✅ **AR Visibility**: Aspect ratio always visible in info output for all modes
- ✅ **Consistent Widget Behavior**: Mutual exclusivity properly enforced for all image modes
- ✅ **Better UX**: Users can see VAE encoding status in info output

### Notes
- Screenshot updated to show "Latent: VAE Encoded" in info output
- README.md caption updated to reflect new VAE visibility feature
- Fixes discovered during Scenario 1 testing and polishing phase

### Related Documents
- 2025-11-12__14-23-05__context-postmortem_scenario-1-polish-and-next-work.md

## [0.6.3] - 2025-11-12

### Added
- **Pending Data Display (Scenario 1)** - Generator node workflows now show user intent before execution
  - Mode(AR) displays `(?:?)` when image dimensions unknown (KSampler, RandomNoise, etc.)
  - Shows `"IMG Exact Dims (?:?)"` when Exact Dims enabled with generator
  - Shows `"WIDTH & IMG AR Only (?:?)"` when AR Only enabled with dimension widgets
  - Acknowledges user's image mode choice instead of showing misleading defaults
  - Updates to actual values after workflow execution when data becomes available

### Fixed
- **Reconnection Mode Updates** - Mode(AR) now updates immediately when connecting generator nodes
  - Previously stayed on default modes after reconnecting to generator
  - Now correctly shows pending state `(?:?)` on reconnection
  - Same pattern as Scenario 2 fix, applied to generator node case
- **AR Only Info Output** - Info now shows calculated dimensions for AR Only mode
  - Before: `"Using image AR 1:1"` (missing final dimensions)
  - After: `"HEIGHT: 1000, calculated W: 1000 from image AR 1:1"`
  - Shows which dimension source active and what was calculated
  - Includes all four AR Only variants: WIDTH, HEIGHT, MEGAPIXEL, defaults
- **Tooltip Null Handling** - Scale widget tooltip shows `?` for unknown values
  - Prevents `0.00 MP` when dimensions pending (now shows `? MP`)
  - Shows `? × ?` for all unknown dimension values
  - Applies to Base, Scaled, and Final dimensions in tooltip

### Technical
- **Python Changes** (`py/smart_resolution_calc.py`):
  - Lines 143-187: `_calculate_exact_dims()` returns `exact_dims_pending` mode when no image_info
  - Lines 282-305: Added `_get_primary_dimension_source()` helper to determine active dimension
  - Lines 315-337: `_calculate_ar_only()` returns `ar_only_pending` mode when no image_info
  - Lines 1143-1153: Enhanced AR Only info output to show calculated dimensions
  - All pending modes return explicit `None` values, never `undefined`
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Lines 1351-1355: `_getARRatio()` returns `'?:?'` when `ar.source === 'image_pending'`
  - Lines 1381-1393: `getSimplifiedModeLabel()` handles `exact_dims_pending` and `ar_only_pending` modes
  - Lines 1473-1495: Tooltip formatting with `formatDim()` and `formatMp()` helpers for null values
  - Lines 973-996: `calculatePreview()` early return with all null values for pending states
  - Lines 1140-1145: `refreshImageDimensions()` calls `updateModeWidget()` at Tier 3 for generators

### Benefits
- ✅ **User Intent Preserved**: Shows what user chose (`IMG Exact Dims`) even when data pending
- ✅ **No Misleading Defaults**: Clearly indicates unknown values with `?` instead of fallback dimensions
- ✅ **Generator Node Support**: Works with KSampler, RandomNoise, and any node without file path
- ✅ **Informative Output**: Info string shows calculation logic and final dimensions

### Related Issues
- Completes Issue #32 Scenario 1 - Pending Data Display
- Related to Issue #33 - Future enhancement for dynamic dimension inputs

## [0.6.2] - 2025-11-11

### Fixed
- **Canvas Corruption** - Critical fix for custom widget hide/show corruption
  - Root cause: Value initialization code setting custom widget values to undefined
  - Custom widgets have complex value structures (objects, null) that should not be modified
  - Fixed by skipping value initialization for widgets with `type === "custom"`
  - Prevents corruption of ImageModeWidget and CopyImageButton internal state
- **"USE IMAGE DIMS?" Toggle** - Now works correctly when image connected
  - Fixed type property modification breaking custom widget rendering
  - Widget maintains `type = "custom"` required for draw/mouse methods
- **"Copy from Image" Button** - Fixed broken button after hide/show cycles
  - Button now appears correctly when image input connected
  - State preserved across multiple hide/show cycles
  - Stale workflow state from buggy version requires connection change to refresh

### Changed
- **Custom Widget Handling** - Value initialization now respects widget boundaries
  - Skip value initialization entirely for `type === "custom"` widgets
  - Custom widgets manage their own complex state without interference
  - Eliminates entire class of state corruption bugs

### Technical
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Lines 3768-3780: Added `if (widget.type === "custom")` check in value initialization loop
  - Lines 3947-3961: Removed type property modification for ImageModeWidget insertion
  - Custom widgets now maintain their type and value properties unchanged
- **Key Insight**: Custom widgets are complex behaviors with state, not simple data containers
  - Don't modify widget properties without understanding their purpose
  - Respect widget boundaries - skip modification for custom widgets
  - Leave custom widget properties unchanged during hide/show operations

### Benefits
- ✅ **No Canvas Corruption**: Node loads cleanly without visual artifacts
- ✅ **Stable Widget Behavior**: All 6 widgets hide/show correctly across multiple cycles
- ✅ **Custom Widget Functionality**: ImageModeWidget and CopyImageButton work correctly
- ✅ **Future-Proof**: Pattern established for handling custom widgets safely

### Notes
- Old workflows saved with buggy code (v0.6.1 WIP) may contain corrupted state
- Changing image connection refreshes state with fixed code
- New workflows work correctly from the start
- Learnings documented in `/private/claude/2025-11-11__10-47-00__canvas-corruption-fix-learnings.md`

### Related Issues
- Completes Issue #31 - Widget visibility fixes for img2img workflows

## [0.6.1] - 2025-11-11

### Fixed
- **Widget Visibility for img2img Workflows** - Fixed widget auto-hide checking wrong connection
  - Changed from checking image OUTPUT to checking image INPUT
  - With VAE encoding, INPUT image + VAE → latent uses output settings
  - Users now have control over output_image_mode/fill_type for img2img/outpainting
  - Handle all connection check locations: main function, onConnectionsChange, onConnectionsRemove, periodic polling
- **Connection State Detection** - All four locations now check INPUT instead of OUTPUT
  - `updateImageOutputVisibility()` function (main check)
  - `onConnectionsChange` handler (connect events)
  - `onConnectionsRemove` handler (disconnect events)
  - Periodic polling (500ms fallback for unreliable LiteGraph events)

### Technical
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Line 3785: Check `imageInput.link` instead of `imageOutput.links`
  - Lines 3970-3983: Update connection change handler to monitor INPUT
  - Lines 3987-4000: Update disconnect handler to monitor INPUT
  - Lines 4007-4016: Update periodic polling to check INPUT connection
  - All checks now use `const imageInput = this.inputs.find(inp => inp.name === "image")`

### Notes
- Essential fix for VAE encoding workflows introduced in v0.6.0
- Widgets (output_image_mode, fill_type, color picker) now appear when needed for img2img
- Multiple commits to get all connection check locations fixed

### Related Issues
- Addresses Issue #31 - Widget visibility should check image INPUT not OUTPUT

## [0.6.0] - 2025-11-10

### Added
- **VAE Encoding Support** - Transform IMAGE output into latent representation for img2img workflows
  - Optional VAE input for latent encoding (when connected, encodes image to latent)
  - Auto-detection: VAE connected → encode image; VAE disconnected → empty latent
  - Supports all VAE types: SD1.5, SDXL, Flux
  - Graceful error handling with fallback to empty latent

### Changed
- **Image Input Tooltip** - Enhanced tooltip explaining dual role of image input
  - Without VAE: dimension extraction and image transformation
  - With VAE: all above plus VAE encoding to latent for img2img workflows
  - Clarifies optional nature and full capabilities

### Fixed
- **VAE Tensor Handling** - Fixed "too many indices for tensor of dimension 4" error
  - Improved tensor handling to match ComfyUI's VAEEncode pattern exactly
  - Separated channel slicing from VAE encode call for clarity
  - Added explicit check for >3 channels (handles RGBA gracefully)
  - Ensure tensor is contiguous before encoding (required by some VAEs)
  - Added extensive debug logging (shape, dtype, device, contiguity)

### Technical
- **Backend Changes** (`py/smart_resolution_calc.py`):
  - Added optional `vae` parameter to INPUT_TYPES
  - Modified `calculate_dimensions()` to accept and process VAE
  - Added VAE encoding logic with error handling and fallback
  - Updated info output to show latent source ("Empty", "VAE Encoded", or "Empty (VAE failed)")
- **Latent Output Modes**:
  1. Empty Latent (VAE disconnected) - txt2img workflows
  2. VAE Encoded Latent (VAE connected) - img2img/inpainting/outpainting workflows
- **Error Handling**:
  - Graceful fallback: VAE encoding failure → empty latent
  - Errors logged to console and debug log
  - No workflow interruption on encoding failure
- **Debug Logging**: Enable with `COMFY_DEBUG_SMART_RES_CALC=true`

### Breaking Changes
None - Fully backward compatible with v0.5.x workflows

### Benefits
- ✅ **img2img Support** - Use calculated dimensions for img2img workflows
- ✅ **Flexible Workflow** - Same node works for txt2img and img2img
- ✅ **Robust Error Handling** - Encoding failures don't break workflows
- ✅ **Universal VAE Support** - Works with all ComfyUI-supported VAE types

### Notes
- VAE input is optional - node works exactly as before without it
- Commit history shows 4 commits from "Claude <noreply@anthropic.com>" (legitimate v0.6.0 work, already released)

## [0.5.4] - 2025-11-07

### Changed
- **Default Widget Values** - Updated defaults to more appropriate values for modern SD models and better user experience
  - **Backend Defaults** (`py/smart_resolution_calc.py`):
    - `custom_aspect_ratio`: Changed from `16:9` to `5.2:2.5` (wider landscape presentation format)
    - `fill_color`: Changed from `#808080` (medium gray) to `#522525` (dark red/brown)
    - `divisible_by`: Kept at 16 (safe for SD1.5/SDXL/Flux/Illustrious)
  - **Frontend Widget Defaults** (`web/smart_resolution_calc.js`):
    - `IMAGE MODE` toggle: Changed from ON to OFF (disabled by default for manual workflow)
    - `WIDTH`: Changed from 1920 to 1024 (standard SD resolution)
    - `HEIGHT`: Changed from 1080 to 1024 (standard SD resolution - square format default)
  - **Validation Schemas** (`WIDGET_SCHEMAS`):
    - Updated healing defaults to match new values (for workflow corruption self-healing)

### Improved
- **Documentation** - Updated README.md screenshot caption to reflect new default values
  - Caption now shows: "custom aspect ratio 5.2:2.5, WIDTH enabled at 1024, SCALE at 1.10x, calculating height and outputting 1120×1408"
  - More accurately represents typical usage with new defaults

### Technical
- **Default Value Application Points**:
  - New nodes created by users (initial widget creation)
  - Corrupted workflows being healed by validation system
  - All self-healing fallback scenarios (corrupt value detection)
- **Three-layer consistency**: Backend INPUT_TYPES, frontend widget construction, validation schema defaults all synchronized

### Rationale
- **Standard Resolution Default**: 1024×1024 is more universally compatible with modern SD models (SD1.5, SDXL, Flux, Illustrious)
- **Manual-first Workflow**: IMAGE MODE OFF by default encourages manual dimension control (users can enable for reference images)
- **Wider Landscape**: 5.2:2.5 (~2.08:1) provides cinematic/presentation aspect ratio option beyond standard 16:9
- **Visual Distinction**: Dark red fill color provides better visual contrast than gray for debugging/testing

### Notes
- No breaking changes to existing workflows (only affects new nodes and corrupted workflow healing)
- All existing workflows preserve their saved values
- Validation system ensures consistency across all three default layers

## [0.5.3] - 2025-11-07

### Fixed
- **Logging Performance Overhead** - Eliminated performance impact of debug logging for normal users
  - Applied guards (`if (logger.debugEnabled)`) around all expensive logging operations
  - Protected JSON.stringify calls in per-widget restore loops (4 locations)
  - Protected large object logging (8 locations)
  - Protected template literal evaluations (15+ locations)

### Performance
- **Benchmark Results** (200K operations, 20 widgets):
  - Unguarded logging: +112.31% overhead (13.80ms vs 6.50ms baseline)
  - Guarded logging: -6.15% overhead (6.10ms vs 6.50ms baseline)
  - Argument evaluation cost: +87.67% (JSON.stringify + template literals)
  - **Result**: Zero-cost logging for normal users with debug disabled

### Technical
- **Root Cause**: JavaScript evaluates function arguments before calling functions
  - Even with early return in logger.debug(), expensive operations execute
  - JSON.stringify and template literals evaluated before method call
- **Solution**: Conditional guards prevent argument evaluation entirely
  - Pattern: `if (logger.debugEnabled) { logger.debug(...) }`
  - Applied to all logging with expensive arguments (JSON.stringify, template literals, large objects)
- **Test Infrastructure**: Created cross-platform performance testing framework
  - `tests/one-offs/performance/test_logging_performance.html` - Synthetic benchmark
  - `tests/one-offs/run_performance_tests.py` - Cross-platform test runner (Windows/Linux/macOS)
  - `tests/one-offs/clean_performance_tests.py` - Test cleanup utility
  - Tests copy to `web/tests/` temporarily (gitignored, not distributed)

### Fixed
- **Pre-commit Hook Pattern Matching** - Fixed false positive blocking test files
  - Changed `^.*.log` to `^.*\.log$` (escaped dot + end anchor)
  - Hook was matching substring `.log` in `test_logging_performance.html`
  - Now correctly matches only files ending in `.log` extension

### Notes
- No user-facing changes (debug mode only)
- Performance tests validate logging has zero impact with debug disabled
- Design doc: Performance testing methodology in `tests/one-offs/`

## [0.4.15] - 2025-11-07

### Added
- **Conflict Severity Visualization** - MODE widget background color indicates conflict severity
  - Yellow background (`#3a3000`) when WARNING severity conflicts present
  - Gray background (`#2a2a2a`) for INFO severity conflicts (unchanged)
  - Visual at-a-glance indication of which conflicts require attention vs informational
- **AR Ratio in MODE Display** - MODE widget now always shows simplified aspect ratio
  - Format: `"MEGAPIXEL & aspect_ratio (16:9)"` instead of just `"MEGAPIXEL & aspect_ratio"`
  - Label changed from `"Mode:"` to `"Mode(AR):"`
  - Uses exact AR from Python API to avoid rounding errors (e.g., shows `3:4` not `866:1155`)
- **Shortened MODE Text** - More compact labels to reduce node width requirements
  - "USE IMAGE DIMS AR Only" → "IMG AR Only"
  - "Image Exact Dims" → "IMG Exact Dims"

### Changed
- **MODE Tooltip UX** - Removed 2-second auto-hide timeout, tooltips stay visible while hovering
  - Label tooltip: Uses native ComfyUI tooltip system
  - Status tooltip: Custom conflict tooltip (only shows when conflicts exist)
  - Tooltips only hide when mouse leaves widget bounds

### Fixed
- **Duplicate Tooltip Issue** - Eliminated duplicate tooltips on label hover
  - Native tooltip via `this.tooltip` property for label
  - Custom tooltip only for status section with conflicts
  - Removed redundant `drawLabelTooltip()` method
- **Image Refresh Bug** - Dimension toggle changes now refresh image data when image connected
  - DimensionWidget toggles (WIDTH, HEIGHT, MEGAPIXEL) now trigger image dimension refresh
  - Ensures MODE display updates when image input source changes
  - Only refreshes when image connected and USE_IMAGE enabled

### Technical
- **ModeStatusWidget enhancements** (`web/smart_resolution_calc.js` lines 1712-2009):
  - Severity-based background color logic (lines 1735-1748)
  - AR ratio extraction with GCD simplification (lines 1081-1127)
  - Prefers `dimSource.ar.aspectW/aspectH` from Python API over local calculation
  - Separate tooltip zones for label vs status
- **ScaleWidget AR helpers**:
  - `_gcd()` - Greatest common divisor calculation (lines 1081-1090)
  - `_getSimplifiedRatio()` - Reduces ratios to simplest form (lines 1095-1110)
  - `_getARRatio()` - Extracts AR from dimension source (lines 1115-1127)
- **DimensionWidget image refresh** (lines 2249-2261):
  - Calls `refreshImageDimensions()` when toggle changes
  - Checks image connection and USE_IMAGE state before refreshing

### Notes
- Severity classification logic already existed in Python backend (no backend changes)
- Addresses Issue #12 (widget conflict detection UI)
- Addresses Issue #20 (conflict warning UI design - Option A implemented)
- Created Issue #28 (future declarative conflict resolution system)
- Created Issue #29 (low-priority tooltip positioning quirk)
- Design docs: `2025-11-06__19-46-23__conflict-severity-visualization-enhancement.md`, `2025-11-07__00-20-47__context-postmortem_v0.4.15-conflict-severity-ui.md`

## [0.4.14] - 2025-11-06

### Changed
- **Test Infrastructure** - Improved testing framework for MP modes validation
  - Confirms WIDTH+MEGAPIXEL and HEIGHT+MEGAPIXEL modes working correctly
  - Enhanced test coverage for all priority levels

### Technical
- Test suite enhancements for dimension source calculator
- Validation of megapixel-based calculation modes

### Notes
- No user-facing changes, internal testing improvements only
- Verifies v0.4.11 fixes are working correctly

## [0.4.13] - 2025-11-06

### Changed
- **Architecture Change: True Consolidation** (Issue #27) - Python is now single source of truth
  - JavaScript calls Python API endpoint instead of duplicating calculation logic
  - **Code reduction**: JavaScript dimension logic reduced from 543 lines to 171 lines (68% reduction)
  - Eliminates entire class of drift bugs (v0.4.11 bug now impossible)
  - Tooltip and execution now guaranteed to match (same Python calculation)

### Added
- **Python API Endpoint**: `/smart-resolution/calculate-dimensions` for dimension calculations
  - Accepts widget state and runtime context
  - Returns complete dimension source info (mode, baseW/H, AR, conflicts)
  - Single source of truth for all dimension calculations

### Fixed
- **custom_ratio Toggle Updates** - MODE widget now updates when custom_ratio toggled
  - Root cause: Reading `.value.on` (dimension widget pattern) instead of `.value` (toggle widget pattern)
  - Added debug logging for widget state serialization
  - All widget callbacks now properly async to await API responses

### Technical
- **Backend** (`py/smart_resolution_calc.py`):
  - Added `calculate_dimensions_api()` static method (lines 724-786)
  - Uses existing `DimensionSourceCalculator` class from prep work
- **Frontend** (`web/managers/dimension_source_manager.js`):
  - Made `getActiveDimensionSource()` async
  - Removed 397 lines of duplicate calculation logic
  - Serializes widget state for API calls
- **API Contract**:
  - Request: widget state + runtime context (image dimensions)
  - Response: complete dimension source info with conflicts
- **Error Handling**: Fallback to 1024×1024 if API fails

### Benefits
- **Single Source of Truth**: All calculations in Python
- **WYSIWYG Guaranteed**: Tooltip always matches execution
- **Maintainability**: Changes made once, affect tooltip + execution
- **Testability**: Test Python once, validates entire system
- **Drift Prevention**: JavaScript/Python cannot get out of sync

### Related Issues
- Completes Issue #27 (long-term consolidation strategy)
- Completes Issue #19 (Python backend parity)
- Advances Issue #15 (8/11 subtasks complete)

### Breaking Changes
None - API is internal, no user-facing changes

## [0.4.12] - 2025-11-06

### Fixed
- **Scale/Divisibility Rounding** - Unified rounding behavior between tooltip and execution
  - Root cause: JavaScript used `Math.round()` on floats, Python used `round()` on truncated ints
  - Now both maintain float precision through scaling before rounding
  - Example fix: WIDTH=1080, MEGAPIXEL=1.0, SCALE=1.1x now shows 1184×1016 in both tooltip and final output
  - Eliminates 4-8 pixel discrepancies in divisibility rounding

### Technical
- **Python Changes** (`py/smart_resolution_calc.py` lines 490-491):
  - Removed premature `int()` conversion after scaling
  - Now: `round(scaled_width / divisible_by) * divisible_by`
  - Was: `round(int(scaled_width) / divisible_by) * divisible_by`
- **JavaScript Already Correct**: Kept float precision throughout
- **Banker's Rounding**: Both now use same IEEE 754 round-half-to-even behavior

### Notes
- Tooltip preview now matches actual execution pixel-perfectly
- Fixes reported discrepancy in Issue discussion
- Related to WYSIWYG accuracy improvements

## [0.4.11] - 2025-11-06

### Fixed
- **WIDTH+MEGAPIXEL Mode AR Bug** - Fixed incorrect aspect ratio calculation
  - Root cause: Used dropdown AR instead of computing AR from resulting dimensions
  - Now correctly computes AR as `WIDTH : computed_HEIGHT`
  - Example fix: WIDTH=1080 + MEGAPIXEL=1.0 now shows `540:463 AR` (from dimensions) not `3:4 AR` (from dropdown)
- **HEIGHT+MEGAPIXEL Mode AR Bug** - Fixed same issue for HEIGHT+MEGAPIXEL
  - Now correctly computes AR as `computed_WIDTH : HEIGHT`

### Technical
- **Python Backend** (`py/dimension_source_calculator.py`):
  - Added AR computation in `_calculate_mp_width_explicit()` method
  - Added AR computation in `_calculate_mp_height_explicit()` method
  - AR now derived from final dimensions using GCD simplification
- **JavaScript Frontend** (`web/managers/dimension_source_manager.js`):
  - Matching AR computation in WIDTH+MEGAPIXEL path
  - Matching AR computation in HEIGHT+MEGAPIXEL path

### Notes
- Critical bug fix - WIDTH/HEIGHT+MEGAPIXEL modes were showing wrong AR in INFO output
- Discovered during testing of consolidation work
- Demonstrates why consolidation is important (bug existed in both JS and Python)

## [0.4.10] - 2025-11-05

### Changed
- **Unified MODE Display** - Consistent mode labels with AR source tracking
  - All mode descriptions now show aspect ratio source explicitly
  - Format: `"dimension_sources & ar_source (AR)"`
  - Examples:
    - `"WIDTH & HEIGHT (1:2)"` - Explicit dimensions
    - `"MEGAPIXEL & aspect_ratio (16:9)"` - Megapixel with dropdown AR
    - `"WIDTH & image_ar (1:1)"` - Width with image aspect ratio
    - `"HEIGHT & custom_ratio (5.2:2.5)"` - Height with custom ratio

### Technical
- Updated mode label generation across all 6 priority levels
- AR source now always included in description
- Consistent terminology between MODE widget and INFO output

## [0.4.9] - 2025-11-05

### Changed
- **MODE Widget Label** - Added clear label and improved terminology
  - Widget label now says "MODE:" before status value
  - Changed "AR Only" terminology to "image_ar" for consistency
  - Example display: `"MODE: MEGAPIXEL & image_ar (1024×1024)"`

### Technical
- Label positioning and rendering updates
- Terminology alignment with INFO output format

## [0.4.8] - 2025-11-05

### Added
- **Custom Read-Only MODE Status Widget** - Persistent mode visibility without canvas corruption
  - Implemented using native ComfyUI widget instead of custom draw cycle
  - Positioned above aspect_ratio widget
  - Shows current dimension calculation mode at all times
  - Auto-updates when dimension sources change

### Fixed
- **Canvas Corruption Issue** - Resolved by using native widget approach
  - Custom widget draw cycles were causing performance overhead at 60fps
  - Native widget approach eliminates corruption completely
  - Maintains WYSIWYG preview without visual artifacts

### Technical
- Native ComfyUI widget with read-only text display
- Event-driven updates on widget changes
- No custom draw cycle needed

## [0.4.7] - 2025-11-05

### Fixed
- **WIDTH+MEGAPIXEL Mode Label** - Corrected label showing disabled HEIGHT incorrectly
  - Root cause: Label included "HEIGHT (disabled)" when HEIGHT widget was inactive
  - Now shows: `"WIDTH + MEGAPIXEL"` (clean, accurate)
  - Applies to all MP combination modes

### Technical
- Mode label generation logic updated
- Only includes actually active/relevant widgets in label

## [0.4.6] - 2025-11-05

### Added
- **MODE Widget with Real-Time Updates** - First implementation of persistent mode display
  - Shows current dimension calculation mode above aspect_ratio widget
  - Updates immediately when any dimension-affecting widget changes
  - Format: `"Mode: [sources] ([dimensions])"`

### Fixed
- **DimensionWidget Update Propagation** - All dimension widget changes now trigger MODE updates
  - Added `updateModeWidget()` calls to toggle handlers (line ~1943)
  - Added `updateModeWidget()` calls to increment/decrement handlers (lines ~1962, ~1974)
  - Added `updateModeWidget()` calls to value edit callbacks (line ~1990)
- **ImageModeWidget Update Propagation** - USE IMAGE DIMS changes trigger MODE updates
  - Added `updateModeWidget()` calls to toggle handler (line ~2255)
  - Added `updateModeWidget()` calls to mode selector handler (line ~2298)
- **MODE Widget Image Cache Access** - Fixed MODE showing wrong mode with USE IMAGE DIMS
  - Root cause: `updateModeWidget()` wasn't passing `imageDimensionsCache` to manager
  - Now passes runtime context: `{imageDimensionsCache: this.imageDimensionsCache}`
  - MODE widget now matches SCALE tooltip exactly for AR Only mode

### Technical
- **updateModeWidget() Method**:
  - Calls `dimensionSourceManager.getActiveDimensionSource()` with runtime context
  - Updates MODE widget text from dimension source description
  - Invoked by all dimension-affecting widget change handlers
- **Integration Points** (multiple locations):
  - DimensionWidget: 4 handler locations
  - ImageModeWidget: 2 handler locations
  - Native widget wrappers: All wrapped callbacks

### Notes
- Completes user request for persistent mode visibility
- MODE widget provides instant feedback without requiring SCALE hover
- All three session bugs fixed (custom widgets, image mode, cache access)
- Foundation for future enhancements (read-only styling, conflict indicators)

## [0.4.5] - 2025-11-04

### Added
- **MODE status widget** (DISABLED - performance investigation needed)
  - Implementation complete but temporarily disabled due to canvas corruption during draw cycles
  - When enabled: Shows current dimension calculation mode above aspect_ratio
  - When enabled: Auto-updates when dimension sources change with simplified descriptions
  - Issue: Custom widget causes performance overhead at 60fps, needs optimization
  - Future: Consider stock ComfyUI widget or optimize ModeStatusWidget.draw()

### Changed
- **Debug logging converted to logger system** - Replaced console.log with logger.debug()
  - Added `dimensionLogger` instance for dimension/cache debugging
  - All debug logs now respect `DEBUG_SMART_RES_CALC` localStorage flag
  - Enable: `localStorage.setItem('DEBUG_SMART_RES_CALC', 'true')`
  - Enable verbose: `localStorage.setItem('VERBOSE_SMART_RES_CALC', 'true')`
  - Disable: `localStorage.removeItem('DEBUG_SMART_RES_CALC')`

### Fixed
- **AR Only mode label** - Now shows dimension source with AR source
  - Before: "AR Only: Image AR 16:9 (1920×1080)"
  - After: "WIDTH & image_ar: 16:9 (1920×1080)" (shows which dimension widget is active)
  - Applies to WIDTH, HEIGHT, MEGAPIXEL, or defaults
- **SCALE tooltip Mode line** - Now shows full context for AR Only mode
  - Before: "Mode: HEIGHT" (missing USE IMAGE DIMS context)
  - After: "Mode: HEIGHT & USE IMAGE DIMS AR Only" (clearly indicates image AR is being used)
  - Helps users understand when dimension calculations use image aspect ratio
- **SCALE tooltip overflow** - Fixed warning text overflowing tooltip box
  - Improved word wrapping to use pixel-based measurements instead of character count
  - Tooltip now expands dynamically to fit all content without text cutoff
  - Warning messages properly wrap at word boundaries

### Technical
- **Logger extraction refactor** - Resolved canvas corruption issue during draw cycles
  - Extracted `DebugLogger` to standalone ES6 module: `web/utils/debug_logger.js`
  - Eliminated circular dependency and global scope lookup overhead
  - Both `smart_resolution_calc.js` and `dimension_source_manager.js` now import via ES6
  - Performance: ES6 imports optimized better by JS engines than global property access at 60fps
  - Closes partial #5 (logger module extraction)
- **smart_resolution_calc.js**:
  - Added `ModeStatusWidget` class for read-only mode display
  - Added `dimensionLogger` instance: `new DebugLogger('SmartResCalc:Dimensions')`
  - Exposed globally: `window.smartResCalcDimensionLogger`
  - Converted cache, refresh, toggle, and connection debug logs
  - Uses `dimensionLogger.debug()` for standard debugging
  - Uses `dimensionLogger.verbose()` for detailed internal state
  - Mode widget auto-updates in `calculatePreview()` when dimensions change
  - Imports logger from `./utils/debug_logger.js` instead of inline definition
- **dimension_source_manager.js**:
  - Updated `_calculateAROnly()` to track dimension source (WIDTH/HEIGHT/MEGAPIXEL/defaults)
  - Description format: `${dimensionSource} & image_ar: ${ar}` instead of "AR Only: Image AR"
  - Converted priority selection debug logs to `logger.debug()`
  - Manager logs prefixed with `[Manager]` for clarity
  - Imports logger from `../utils/debug_logger.js` instead of global scope access

### Notes
- Debug logging now consistent with existing logger system
- Cleaner git history with proper logging infrastructure
- MODE widget provides instant feedback on dimension calculation strategy

## [0.4.4] - 2025-11-04

### Fixed
- **Critical: USE IMAGE DIMS = AR Only integration** - Manager now receives imageDimensionsCache
  - Pass runtime context to `getActiveDimensionSource(forceRefresh, runtimeContext)`
  - `ScaleWidget.calculatePreview()` passes `{imageDimensionsCache: this.imageDimensionsCache}`
  - `_calculateExactDims()` and `_calculateAROnly()` now use passed cache instead of querying ScaleWidget
  - Fixes broken behavior: Image 1024×1024 (1:1) + HEIGHT 640 now correctly gives 640×640 (not 866×1155)
  - Image AR properly used when AR Only mode enabled with dimension widgets
- **Mode line missing for WIDTH+HEIGHT** - `getSimplifiedModeLabel()` now handles "Explicit dimensions" description
  - Returns "WIDTH & HEIGHT" for explicit dimension mode
  - Mode line now appears for all widget combinations
- **Incorrect mode reporting** - Fixed cascading issue from AR Only bug
  - Mode now correctly shows "HEIGHT & image_ar" instead of "MEGAPIXEL & dropdown_ar & defaults"

### Technical
- **DimensionSourceManager API**:
  - `getActiveDimensionSource(forceRefresh, runtimeContext)` - Added optional `runtimeContext` parameter
  - `_calculateDimensionSource(runtimeContext)` - Extracts `imageDimensionsCache` from context
  - `_calculateExactDims(widgets, imageDimensionsCache)` - Uses passed cache parameter
  - `_calculateAROnly(widgets, imageDimensionsCache)` - Uses passed cache parameter
- **ScaleWidget integration**:
  - Updated manager call to pass `{imageDimensionsCache: this.imageDimensionsCache}`
  - Maintains separation of concerns (widget has runtime data, manager has calculation logic)
- **Mode label logic**:
  - Early check for "Explicit dimensions" pattern
  - Returns "WIDTH & HEIGHT" before falling through to source extraction

### Notes
- **All v0.4.3 known issues resolved** - USE IMAGE DIMS = AR Only works correctly
- **Mode visibility enhancement** (v0.4.5 planned):
  - Add persistent MODE status widget visible at all times
  - Position above aspect_ratio widget
  - Auto-updates on dimension changes
  - User suggestion: "MODE line should be visible at all times or easily accessible with mouseover"

## [0.4.3] - 2025-11-04

### Changed
- **SCALE Tooltip Refactor** (Issue #23): Replace manual dimension logic with DimensionSourceManager API
  - `ScaleWidget.calculatePreview()` now uses manager instead of 200+ lines of manual calculation
  - **Code reduction**: -162 lines (-76%) in `calculatePreview()` method
  - **Enhanced tooltip**: Now displays simplified mode label showing active sources
  - **Simplified Mode display**: Shows "HEIGHT & custom_ratio" instead of verbose descriptions with values
  - **Conflict warnings**: Tooltip shows conflicts in orange with detailed messages when detected
  - **Visual indicators**: Border color changes to orange when conflicts present
  - All 6 priority levels now visible to users via tooltip hover
  - Manager calculations finally exposed in UI (completes v0.4.2 integration)

### Technical
- **ScaleWidget changes**:
  - `calculatePreview()`: Reduced from 213 lines to 51 lines (replaces manual logic with `dimensionSourceManager.getActiveDimensionSource()`)
  - `drawTooltip()`: Enhanced to display mode, conflicts, and formatted conflict messages (+46 lines)
  - Tooltip dynamically adjusts height based on conflict count
  - Message wrapping for long conflict descriptions (60 char limit)
  - Color coding: Green (no conflicts), Orange (conflicts present)

### Benefits
- **Single source of truth**: Tooltip now shows exact same calculations that backend will use
- **User visibility**: Users can now see which dimension source mode is active
- **Debugging aid**: Conflict warnings help users understand widget interactions
- **Maintainability**: Future dimension logic changes only need to happen in manager
- **Consistency**: Eliminates risk of tooltip showing different calculations than actual node output

### Known Issues (to fix in v0.4.4)
- **Mode line missing for WIDTH+HEIGHT**: Mode line doesn't appear when both WIDTH and HEIGHT enabled
- **USE IMAGE DIMS = AR Only broken**: Uses dropdown AR instead of image AR when HEIGHT/WIDTH enabled
  - Example: Image 1024×1024 (1:1) + HEIGHT 640 should give 640×640, but gives 866×1155 (using dropdown 3:4 AR)
  - Root cause: DimensionSourceManager lacks access to ScaleWidget's imageDimensionsCache
  - Previous calculatePreview() had direct cache access - refactor broke this integration
- **Incorrect mode reporting**: Shows "MEGAPIXEL & dropdown_ar" instead of "HEIGHT & image_ar"

### Notes
- **Testing needed**: Manual verification that all 6 priority modes display correctly in tooltip
- **Python parity pending**: Backend needs matching implementation (Issue #19)
- **Integration fix needed**: Pass imageDimensionsCache to manager for proper image AR handling (v0.4.4)
- **Future improvements** (Issue #20 - Conflict Detection UI):
  - Per-widget conflict tooltips (show warnings at the problem widget, not just in SCALE)
  - Severity levels for conflicts (info/warning/error) to differentiate expected overrides from genuine ambiguity
  - Better discoverability - users shouldn't need to hover SCALE to see conflicts
- **Next steps**: Fix integration issues (v0.4.4), Python backend parity (v0.4.5), enhanced conflict UI (v0.5.x)

## [0.4.2] - 2025-11-04

### Added
- **Widget Integration** (Issue #22): Connect DimensionSourceManager to node lifecycle
  - Added `dimensionSourceManager` instance to node (activated on node creation)
  - **All priority modes now functional**: Exact Dims, MP+W+H scalar, explicit dimensions (W+H, MP+W, MP+H), AR Only, single dimension, defaults
  - Hooked all dimension widget callbacks (`dimension_width`, `dimension_height`, `dimension_megapixel`, `image_mode`)
  - Hooked native widget callbacks (`custom_ratio`, `custom_aspect_ratio`, `aspect_ratio`)
  - Hooked image load/change events to invalidate cache
  - Cache automatically invalidates when any dimension-affecting widget changes
  - Manager now actively calculates dimensions (though not yet exposed in UI)
  - **Effectively completes Issues #17 (MP+WIDTH) and #18 (MP+HEIGHT)** - code was already in manager, now activated

### Technical
- **Integration points** (~73 lines added):
  - Node initialization: `this.dimensionSourceManager = new DimensionSourceManager(this)`
  - DimensionWidget: Toggle, increment, decrement, value edit callbacks
  - ImageModeWidget: Toggle and mode selector callbacks
  - ScaleWidget: Image dimension fetch (server + info parsing paths)
  - Native widgets: Wrapped existing callbacks with cache invalidation

### Notes
- **Testing needed**: Manual verification that all widget changes trigger cache invalidation
- **Not yet exposed in UI**: Manager calculates dimensions but UI doesn't display them yet (Issue #23: SCALE tooltip refactor pending)
- **Python parity pending**: Backend needs matching implementation (Issue #19)
- **Next steps**: SCALE tooltip refactor (v0.4.3), conflict warnings (v0.4.4), Python parity (v0.4.5)

## [0.4.1] - 2025-11-04

### Changed
- **Code Modularization** (Issue #14 - partial): Extract DimensionSourceManager to separate module
  - Main file reduced from 4,033 to 3,523 lines (-510 lines, -12.6%)
  - Created `web/managers/dimension_source_manager.js` module (512 lines)
  - Establishes `web/managers/` directory pattern for architectural components
  - Uses ES6 `import/export` syntax for clean module loading
  - Tests modularization pattern before full Issue #14 implementation
  - Related: Issue #14 (full modularization plan)

### Technical
- **File Structure**:
  - `web/smart_resolution_calc.js`: Import statement added at top
  - `web/managers/dimension_source_manager.js`: Exported class with all 6 priority levels
  - ComfyUI ES6 module loading confirmed compatible

### Notes
- **Testing required**: Manual testing in ComfyUI to verify module loading works
- **Rollback available**: Can revert to v0.4.0 if module loading issues found
- **Future work**: Full Issue #14 modularization planned for v0.6.0 (after v0.5.x features complete)

## [0.4.0] - 2025-11-04

### Added
- **DimensionSourceManager Class** (Issue #16): Core architecture for dimension source priority system
  - Implements complete 6-level state machine to resolve dimension/aspect ratio conflicts
  - Centralized dimension calculation with explicit priority hierarchy
  - Memoization cache (100ms TTL) for performance optimization
  - Conflict detection system (7 conflict types with severity levels)
  - **Priority Hierarchy**:
    1. USE IMAGE DIMS = Exact Dims (absolute override)
    2. MP + WIDTH + HEIGHT (scalar with AR from W:H)
    3. Explicit Dimensions (WIDTH+HEIGHT, MP+WIDTH, MP+HEIGHT)
    4. USE IMAGE DIMS = AR Only (image AR + dimension widgets)
    5. Single dimension with AR (WIDTH/HEIGHT/MP + AR source)
    6. Defaults with AR (fallback)
  - **API**: `getActiveDimensionSource()` returns `{mode, priority, baseW, baseH, source, ar, conflicts, description}`
  - Foundation for Issues #17-#24 (widget integration, Python parity, testing)
  - Related: Issue #15 (umbrella), State Machine documentation in `private/claude/`

### Technical
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Added `DimensionSourceManager` class (~513 lines) between TooltipManager and InfoIcon classes
  - Implements all 6 priority level calculation methods
  - Helper methods: `_getWidgets()`, `_computeARFromDimensions()`, `_parseCustomAspectRatio()`, `_parseDropdownAspectRatio()`
  - Conflict detection: `_detectConflicts()` returns structured conflict objects
  - Cache management: `invalidateCache()` for widget change invalidation
  - GCD algorithm for aspect ratio reduction (1024:1024 → 1:1)
  - Supports all AR sources: custom_ratio, image AR, WIDTH+HEIGHT implicit, dropdown

### Notes
- **Not yet integrated**: Manager class exists but not hooked up to node/widgets (Issue #22)
- **Python parity pending**: Backend implementation in Issue #19 (v0.4.3)
- **Testing pending**: Issue #24 (v0.5.2) will validate all modes
- **Future work**: Widget integration (v0.4.4), SCALE tooltip refactor (v0.4.5), conflict warnings (v0.4.6)

## [0.3.7] - 2025-11-04

### Added
- **SCALE Widget: Double-Click Reset** (Issue #13): Double-click anywhere on SCALE slider to instantly reset to 1.0x
  - Works on both slider track and handle
  - 300ms double-click detection threshold
  - Quality of life improvement for quick reset without precise dragging
  - Logs reset action for debugging

## [0.3.6] - 2025-11-04

### Changed
- **Widget Rename**: "USE IMAGE?" renamed to "USE IMAGE DIMS?" for clarity
  - Updated all code, tooltips, and documentation
  - Makes it clear the toggle controls dimension extraction, not image output usage
- **Aspect Ratio Labels**: Updated dropdown labels to be more quantifiable and platform-specific
  - Replaced subjective flavor text with concrete use cases and standards
  - Examples: "9:16 (Slim Vertical)" → "9:16 (Vert Vids: YT Shorts/TikTok/Reels)", "16:9 (Panorama)" → "16:9 (HD Video/YouTube/TV)", "3:4 (Golden Ratio)" → "3:4 (SD Video Portrait)"
  - Added platform/format context: Instagram, photo print sizes, monitor standards, video platforms
  - Makes aspect ratio selection more intuitive for real-world use cases

### Fixed
- **SCALE Tooltip Aspect Ratio Bug** (Issue #11): Fixed tooltip showing incorrect base dimensions and aspect ratio
  - **Root cause**: Tooltip only checked `aspect_ratio` dropdown, never `custom_ratio` toggle, `custom_aspect_ratio` field, USE IMAGE DIMS (AR Only) mode, or WIDTH+HEIGHT explicit AR
  - **Now handles all 4 AR sources correctly**:
    1. `custom_ratio` + `custom_aspect_ratio` (checked first)
    2. USE IMAGE DIMS (AR Only) - uses image aspect ratio
    3. WIDTH + HEIGHT (both enabled) - explicit aspect ratio from dimensions
    4. `aspect_ratio` dropdown (fallback)
  - **Displays AR in tooltip**: Shows "(MP, AR)" format on Base line for clarity (e.g., "1.44 MP, 1:1 AR")
  - **Reduces AR to simplest form**: Uses GCD to show 1:1 instead of 1024:1024, matching Python backend behavior
  - **Supports float ratios**: Parses with `parseFloat()` for cinema formats (2.39:1, 1.85:1)
  - **Example fixes**:
    - Custom ratio "5.225:2.25" + HEIGHT 1200 → tooltip shows base ~2790×1200 (was 900×1200) with "5.225:2.25 AR"
    - USE IMAGE DIMS with 1024×1024 image → tooltip shows "1:1 AR" (was "3:4 AR" from dropdown)
    - WIDTH=320 + HEIGHT=640 enabled → tooltip shows "1:2 AR" (was "3:4 AR" from dropdown)

### Technical
- **JavaScript Changes** (`web/smart_resolution_calc.js`):
  - Updated `ScaleWidget.calculatePreview()` to check all aspect ratio sources in priority order
  - Added `aspectW` and `aspectH` to return value for tooltip display
  - Reduces image AR to simplest form using GCD when USE IMAGE DIMS enabled (both AR Only and Exact Dims modes)
  - Reduces WIDTH+HEIGHT explicit AR to simplest form using GCD (e.g., 320:640 → 1:2)
  - Parses `custom_aspect_ratio` with `parseFloat()` to support decimal ratios
  - Falls back to dropdown if custom ratio invalid or not enabled
  - Added debug logging for aspect ratio source selection

## [0.3.5] - 2025-11-04

### Changed
- **Documentation Updates**: Complete documentation for v0.3.x feature set
  - CHANGELOG.md: Documented all transform modes and color picker fixes from v0.3.4
  - README.md: Updated features list with 4 transform modes and IMAGE output details
  - docs/image-input.md: Updated version number
- **Version Bump**: Incremented to v0.3.5 for documentation completion

### Notes
This is a documentation-only release. All functionality was implemented in v0.3.4.

## [0.3.4] - 2025-11-04

### Added
- **Complete Transform Mode Suite**: Four distinct image transformation strategies for IMAGE output (Issue #4)
  - **transform (distort)**: Scale to exact dimensions, ignores aspect ratio (stretch/squash to fit)
  - **transform (crop/pad)**: Pure crop/pad at 1:1 scale, NO scaling applied
  - **transform (scale/crop)**: Scale to cover target maintaining AR, crop excess
  - **transform (scale/pad)**: Scale to fit inside target maintaining AR, pad remainder
- **Smart Mode Selection**: Enhanced "auto" mode defaults to "transform (distort)" when image input detected
- **Enhanced Tooltips**: Clear descriptions for each transform mode explaining behavior and use cases

### Fixed
- **Color Picker Button Positioning**: Fixed duplicate widget insertion causing position drift (from index 9 to 15+)
  - Root cause: `addWidget()` appends to end, then `splice()` re-inserted, creating duplicate references
  - Solution: Remove from auto-inserted position before manual positioning
  - Button now stable at correct index across all connection cycles
- **Color Picker Button Unclickable After Hide/Restore**: Fixed `origType` preservation issue
  - Root cause: `origType` save loop ran before button creation, button never got `type = "custom"` preserved
  - Solution: Moved `origType` save loop after all widget creation
  - Button now immediately clickable and remains clickable through all hide/restore cycles
- **Color Picker Positioning**: Picker now appears at mouse position + 100px offset (with edge detection)
  - Previously appeared at 0,0 or viewport center
  - Smart boundary detection prevents picker going off-screen
- **Widget Value Contamination**: Resolved as side effect of fixing button position drift
  - Values no longer swap between widgets during initial creation

### Technical (Backend)
- **Updated Parameters** (`py/smart_resolution_calc.py`):
  - `output_image_mode`: Expanded from 3 to 6 options (auto, empty, 4 transform modes)
  - Enhanced tooltip documentation for all modes
- **New Methods**:
  - `transform_image_scale_pad()`: Scales to fit inside, pads remainder (lines 606-681)
  - `transform_image_crop_pad()`: Pure crop/pad with NO scaling (lines 683-784)
  - `transform_image_scale_crop()`: Scales to cover, crops excess (lines 786-863)
- **Renamed Method**:
  - `transform_image_crop_pad()` → `transform_image_scale_pad()` (accurate naming)
- **Implementation Details**:
  - All modes maintain input batch size
  - Center alignment for crop/pad operations
  - Exact target dimension output guaranteed
  - Aspect ratio preservation for scale/crop and scale/pad modes
  - Debug logging for transform strategy details

### Transform Mode Examples (1024×1024 → 1885×530)
1. **distort**: Direct scale to 1885×530 (stretched/squashed)
2. **crop/pad**: Keep 1024×530 centered, pad 431px left/right (1:1 original scale)
3. **scale/crop**: Scale to 1885×1885 (cover width), crop 677px top/bottom
4. **scale/pad**: Scale to 530×530 (fit height), pad 677px left/right

### Benefits
- ✅ **Complete Control**: Four strategies cover all common image transformation needs
- ✅ **Aspect Ratio Options**: Preserve AR (scale/crop, scale/pad) or ignore it (distort)
- ✅ **Scaling Options**: Scale (distort, scale/crop, scale/pad) or no scale (crop/pad)
- ✅ **Professional Results**: Center-aligned operations, exact dimension output
- ✅ **Fill Integration**: Padding uses existing fill_type/fill_color system

### Related Issues
- Completes Issue #4 (Add IMAGE output) - Full transform functionality implemented
- Created Issue #9: Future enhancement for chainable transform operations
- Created Issue #10: SCALE widget fine granularity bug (0.01-0.02 step limitation)

### Known Limitations
- Transform modes use bilinear interpolation only (no other upscale methods)
- SCALE widget fine increments (0.01-0.02) difficult to achieve by dragging (Issue #10)
- Widget value corruption bug still present (Issue #8)

## [0.3.3] - 2025-11-02 (Work in Progress - Known Bugs)

### Added
- **DazzleNodes Compatibility**: Dynamic import support for multi-package loading
  - Auto-detects import path depth using import.meta.url
  - Works in standalone mode: `/extensions/smart-resolution-calc/`
  - Works in DazzleNodes mode: `/extensions/DazzleNodes/smart-resolution-calc/`
  - Wrapped extension in async IIFE with Promise-based imports

- **Color Picker Button Widget**: Dedicated button for visual color selection
  - Separate "🎨 Pick Color" button widget (not hybrid text widget)
  - Custom draw shows color preview with contrasting text
  - Updates fill_color text widget when color selected
  - Inserted directly after fill_color widget for logical grouping

### Changed
- **Category**: Changed from "Smart Resolution" to "DazzleNodes" for package grouping

### Known Issues (DO NOT RELEASE)
- ⚠️ Color picker positioning BROKEN - appears in wrong location
- ⚠️ Picker may not appear consistently
- ⚠️ Position calculation based on estimates (80px header + 30px/widget)
- ⚠️ Does not account for actual widget heights or node transformations
- **Next**: Fix positioning algorithm or implement alternative approach

### Technical
- Dynamic import helper: importComfyCore() with path depth calculation
- Color picker button uses fixed positioning with calculated coordinates
- Debug logging via visibilityLogger for click events
- Widget splice insertion maintains logical order

## [0.3.2] - 2025-11-01 (Non-functional release)

### Changed
- **Color Button Widget**: Replaced fill_color text input with button showing color preview
  - Visual color preview as button background
  - Automatic text color inversion for legibility (black text on light colors, white on dark)
  - Single-click to open native browser color picker
  - No focus-fighting issues (resolved text widget conflict from v0.3.1)

### Technical
- Custom button widget with `draw()` method for color preview rendering
- Luminance-based contrast calculation for text color (0.299*R + 0.587*G + 0.114*B formula)
- Direct button callback (no double-click detection needed)
- Hidden color input element for native picker integration

## [0.3.1] - 2025-11-01

### Added
- **Debug Infrastructure**: Separate visibility logger for conditional widget features
  - New debug channel: `SmartResCalc:Visibility`
  - Globally accessible via `window.smartResCalcVisibilityLogger`
  - Cleaned up verbose console.log statements

### Experimental
- **Double-Click Color Picker** (partially working)
  - Detects double-click on fill_color text field
  - Opens native browser color picker
  - Known issue: Immediately dismissed due to text widget focus stealing
  - Will be replaced with button widget in v0.3.2

## [0.3.0] - 2025-11-01

### Added
- **IMAGE Output**: New dedicated IMAGE output for generated/transformed images (separate from preview)
  - Three output modes: auto (smart default), empty (generated image), transformed (resized input)
  - Five fill patterns: black, white, custom_color, noise (Gaussian), random (uniform)
  - Smart defaults: "auto" mode selects transformed (with image input) or empty (without image input)
  - Conditional visibility: output parameters hidden when IMAGE output not connected
  - Breaking change: LATENT output moved from position 5 to 6 (IMAGE now at position 5)

### Technical (Backend)
- **New Parameters** (`py/smart_resolution_calc.py`):
  - `output_image_mode`: ["auto", "empty", "transformed"] with smart defaults
  - `fill_type`: Five pattern options with detailed tooltips
  - `fill_color`: Hex color code support (#RRGGBB format)
- **New Methods**:
  - `create_empty_image()`: Generates images with configurable fill patterns
  - `transform_image()`: Resizes input images using `comfy.utils.common_upscale`
- **Fill Pattern Implementations**:
  - Black: `torch.zeros()` (solid #000000)
  - White: `torch.ones()` (solid #FFFFFF)
  - Custom Color: Hex RGB parsing with validation
  - Noise: Gaussian distribution (`randn() * 0.1 + 0.5`, camera-like)
  - Random: Uniform distribution (`rand()`, TV static-like)
- **Smart Defaults Logic**: "auto" mode selects based on input image presence
  - Input image connected → "transformed" (resize input to calculated dimensions)
  - No input image → "empty" (generate image with fill pattern)
  - User can override by selecting "empty" or "transformed" explicitly

### Technical (Frontend)
- **Conditional Widget Visibility** (`web/smart_resolution_calc.js`):
  - Monitors IMAGE output (position 5) connection state
  - Hides `output_image_mode`, `fill_type`, `fill_color` when output not connected
  - Uses `widget.type = "converted-widget"` pattern for hiding
  - Automatic node resize when widgets shown/hidden
- **Double-Click Color Picker**:
  - Native browser color picker via hidden input element
  - Opens on double-click of fill_color widget
  - Updates widget value on color selection
  - Graceful cancellation handling
- **Enhanced Tooltips**: Multi-line tooltips explaining all parameters and fill pattern differences

### Benefits
- ✅ **Dual Output System**: Preview (unchanged) + dedicated IMAGE output
- ✅ **Flexible Fill Patterns**: Multiple options for generated images
- ✅ **User-Friendly**: Visual color picker, smart defaults, conditional visibility
- ✅ **Backward Compatible**: Preview output unchanged, existing workflows unaffected (except LATENT position)
- ✅ **Performance**: Uses ComfyUI standard upscale function for transforms

### Breaking Changes
- **LATENT Output Position**: Moved from position 5 to 6 (IMAGE now at position 5)
  - Workflows using LATENT output will need reconnection
  - All other outputs remain in same positions

### Known Limitations
- Color picker requires double-click (single click edits text value)
- Transform mode only supports bilinear interpolation currently
- IMAGE output nub is always visible (cannot be hidden, even when not connected)

## [0.2.0-beta]

### Fixed
- **Custom Aspect Ratio Float Parsing**: Fixed bug where custom aspect ratios with decimal values (e.g., "1.85:1", "2.39:1") threw `invalid literal for int()` error
  - Changed parsing from `int()` to `float()` to support cinema-standard ratios
  - Added validation for positive values (rejects negative, zero, or non-numeric input)
  - Graceful fallback to 16:9 with error logging for invalid input
  - Maintains backward compatibility with integer ratios ("16:9" still works)
  - Fulfills tooltip promise: "fractional OK: '1:2.5', '16:9', '1.85:1'"

## [0.2.0-alpha8] - 2025-10-26

### Added
- **Label-Based Tooltip System**: Info icons positioned on widget labels with quick/full tooltips and external documentation
- **Tooltip Manager**: Centralized tooltip lifecycle management with dual-delay timing (quick at 250ms, full at 1250ms)
- **InfoIcon Component**: Reusable info icon with hit detection, hover state, and click-to-docs functionality
- **Composite Widget Support**: ImageModeWidget with toggle + mode selector + tooltip (complex layout)
- **Native Widget Tooltips**: Tooltip support for ComfyUI native widgets (aspect_ratio, divisible_by, custom_aspect_ratio)
- **Shift+Click Documentation**: Quick tooltip on hover, full tooltip after delay, Shift+Click opens external docs (USE IMAGE widget)
- **Performance Optimized**: Hot-path logging removed, efficient hit detection, minimal redraw overhead

### Technical (Frontend)
- **TooltipManager** (`web/smart_resolution_calc.js` lines 183-278):
  - Global singleton pattern for lifecycle management
  - Dual-delay system: quick (250ms), full (1250ms + 750ms fade-in)
  - Reset on mouse leave, Shift+Click handling
  - Clean state management (activeTooltip, quickShown, fullShown)
- **InfoIcon** (`web/smart_resolution_calc.js` lines 280-514):
  - Label-relative positioning (icon at label end)
  - Hit area detection with padding (15px × widgetHeight)
  - Three states: normal, hover (blue #4a7a9a), docs available (cursor:pointer)
  - External docs handling via `window.open(docsUrl)`
- **Tooltip Content** (`web/tooltip_content.js`):
  - Centralized content definitions (quick, full, docsUrl, hoverDelay)
  - Six widgets configured: image_mode, megapixel, divisible_by, custom_aspect_ratio, scale, aspect_ratio
  - Prioritized by user confusion potential (high/medium/low)
- **Native Widget Integration** (`web/smart_resolution_calc.js` lines 2555-2590):
  - `wrapWidgetWithTooltip()` method for native widgets
  - ComfyUI drawWidgets() override to set hit areas after native draw
  - Hit area calculated from label position + label width
  - Tooltip draw/mouse delegated to InfoIcon
- **ImageModeWidget Integration** (lines 1918-2035):
  - Composite widget with InfoIcon positioned at label
  - Toggle + mode selector + tooltip in single widget
  - Hit area set during draw, tooltip handled in mouse method
- **Widget Measurements**:
  - Label width via `ctx.measureText(labelText).width`
  - Icon positioned at label end (labelX + labelWidth)
  - Hit area: 15px left of label start to end of label text
  - Widget height: `LiteGraph.NODE_WIDGET_HEIGHT` (28px standard)

### Tooltip Content Added
1. **USE IMAGE?** (image_mode) - High priority
   - Quick: "Extract dimensions from image. AR Only: ratio | Exact Dims: exact"
   - Full: Explains two modes, asymmetric behavior, snapshot workflow
   - Docs: `/docs/image-input.md` (Shift+Click functional)
2. **MEGAPIXEL** (megapixel) - High priority
   - Quick: "Target resolution in millions of pixels (1MP = 1024×1024)"
   - Full: Explains MP calculation, future features
3. **divisible_by** - High priority
   - Quick: "Ensures dimensions divisible by N for AI model compatibility"
   - Full: Explains why needed, model requirements, recommended values
4. **custom_aspect_ratio** - Medium priority
   - Quick: "Format: W:H (fractional OK: '1:2.5', '16:9', '1.85:1')"
   - Full: Multiple format examples, cinema ratios
5. **SCALE** - Medium priority
   - Quick: "Multiplies base dimensions (applies to image input + manual)"
   - Full: Explains interaction with image modes, asymmetric slider
6. **aspect_ratio** - Low priority
   - Quick: "Aspect ratio for calculations (ignored if both W+H set)"
   - Full: Priority rules, preset vs custom ratios

### Benefits
- ✅ **Self-Documenting UI**: Users discover features via tooltips without reading full docs
- ✅ **Progressive Disclosure**: Quick hint → full explanation → external docs (three levels)
- ✅ **Label Integration**: Icons positioned naturally at widget labels (not separate widgets)
- ✅ **Performance**: Hot-path logging removed (~10 verbose logs), minimal redraw overhead
- ✅ **Extensible**: Easy to add tooltips to new widgets via TOOLTIP_CONTENT
- ✅ **Native Widget Support**: Works with both custom and ComfyUI native widgets

### Documentation
- Updated `docs/image-input.md` to reflect current ImageModeWidget implementation
- Documented composite widget structure (toggle + mode selector)
- Added Shift+Click functionality documentation

### Performance Improvements
- Removed verbose logging from tooltip hot paths (draw/mouse methods that fire every frame)
- Eliminated ~10 debug logs from TooltipManager, ImageModeWidget, CopyImageButton
- Kept one-time event logs (node creation, toggle blocking)

### Known Limitations
- Shift+Click only functional for USE_IMAGE widget (others have `docsUrl: null`)
- Native widget Shift+Click planned for future release (requires ComfyUI framework changes)
- Single-level tooltip nesting (no tooltip-within-tooltip)

## [0.2.0-alpha7] - 2025-10-26

### Added
- **Behavior Pattern System**: Configurable widget interaction modes via `ToggleBehavior` and `ValueBehavior` enums
- **ToggleBehavior Enum**: SYMMETRIC (can toggle both directions freely) / ASYMMETRIC (one direction has constraints)
- **ValueBehavior Enum**: ALWAYS (values always editable) / CONDITIONAL (values only editable when conditions met)
- **Explicit Configuration**: Widget behavior now explicitly configured via constructor config parameter

### Changed
- **DimensionWidget**: Now explicitly configured as `ToggleBehavior.SYMMETRIC` + `ValueBehavior.ALWAYS`
- **ImageModeWidget**: Now explicitly configured as `ToggleBehavior.ASYMMETRIC` + `ValueBehavior.CONDITIONAL`
- **Self-Documenting Code**: Behavior intent obvious from configuration (e.g., `valueBehavior: ValueBehavior.ALWAYS`)

### Technical (Frontend)
- **Behavior Enums** (`web/smart_resolution_calc.js` lines 75-105):
  - `ToggleBehavior`: Controls when toggle can be enabled/disabled
  - `ValueBehavior`: Controls when values can be edited
  - Independent dimensions support all 4 combinations
- **DimensionWidget** (lines 1081-1299):
  - Constructor accepts optional `config` parameter with behavior properties
  - Mouse method checks `valueBehavior` before allowing value editing
  - Defaults preserve alpha6 behavior (SYMMETRIC toggle + ALWAYS values)
- **ImageModeWidget** (lines 1365-1568):
  - Constructor accepts optional `config` parameter with behavior properties
  - Toggle logic wrapped in `toggleBehavior` check (asymmetric by default)
  - Mode selector checks `valueBehavior` (conditional by default)
  - Defaults preserve alpha6 behavior (ASYMMETRIC toggle + CONDITIONAL values)

### Behavior Combinations Supported

All 4 combinations are valid and supported:

1. **Symmetric Toggle + Always Values** (DimensionWidget)
   - Toggle: Can enable/disable freely
   - Values: Always editable regardless of toggle state

2. **Asymmetric Toggle + Conditional Values** (ImageModeWidget)
   - Toggle: Can disable anytime, can only enable when image connected
   - Values: Only editable when toggle ON and image connected

3. **Asymmetric Toggle + Always Values** (Future use case)
   - Toggle: Has constraints (e.g., can't enable without connection)
   - Values: Always editable even when toggle OFF

4. **Symmetric Toggle + Conditional Values** (Future use case)
   - Toggle: Can enable/disable freely
   - Values: Only editable when toggle ON

### Benefits

**User Experience**:
- Behavior is predictable and consistent
- Alpha6 symmetric value editing preserved for DimensionWidget
- ImageModeWidget constraints preserved (can't enable without image)

**Developer Experience**:
- Self-documenting code (intent clear from configuration)
- Future widgets can choose behavior by passing config object
- Pattern established for consistent widget development
- Extensible (can add READONLY or other modes later)

**Terminology**:
- **SYMMETRIC/ASYMMETRIC** (toggles): Reflects bidirectional nature (both directions free vs one constrained)
- **ALWAYS/CONDITIONAL** (values): Reflects editing availability (always editable vs conditionally editable)
- Intuitive terminology matching actual behavior

### Backward Compatibility
- 100% backward compatible with alpha6
- All defaults preserve exact current behavior
- Config parameter optional (defaults handle everything)
- No breaking changes to existing workflows

## [0.2.0-alpha6] - 2025-10-26

### Fixed
- **DimensionWidget Value Editing**: Values can now be edited when MEGAPIXEL, WIDTH, HEIGHT widgets are toggled OFF
- **Symmetric Value Behavior**: Clicking grayed-out dimension values opens edit dialog (previously blocked)
- **Hit Area Registration**: Widget draw() method now sets value edit hit areas even when toggle is OFF

### Behavior Changes
- **Value Editing** (MEGAPIXEL/WIDTH/HEIGHT): Can edit values regardless of toggle state (symmetric behavior)
  - Toggle ON: Click value → edit dialog appears ✅
  - Toggle OFF: Click grayed value → edit dialog appears ✅ (NEW)
- **Button Visibility**: +/- increment/decrement buttons correctly hidden when toggle OFF (unchanged)
  - Toggle ON: +/- buttons visible and functional ✅
  - Toggle OFF: +/- buttons hidden, value still editable ✅

### What This Fixes
**Problem**: In alpha5 and earlier, dimension values couldn't be edited when toggled OFF
- User disables WIDTH, clicks "960" → nothing happens (edit blocked)
- Only workaround: Re-enable WIDTH, edit value, disable WIDTH again
- Asymmetric behavior forced unnecessary toggle state changes

**Solution**: Set hit areas in draw() method when toggle OFF, allow mouse() to handle clicks
- User disables WIDTH, clicks "960" → edit dialog appears ✅
- Value editable regardless of toggle state (symmetric behavior)
- +/- buttons still correctly hidden when toggle OFF

### Technical (Frontend)
- **Draw Method** (`web/smart_resolution_calc.js` lines 1112-1125):
  - Set `hitAreas.valueEdit` when toggle OFF (enables click detection)
  - Clear `hitAreas.valueDec/Inc` when toggle OFF (prevents invisible button clicks)
- **Mouse Method** (`web/smart_resolution_calc.js` lines 1221-1226):
  - Removed `if (this.value.on)` conditional blocking value editing
  - Changed comment from "Only handle if toggle is on" to "symmetric behavior - always editable"

### Known Limitations
- Full behavior pattern system not yet implemented (planned for future release)
- Currently only DimensionWidget has symmetric value editing
- Future: Configurable toggle/value/button behavior modes per widget type

## [0.2.0-alpha5] - 2025-10-25

### Fixed
- **Scale Tooltip AR Only Mode**: Tooltip now correctly respects user's dimension settings when USE_IMAGE in "AR Only" mode
- **Accurate AR-Based Calculation**: Extracts aspect ratio from image and applies to user's WIDTH/HEIGHT/MEGAPIXEL settings
- **Mode-Aware Logic**: Distinguishes between "AR Only" (extract AR, use with settings) and "Exact Dims" (use raw image dimensions)

### Technical (Frontend)
- **Mode Detection**: Check `imageMode` value (0=AR Only, 1=Exact Dims) to determine calculation path
- **AR Extraction**: Compute `imageAR = width / height` from cached image dimensions
- **AR-Based Calculation**: Use extracted AR with user's dimension settings:
  - HEIGHT enabled → compute WIDTH from HEIGHT × AR
  - WIDTH enabled → compute HEIGHT from WIDTH ÷ AR
  - MEGAPIXEL enabled → compute dimensions from MP and AR
  - Both W+H enabled → use as-is (ignore AR)
  - No settings → use raw image dimensions
- **AR Validation**: Check for NaN, infinity, zero before using AR (graceful fallback)
- **Enhanced Logging**: Show mode, extracted AR, and computed dimensions in debug logs

### Behavior Changes
- **AR Only Mode** (imageMode=0): Tooltip shows computed dimensions from image AR + user settings
  - Example: Image 1024×1024 (1:1), HEIGHT=1200 → Base: 1200×1200
  - Previously showed: Base: 1024×1024 (incorrect - ignored user's HEIGHT)
- **Exact Dims Mode** (imageMode=1): Tooltip shows raw image dimensions (unchanged)
  - Example: Image 1024×1024, HEIGHT=1200 → Base: 1024×1024 (correct - ignores HEIGHT)

### What This Fixes
**Problem**: In alpha4, Scale tooltip ignored user's dimension settings in "AR Only" mode
- User sets HEIGHT=1200 with 1024×1024 image
- Expected: Base 1200×1200 (computed from 1:1 AR + HEIGHT)
- Got: Base 1024×1024 (raw image dimensions)

**Solution**: Extract AR from image, apply to user's settings (matches backend logic)
- Now shows: Base 1200×1200 (computed WIDTH from HEIGHT × 1:1 AR)
- Tooltip preview matches actual backend calculation

### Testing Recommendations
Test all combinations of USE_IMAGE modes and dimension settings:
1. AR Only + HEIGHT → should compute WIDTH from AR
2. AR Only + WIDTH → should compute HEIGHT from AR
3. AR Only + MEGAPIXEL → should compute dimensions from AR + MP
4. Exact Dims + HEIGHT → should ignore HEIGHT, use image dimensions
5. Exact Dims + WIDTH → should ignore WIDTH, use image dimensions

## [0.2.0-alpha4] - 2025-10-25

### Fixed
- **Scale Tooltip Image-Aware**: Scale widget tooltip now shows correct base dimensions when USE_IMAGE is enabled
- **Automatic Dimension Fetching**: Tooltip silently fetches actual image dimensions in background using hybrid B+C strategy
- **Accurate Preview**: Users see the true starting dimensions (from image) rather than stale widget values

### Added
- **ImageDimensionUtils Module**: Shared utility functions for image dimension extraction (eliminates code duplication)
- **Dimension Caching**: ScaleWidget caches image dimensions for fast, responsive tooltip preview
- **Auto-Refresh Triggers**: Dimension cache automatically refreshes when image connected/disconnected or USE_IMAGE toggled

### Changed
- **CopyImageButton Refactored**: Now uses shared ImageDimensionUtils instead of duplicating fetch methods
- **Scale Preview Logic**: calculatePreview() checks USE_IMAGE state and uses cached image dimensions when available
- **Graceful Fallback**: If image dimensions unavailable, tooltip falls back to widget-based calculations (existing behavior)

### Technical (Frontend)
- **ImageDimensionUtils**: Three shared methods for dimension extraction:
  - `getImageFilePath()` - Extract path from LoadImage nodes
  - `fetchDimensionsFromServer()` - Server endpoint fetch (Tier 1)
  - `parseDimensionsFromInfo()` - Cached info parsing (Tier 2)
- **ScaleWidget.refreshImageDimensions()**: Async method using hybrid B+C strategy
  - Tier 1: Server endpoint (immediate for LoadImage nodes)
  - Tier 2: Info parsing (cached execution output)
  - Tier 3: Clear cache (fallback to widget values)
- **Dimension Cache Structure**: `{width, height, timestamp, path}` with path-based validation
- **Connection Change Handler**: Triggers dimension refresh on image connect/disconnect
- **Toggle Handler**: Triggers dimension refresh when USE_IMAGE toggled on/off
- **Performance**: Cache prevents redundant fetches, <50ms refresh time

### Benefits
- ✅ **Tooltip Accuracy**: Preview matches actual image dimensions when USE_IMAGE enabled
- ✅ **No User Action**: Dimension fetching happens silently in background
- ✅ **Fast & Responsive**: Cached dimensions keep tooltip snappy (no delays)
- ✅ **Code Reuse**: Shared utilities eliminate duplication between CopyImageButton and ScaleWidget
- ✅ **Robust Fallback**: Multi-tier strategy ensures tooltip always works

### Known Limitations
- Cache only refreshes on connection change or toggle (not on LoadImage widget changes)
- Generated images (not from files) require workflow run before dimensions cached

### Known Issues (Will Fix in Alpha5)
- Asymmetric toggle logic incorrectly applied to dimension widgets (MEGAPIXEL, WIDTH, HEIGHT)
- Should only apply to USE_IMAGE widget, dimension widgets should have symmetric toggle behavior

## [0.2.0-alpha3] - 2025-10-25

### Added
- **Hybrid B+C Copy Button**: Fully functional "Copy from Image" button with three-tier fallback strategy
- **Server Endpoint**: `/smart-resolution/get-dimensions` API for immediate dimension extraction from Load Image nodes
- **UNDO Button**: One-level undo for copy operations (restores previous WIDTH/HEIGHT values and toggle states)
- **USE_IMAGE Disabled State**: Asymmetric toggle logic when image input is disconnected
- **Multi-Level Debug Logging**: Verbose/Debug/Info/Error levels with localStorage control
- **Tier 1 - Server Method**: Reads image file metadata via PIL (works immediately for file-based images)
- **Tier 2 - Info Parsing**: Extracts dimensions from cached execution output (works after first workflow run)
- **Tier 3 - Instructions**: Helpful dialog guiding users through manual workflow

### Changed
- **Toggle State Preservation**: Copy button now preserves user's WIDTH/HEIGHT toggle states (doesn't force ON)
- **Widget Property Naming**: Renamed `disabled` to `imageDisconnected` to avoid LiteGraph framework conflicts

### Fixed
- **Visual Corruption**: Hidden default scale widget no longer renders over USE_IMAGE widget
- **Mouse Event Blocking**: LiteGraph `disabled` property was preventing all mouse events - now uses custom property
- **Server Endpoint**: Now handles filename-only paths (constructs full path in input directory)
- **Widget Type**: CopyImageButton now uses `type = "custom"` for proper mouse event routing
- **Logger Methods**: Added `info()`, `error()`, `verbose()` methods to DebugLogger

### Technical (Backend)
- Added `SmartResolutionCalc.get_image_dimensions_from_path()` static method
- Security validation: Path checking to prevent directory traversal
- Filename detection: Automatically constructs full path from filename when needed
- Allowed directories: ComfyUI input/output/temp folders only
- API endpoint registration in `__init__.py` with aiohttp

### Technical (Frontend)
- `CopyImageButton.copyFromImage()` orchestrates three-tier fallback
- `CopyImageButton.undoCopy()` restores previous dimension values
- `ImageModeWidget.mouse()` implements asymmetric toggle logic (allow OFF, block ON when disconnected)
- `getImageFilePath()` extracts file path from LoadImage nodes
- `fetchDimensionsFromServer()` async server call with error handling
- `parseDimensionsFromInfo()` regex parsing of cached info output
- `populateWidgets()` saves undo state before updating, preserves toggle states
- `showSuccessNotification()` logs success with source indicator
- Dual-button layout: Copy button shrinks when Undo available (3px margin)
- Success logging: `✓ Copied from File: 1920×1080 (16:9)`
- Undo logging: `↶ Undone: Restored WIDTH=512 (ON), HEIGHT=512 (OFF)`

### Coverage
- ✅ **Load Image (file)** - Works immediately via server endpoint
- ✅ **Previous execution** - Works via cached info parsing
- ✅ **Copy undo** - Restores previous values with one-level stack
- ✅ **USE_IMAGE disabled** - Cannot enable without image, can disable anytime
- ⚠️ **Generated images** - Works after first workflow run (info parsing)

### Known Limitations
- Generated images (not from files) require workflow run before copy works
- Server endpoint only supports file-based Load Image nodes currently
- UNDO is one-level only (not multi-level undo stack)
- No visual indication of USE_IMAGE disabled state (blocks clicks only)

## [0.2.0-alpha2] - 2025-10-25

### Changed (from alpha1)
- **ImageModeWidget Styling Fixes**: Added "USE IMAGE?" label, fixed toggle colors
- **Label Display**: Widget now shows "[Toggle] USE IMAGE? [AR Only/Exact Dims]" layout
- **Toggle Color**: Matches dimension widgets (green #4CAF50 when ON, gray #888888 when OFF)
- **Mode Selector**: Fixed width (100px), proper alignment on right side

### Technical
- Updated `ImageModeWidget.draw()` to include label text
- Updated `ImageModeWidget.drawToggle()` to match DimensionWidget style exactly
- Fixed mode selector positioning and hit area detection

### Known Issues
- Copy button still shows placeholder instructions (will fix in alpha3)
- Requires hybrid B+C implementation for immediate copying

## [0.2.0-alpha1] - 2025-10-25

### Added
- **Enable/Disable Toggle**: `enable_image_input` parameter allows turning off image extraction without disconnecting
- **Copy from Image Button**: New button widget for snapshot workflow (extract once, then manually adjust)
- **Parameter Tooltips**: Native ComfyUI tooltips explaining each image input parameter
- **Override Warning**: Info output shows `⚠️ [Manual W/H Ignored]` when Exact Dims mode overrides manual settings
- **Documentation**: Detailed image input guide in `docs/image-input.md`

### Changed
- **Parameter Renamed**: `match_exact_dimensions` → `use_image_dimensions` (clearer reference to image input)
- **Version Phase**: Updated from alpha to beta (UX improvements complete)
- **README Structure**: Simplified README, moved detailed docs to CHANGELOG and `docs/` folder

### Improved
- Image input parameters now clearly reference the image source
- Users can understand which settings are active via override warnings
- Three distinct workflows documented: Live AR, Exact Dims, Snapshot

## [0.2.0-alpha] - 2025-10-25

### Added
- **Image Input Feature**: Optional IMAGE input to extract dimensions from reference images
- **Two Extraction Modes**:
  - AR Only (default): Extract aspect ratio, use with megapixel calculation
  - Exact Dims: Use exact image dimensions with scale applied
- **Visual Indicator**: Node background color changes when image connected
- **Image Source Info**: Info output shows image extraction mode and dimensions

### Technical
- Python: Image dimension extraction from torch tensor `[batch, height, width, channels]`
- JavaScript: Visual connection indicator via `onConnectionsChange` handler
- Backward compatible with v0.1.x workflows

## [0.1.3-alpha] - 2025-10-22

### Fixed
- Various bug fixes and stability improvements

## [0.1.0-alpha] - 2025-10-20

### Added
- Initial release with compact custom widgets
- 5 calculation modes (Width+Height, Width+AR, Height+AR, MP+AR, Default)
- 23 preset aspect ratios (portrait, square, landscape)
- Custom aspect ratio support
- Scale multiplier with asymmetric slider (0.0-10.0x, 1.0x centered)
- Direct latent output
- Visual preview image
- Divisibility control (8/16/32/64)
- Debug logging (Python + JavaScript)
- Workflow persistence

### Technical
- rgthree-style compact widgets with toggle LEFT, value RIGHT
- Widget state serialization for workflow save/load
- ComfyUI Registry publication
