# Contributing to Smart Resolution Calculator

Thank you for considering contributing to Smart Resolution Calculator!

## Code of Conduct

Please note that this project is released with a Contributor Code of Conduct.
By participating in this project you agree to abide by its terms.

## How Can I Contribute?

### Reporting Bugs

Use the Bug Report issue template to report issues. Please include:
- Your ComfyUI version and frontend version (`begin version` or check startup logs)
- Steps to reproduce
- Expected vs actual behavior
- Screenshots or workflow JSON if applicable
- Browser console output (F12) if it's a UI/rendering issue

### Suggesting Enhancements

Use the Feature Request issue template to suggest new features or improvements.

### Pull Requests

1. Fork the repository
2. Create a new branch for your feature/fix
3. Make your changes
4. Run the test suite (see Testing below)
5. Test in ComfyUI manually (see Manual Testing below)
6. Submit a pull request

## Project Architecture

### Python Backend (`py/`)

The Python code is modular — each file has a focused responsibility:

```
py/
├── __init__.py                    # Package marker
├── smart_resolution_calc.py       # Node class, CalculationContext pipeline, INPUT_TYPES
├── dimension_calculator.py        # DimensionSourceCalculator (6-priority resolution system)
├── noise_utils.py                 # spectral_noise_blend(), DazNoise detection/generation
└── image_utils.py                 # Image creation, 4 transform modes, preview, latent
```

**CalculationContext pipeline**: The main `calculate_dimensions()` method is a 7-stage pipeline using a context object. Each stage is a named helper method:

1. `_handle_image_input()` — extract dims/AR from image
2. `_resolve_dimensions()` — run DimensionSourceCalculator
3. `_apply_scale_and_divisibility()` — scale + round to divisor
4. `_resolve_seed()` — resolve seed from widget data
5. `_prepare_output_mode()` — resolve "auto" mode
6. `_resolve_image_purpose()` — route image to outputs based on image_purpose
7. `_generate_output_image()` / `_generate_latent()` / `_build_info_string()`

### JavaScript Frontend (`web/`)

The JavaScript is decomposed into ES6 modules with a widget class hierarchy:

```
web/
├── smart_resolution_calc.js       # Orchestrator (~980 lines)
├── dazzle.js                      # Library barrel file
├── components/
│   ├── DazzleWidget.js            # Base class (hit testing, visibility, tooltips)
│   ├── DazzleToggleWidget.js      # Toggle + value widgets (extends DazzleWidget)
│   ├── DimensionWidget.js         # Width/height/megapixel widgets
│   ├── SeedWidget.js              # Seed with randomize/fix/recall
│   ├── ScaleWidget.js             # Scale slider
│   ├── ImageModeWidget.js         # USE IMAGE DIMS toggle
│   ├── SpectralBlend2DWidget.js   # 2D XY pad for blend + cutoff
│   ├── ModeStatusWidget.js        # Mode(AR) display
│   ├── ColorPickerButton.js       # Color picker button
│   ├── CopyImageButton.js         # Copy from Image button
│   ├── TooltipSystem.js           # Tooltip manager + InfoIcon
│   └── WidgetValidation.js        # Schema validation
├── utils/
│   ├── serialization.js           # applyDazzleSerialization() helper
│   ├── debug_logger.js            # Debug logging system
│   └── ImageDimensionUtils.js     # Image dimension utilities
└── managers/
    └── dimension_source_manager.js # Dimension source tracking
```

**Widget class hierarchy**:
- `DazzleWidget` — base class with shared hit testing, tooltip, computeSize
- `DazzleToggleWidget` — adds toggle switch + value display (extends DazzleWidget)
- Specific widgets extend one of these two

**Key patterns**:
- Widget visibility uses draw/computeSize/mouse override (NOT array splice)
- Serialization is name-based via `applyDazzleSerialization()` (NOT index-based)
- Seed resolution happens in `app.api.queuePrompt` hook (NOT in serializeValue)
- Services pattern for testability (`this.services.prompt`)

## Testing

### Automated Tests

```bash
# From the tests/ directory:
cd tests

# DimensionSourceCalculator tests (20 tests)
python test_dimension_source_calculator.py

# Pipeline integration tests (23 tests)
python test_calculation_pipeline.py
```

**Note**: Running via `pytest` from the project root may fail because our `py/` directory shadows the `py` pip package that pytest depends on. Run tests directly with `python test_file.py` from the `tests/` directory instead.

### Manual Testing in ComfyUI

1. Symlink or copy your modified version to `ComfyUI/custom_nodes/smart-resolution-calc/`
2. Restart ComfyUI (or Ctrl+F5 in browser for JS-only changes)
3. Test the node in a workflow — verify all output modes work

**What to test**:
- All 5 `image_purpose` modes (img2img, dimensions only, img2noise, image+noise, img2img+img2noise)
- All 5 `output_image_mode` transforms (auto, empty, distort, crop/pad, scale/crop, scale/pad)
- Seed widget: randomize, fix, recycle, workflow save/load roundtrip
- Spectral blend: blend_strength + cutoff at various values
- Preview image: with and without image connected
- Widget visibility: connect/disconnect image, toggle image_purpose modes

### Debug Mode

**Python** (ComfyUI console):
```bash
# Windows
set COMFY_DEBUG_SMART_RES_CALC=true

# Linux/Mac
export COMFY_DEBUG_SMART_RES_CALC=true
```

**JavaScript** (browser console F12):
```javascript
localStorage.setItem('DEBUG_SMART_RES_CALC', 'true');    // Standard logging
localStorage.setItem('VERBOSE_SMART_RES_CALC', 'true');  // Detailed coordinates/state
```

## Development Setup

### Prerequisites
- ComfyUI installation
- Python 3.10+ (provided by ComfyUI)
- No additional pip dependencies (uses ComfyUI's PyTorch, PIL, numpy)

### Quick Start

```bash
# Clone
git clone https://github.com/DazzleNodes/ComfyUI-Smart-Resolution-Calc.git
cd ComfyUI-Smart-Resolution-Calc

# Symlink into ComfyUI (Windows PowerShell)
New-Item -ItemType Junction -Path "C:\path\to\ComfyUI\custom_nodes\smart-resolution-calc" -Target (Get-Location)

# Or copy
cp -r . C:/path/to/ComfyUI/custom_nodes/smart-resolution-calc/
```

### VSCode Debugging

To use the "ComfyUI: Debug This Node" configuration:

1. Set `COMFYUI_PATH` environment variable to your ComfyUI installation
2. Restart VSCode
3. Set breakpoints in Python or JavaScript files
4. Press F5 and select "ComfyUI: Debug This Node"

### Git Hooks and Version Management

This project uses automatic version tracking via git hooks.

```bash
# Install hooks (from project root)
./scripts/install-hooks.sh
```

Choose option 2 (Standard with security) for:
- Automatic `version.py` updates before each commit
- Post-commit hash correction
- Branch protection and large file blocking

**Version format**: `VERSION_BRANCH_BUILD-YYYYMMDD-COMMITHASH` (e.g., `0.10.4_main_157-20260321-49487a3`)

## Code Style

### Python
- Follow PEP 8
- Use type hints for function signatures and CalculationContext fields
- Preserve existing comments and debug logging lines
- Use surgical edits (Edit tool) rather than full file rewrites

### JavaScript
- ES6 modules with explicit imports/exports
- DazzleWidget subclasses must override `draw()`, may override `mouse()`, `computeSize()`, `serializeValue()`
- Use `hideWidget()`/`showWidget()` for visibility (never array splice)
- Use `widget.value` in serialize hooks (never `serializeValue()` — it has side effects)

## Documentation

- **[docs/image-purpose.md](docs/image-purpose.md)** — image_purpose modes and behavior matrix
- **[docs/spectral-blending.md](docs/spectral-blending.md)** — spectral blend algorithm, cutoff, and blend_strength
- **[docs/image-input.md](docs/image-input.md)** — image dimension extraction
- **[docs/extended-fill-types.md](docs/extended-fill-types.md)** — DazNoise fill patterns and sampler integration
