# Changelog

All notable changes to ComfyUI Smart Resolution Calculator will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
