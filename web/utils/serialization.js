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
 * Hooks serialize() to save widget values by name into `widgets_values_by_name`
 * when the frontend has not written its own `widgets_values_named` (1.5x
 * frontends do; older ones do not).
 * Hooks configure() to restore widget values by name on workflow load, preferring
 * the frontend's `widgets_values_named` when present and falling back to ours.
 *
 * Widget values are read from widget.value (serializeValue() is a passthrough
 * since v0.9.10) and restored by clone.
 *
 * @param {object} nodeType - LiteGraph node type prototype
 * @param {object} options - Optional hooks for node-specific serialization
 * @param {function} options.beforeSerialize - Called with (node) before the frontend's serialize runs
 * @param {function} options.onSerialize - Called with (data, node) after name-based save
 * @param {function} options.onConfigure - Called with (info, node) after name-based restore
 */
export function applyDazzleSerialization(nodeType, options = {}) {
    const originalSerialize = nodeType.prototype.serialize;
    nodeType.prototype.serialize = function() {
        // Node-specific pre-serialize hook (e.g. sync a hidden carrier widget)
        if (options.beforeSerialize) {
            options.beforeSerialize(this);
        }
        const data = originalSerialize ? originalSerialize.apply(this) : {};

        // Name-based serialization — widgets saved by name, not array index.
        //
        // Frontends from the 1.5x line write their own name-keyed block,
        // `widgets_values_named`, in the same call that writes the index-based
        // `widgets_values`, so the two are consistent by construction. Ours is
        // for frontends that restore by index only (it exists because our
        // custom widgets are spliced into node.widgets at runtime, so indices
        // drift between versions; v0.5.2). Under 1.53 our block was observed
        // going stale while every frontend record stayed current (2026-09-26),
        // so it is only written when the frontend has not written its own.
        if (!data.widgets_values_named) {
            const widgetsByName = {};
            if (this.widgets) {
                this.widgets.forEach((widget) => {
                    // Save widget.value directly — NOT serializeValue().
                    // Since v0.9.10 SeedWidget.serializeValue() is a pure passthrough
                    // (resolution happens in the queuePrompt intercept, never during
                    // auto-save/serialize cycles), so both this block and ComfyUI's
                    // index-based widgets_values carry the DISPLAY state (-1 in
                    // randomize mode) and the widget mode restores correctly.
                    // The actual resolved seed lives in node.properties.dazzle_last_seed
                    // (mirrored by the intercept) and is hydrated into the widget's
                    // lastSeed by the node's configure hook and, as a fallback, at
                    // queue time. It is NOT in widgets_values.
                    if (widget.value !== undefined) {
                        widgetsByName[widget.name] = widget.value;
                    }
                });
            }
            data.widgets_values_by_name = widgetsByName;
        } else if (Object.prototype.hasOwnProperty.call(data, 'widgets_values_by_name')) {
            // Defensive: never let a stale block ride along beside the frontend's.
            delete data.widgets_values_by_name;
        }

        // Node-specific serialization hook
        if (options.onSerialize) {
            options.onSerialize(data, this);
        }

        return data;
    };

    const originalConfigure = nodeType.prototype.configure;
    nodeType.prototype.configure = function(info) {
        // Take our keys out of the loaded data BEFORE the frontend sees it.
        // Frontends from the 1.5x line stash a loaded node's unknown keys and
        // re-emit them, unchanged, in every later save (measured 2026-09-26:
        // after editing height to 2100 the saved file still carried 1216 in
        // `widgets_values_by_name`, the copy it had loaded), and an older
        // frontend opening such a file would restore from that stale echo.
        // We consume the blocks here; the frontend has no use for them.
        const ourByName = info?.widgets_values_by_name;
        const ourConfig = info?.widgets_config;
        if (info && typeof info === 'object') {
            delete info.widgets_values_by_name;
            delete info.widgets_config;
            if (info.extensions && typeof info.extensions === 'object') {
                delete info.extensions.widgets_values_by_name;
                delete info.extensions.widgets_config;
                if (Object.keys(info.extensions).length === 0) delete info.extensions;
            }
        }

        if (originalConfigure) {
            originalConfigure.apply(this, arguments);
        }

        // Name-based restore. Precedence: the frontend's own `widgets_values_named`
        // (1.5x frontends; written together with `widgets_values`, so never stale)
        // outranks our `widgets_values_by_name`, which is used only when the
        // file has no frontend block (older files, older frontends). Values are
        // cloned so the widget never holds the loaded info object itself (a
        // shared reference bit a test fixture in 2026-09 and would let later
        // in-place edits leak into the loaded data).
        const named = info?.widgets_values_named;
        const source = (named && typeof named === 'object') ? named : ourByName;
        if (source && typeof source === 'object') {
            const sourceName = source === named ? 'widgets_values_named' : 'widgets_values_by_name';
            this.widgets.forEach(widget => {
                const saved = source[widget.name];
                if (saved !== undefined) {
                    widget.value = (saved && typeof saved === 'object') ? structuredClone(saved) : saved;

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
            logger.debug(`[configure] Name-based restore complete (source: ${sourceName})`);
        }

        // Node-specific restore hook: sees the loaded data with our blocks put
        // back, so node-specific readers (e.g. the pre-v0.12.5 widgets_config
        // fallback) keep working.
        if (options.onConfigure) {
            const hookInfo = Object.assign({}, info);
            if (ourByName !== undefined) hookInfo.widgets_values_by_name = ourByName;
            if (ourConfig !== undefined) hookInfo.widgets_config = ourConfig;
            options.onConfigure(hookInfo, this);
        }

        // Belt and braces for frontends that copy unknown keys onto the node as
        // own properties: nothing stale may remain to be echoed into a save.
        for (const key of ['widgets_values_by_name', 'widgets_config']) {
            if (Object.prototype.hasOwnProperty.call(this, key)) {
                delete this[key];
            }
        }
    };
}
