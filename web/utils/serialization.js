/**
 * DazzleNodes Serialization Utilities
 *
 * Name-based widget serialization for ComfyUI custom nodes.
 * Saves/restores widget values by name instead of array index,
 * preventing corruption when widget positions change.
 *
 * Usage:
 *   import { applyDazzleSerialization } from './utils/serialization.js';
 *   applyDazzleSerialization(nodeType);  // in beforeRegisterNodeDef
 */

import { logger } from './debug_logger.js';

/**
 * Apply name-based serialization to a node type.
 *
 * Hooks serialize() to save widget values by name into `widgets_values_by_name`.
 * Hooks configure() to restore widget values by name on workflow load.
 *
 * For custom widgets (type === "custom"), uses serializeValue() which may return
 * a resolved value (e.g., SeedWidget returns the actual seed, not -1).
 * For native ComfyUI widgets, uses widget.value directly.
 *
 * @param {object} nodeType - LiteGraph node type prototype
 * @param {object} options - Optional hooks for node-specific serialization
 * @param {function} options.onSerialize - Called with (data, node) after name-based save
 * @param {function} options.onConfigure - Called with (info, node) after name-based restore
 */
export function applyDazzleSerialization(nodeType, options = {}) {
    const originalSerialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function() {
        const data = originalSerialize ? originalSerialize.apply(this) : {};

        // Name-based serialization — widgets saved by name, not array index
        const widgetsByName = {};
        if (this.widgets) {
            this.widgets.forEach((widget, index) => {
                // Save widget.value directly — NOT serializeValue().
                // serializeValue() has side effects (SeedWidget resolves -1 to a
                // random seed and updates lastSeed). ComfyUI already calls
                // serializeValue() separately for the prompt data sent to Python.
                // Our workflow JSON saves the display state (e.g., -1 for randomize)
                // so the widget mode is correctly restored on reload.
                // The actual resolved seed is saved by ComfyUI in widgets_values
                // (the index-based array) via its own serializeValue call.
                if (widget.value !== undefined) {
                    widgetsByName[widget.name] = widget.value;
                }
            });
        }
        data.widgets_values_by_name = widgetsByName;

        // Node-specific serialization hook
        if (options.onSerialize) {
            options.onSerialize(data, this);
        }

        return data;
    };

    const originalConfigure = nodeType.prototype.configure;
    nodeType.prototype.configure = function(info) {
        if (originalConfigure) {
            originalConfigure.apply(this, arguments);
        }

        // Name-based restore
        if (info.widgets_values_by_name) {
            this.widgets.forEach(widget => {
                if (info.widgets_values_by_name[widget.name] !== undefined) {
                    widget.value = info.widgets_values_by_name[widget.name];

                    // If a seed widget was restored with a resolved (non-special) value,
                    // clear randomizeMode so the green tint doesn't show incorrectly.
                    // This handles loading workflows where the seed was resolved at save time.
                    if (widget.randomizeMode !== undefined && widget.value?.value >= 0) {
                        if (widget.setRandomMode) {
                            widget.setRandomMode(false);
                        } else {
                            widget.randomizeMode = false;
                        }
                    }
                }
            });
            logger.debug('[configure] Name-based restore complete');
        }

        // Node-specific restore hook
        if (options.onConfigure) {
            options.onConfigure(info, this);
        }
    };
}
