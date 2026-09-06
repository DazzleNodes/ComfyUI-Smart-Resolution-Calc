/**
 * Seed recovery from an image's prompt block (#58).
 *
 * A ComfyUI output image embeds two records of the run that made it:
 *   - `workflow` : the graph as the frontend serialized it BEFORE the seed
 *                  intercept ran, so its node.properties.dazzle_last_seed is
 *                  the PREVIOUS run's seed on images made with v0.12.2
 *   - `prompt`   : the API prompt Python actually executed, whose
 *                  inputs.fill_seed is the seed that produced this image
 *
 * When a workflow is loaded FROM AN IMAGE, the prompt block is authoritative
 * for every version of the metadata. These pure helpers extract those seeds
 * and apply one to a node; the wiring (wrapping app.handleFile, consulting
 * the pending map from the configure hook) lives in smart_resolution_calc.js.
 *
 * Nothing here touches widget.value: the widget keeps the mode the workflow
 * was saved in (random stays random, showing the recovered seed dimmed).
 */

const SPECIAL_SEEDS = new Set([-1, -2, -3]);
const SEED_WIDGET_NAME = 'fill_seed';
const SEED_NODE_CLASS = 'SmartResolutionCalc';

/**
 * Reduce a prompt-block fill_seed value to a concrete seed.
 * Accepts the widget's {on, value} shape or a bare number.
 *
 * @param {*} raw
 * @returns {number|null} the seed, or null for missing / non-numeric / special (-1/-2/-3)
 */
export function concreteSeed(raw) {
    const v = (raw && typeof raw === 'object' && 'value' in raw) ? raw.value : raw;
    if (typeof v !== 'number' || !Number.isFinite(v) || SPECIAL_SEEDS.has(v)) return null;
    return v;
}

/**
 * Collect the seeds of every SmartResolutionCalc entry in a parsed prompt block.
 *
 * @param {object} promptJson - parsed API prompt: { "<nodeId>": { class_type, inputs } }
 * @param {string} [classType]
 * @returns {Map<string, number>} node id (as a string) -> seed
 */
export function seedsFromPrompt(promptJson, classType = SEED_NODE_CLASS) {
    const seeds = new Map();
    if (!promptJson || typeof promptJson !== 'object') return seeds;
    for (const [id, entry] of Object.entries(promptJson)) {
        if (!entry || entry.class_type !== classType) continue;
        const seed = concreteSeed(entry.inputs?.fill_seed);
        if (seed != null) seeds.set(String(id), seed);
    }
    return seeds;
}

/**
 * Same as seedsFromPrompt, from the raw metadata string. Malformed JSON
 * yields an empty map rather than an exception (image metadata is untrusted).
 *
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function seedsFromPromptText(text) {
    if (typeof text !== 'string' || !text) return new Map();
    try {
        return seedsFromPrompt(JSON.parse(text));
    } catch (e) {
        return new Map();
    }
}

/**
 * Choose the frontend metadata reader for a dropped file, by MIME type first
 * and by extension as a fallback (drag-drop sometimes hands over a blank
 * type). Only PNG and webp carry ComfyUI metadata we read.
 *
 * @param {File|{name?: string, type?: string}} file
 * @param {object} pnginfo - window.comfyAPI.pnginfo (getPngMetadata, getWebpMetadata, ...)
 * @returns {Function|null}
 */
export function pickMetadataReader(file, pnginfo) {
    if (!file || !pnginfo) return null;
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    let reader = null;
    if (type === 'image/png' || name.endsWith('.png')) reader = pnginfo.getPngMetadata;
    else if (type === 'image/webp' || name.endsWith('.webp')) reader = pnginfo.getWebpMetadata;
    return typeof reader === 'function' ? reader : null;
}

/**
 * The prompt block text from a metadata object. WAS Node Suite writes the
 * webp EXIF keys capitalised (`Prompt`, `Workflow`); the frontend's own
 * loader accepts both spellings, so do the same.
 *
 * @param {object} meta
 * @returns {string|undefined}
 */
export function promptTextFromMeta(meta) {
    const text = meta?.prompt ?? meta?.Prompt;
    return typeof text === 'string' ? text : undefined;
}

/**
 * Apply the image's seed to one node: sets the seed widget's recall buffer
 * (lastSeed) and mirrors it into node.properties.dazzle_last_seed so a later
 * save from this tab carries the corrected value. Overrides whatever the
 * configure-time property hydration put there: the image's prompt outranks
 * the image's workflow property. Never touches widget.value.
 *
 * @param {object} node - LiteGraph node (id, widgets, properties)
 * @param {Map<string, number>} seeds - from seedsFromPrompt
 * @returns {boolean} true if a seed was applied
 */
export function applyImageSeed(node, seeds) {
    if (!node || !seeds || typeof seeds.get !== 'function') return false;
    const key = String(node.id);
    if (!seeds.has(key)) return false;
    const widget = node.widgets?.find(w => w.name === SEED_WIDGET_NAME);
    if (!widget) return false;
    const seed = seeds.get(key);
    widget.lastSeed = seed;
    if (!node.properties) node.properties = {};
    node.properties.dazzle_last_seed = seed;
    return true;
}
