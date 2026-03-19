/**
 * DazzleNodes Widget Library — barrel file
 *
 * Single import point for the DazzleNodes widget framework.
 * Re-exports all public API from the component modules.
 *
 * Usage:
 *   import { DazzleWidget, DazzleToggleWidget, hideWidget, showWidget } from './dazzle.js';
 *   import { TooltipManager, InfoIcon } from './dazzle.js';
 *   import { applyDazzleSerialization } from './dazzle.js';
 */

// Base classes
export { DazzleWidget, hideWidget, showWidget,
         WIDGET_MARGIN, WIDGET_INNER_MARGIN, WIDGET_BG_COLOR, WIDGET_BG_RADIUS,
         WIDGET_LABEL_FONT, WIDGET_LABEL_COLOR_ON, WIDGET_LABEL_COLOR_OFF
       } from './components/DazzleWidget.js';

export { DazzleToggleWidget, ToggleBehavior, ValueBehavior,
         WIDGET_TOGGLE_COLOR_ON, WIDGET_TOGGLE_COLOR_OFF
       } from './components/DazzleToggleWidget.js';

// Tooltip system
export { TooltipManager, InfoIcon, tooltipManager, wrapWidgetWithTooltip
       } from './components/TooltipSystem.js';

// Validation
export { WIDGET_SCHEMAS, validateWidgetValue, logCorruptionDiagnostics
       } from './components/WidgetValidation.js';

// Serialization
export { applyDazzleSerialization } from './utils/serialization.js';

// Utilities
export { ImageDimensionUtils } from './utils/ImageDimensionUtils.js';
