import { describe, it, expect, vi } from 'vitest';
import { concreteSeed, seedsFromPrompt, seedsFromPromptText, applyImageSeed, pickMetadataReader, promptTextFromMeta } from '../../web/utils/prompt_seed.js';
import { SeedWidget } from '../../web/components/SeedWidget.js';

// Shape of the prompt block embedded in probe_00001_.png (pre-0.12.3 fixture):
// the SmartResCalc node "1" sent fill_seed {on:true, value:91987083756186} to Python.
const PROMPT = {
    '1': { class_type: 'SmartResolutionCalc', inputs: { fill_seed: { on: true, value: 91987083756186 }, aspect_ratio: '1:1' } },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'seed_probe/probe' } },
};

function makeNode(id, { lastSeed = null, prop = undefined, withWidget = true } = {}) {
    const widget = new SeedWidget('fill_seed', -1, { services: { prompt: vi.fn() } });
    widget.lastSeed = lastSeed;
    const node = { id, widgets: withWidget ? [widget] : [], properties: {} };
    if (prop !== undefined) node.properties.dazzle_last_seed = prop;
    return { node, widget };
}

describe('concreteSeed', () => {
    it('unwraps the widget {on, value} shape', () => {
        expect(concreteSeed({ on: true, value: 42 })).toBe(42);
    });
    it('accepts a plain number', () => {
        expect(concreteSeed(42)).toBe(42);
        expect(concreteSeed(0)).toBe(0);
    });
    it('rejects the special values -1 / -2 / -3, wrapped or bare', () => {
        for (const v of [-1, -2, -3]) {
            expect(concreteSeed(v)).toBeNull();
            expect(concreteSeed({ on: true, value: v })).toBeNull();
        }
    });
    it('rejects strings, NaN, null, undefined, and objects without value', () => {
        for (const v of ['42', NaN, Infinity, null, undefined, {}, { on: true }, [], true]) {
            expect(concreteSeed(v)).toBeNull();
        }
    });
});

describe('seedsFromPrompt', () => {
    it('collects SmartResolutionCalc seeds keyed by string id, ignoring other classes', () => {
        const seeds = seedsFromPrompt(PROMPT);
        expect([...seeds.entries()]).toEqual([['1', 91987083756186]]);
    });
    it('skips entries whose fill_seed is special, non-numeric, or missing', () => {
        const seeds = seedsFromPrompt({
            '3': { class_type: 'SmartResolutionCalc', inputs: { fill_seed: { on: true, value: -1 } } },
            '4': { class_type: 'SmartResolutionCalc', inputs: { fill_seed: '99' } },
            '5': { class_type: 'SmartResolutionCalc', inputs: {} },
            '6': { class_type: 'SmartResolutionCalc' },
            '7': null,
            '8': { class_type: 'SmartResolutionCalc', inputs: { fill_seed: 7 } },
        });
        expect([...seeds.entries()]).toEqual([['8', 7]]);
    });
    it('returns an empty map for non-objects', () => {
        for (const v of [null, undefined, 'x', 3, []]) {
            expect(seedsFromPrompt(v).size).toBe(0);
        }
    });
    it('honours a numeric id by stringifying the key', () => {
        const seeds = seedsFromPrompt({ 12: { class_type: 'SmartResolutionCalc', inputs: { fill_seed: 5 } } });
        expect(seeds.get('12')).toBe(5);
    });
    it('keeps a legitimate seed of 0 (mutation M6: a truthiness check would drop it)', () => {
        const seeds = seedsFromPrompt({
            '1': { class_type: 'SmartResolutionCalc', inputs: { fill_seed: 0 } },
            '2': { class_type: 'SmartResolutionCalc', inputs: { fill_seed: { on: true, value: 0 } } },
        });
        expect(seeds.get('1')).toBe(0);
        expect(seeds.get('2')).toBe(0);
        const { node, widget } = makeNode('1', { lastSeed: 7 });
        expect(applyImageSeed(node, seeds)).toBe(true);
        expect(widget.lastSeed).toBe(0);
        expect(node.properties.dazzle_last_seed).toBe(0);
    });
});

describe('seedsFromPromptText', () => {
    it('parses the metadata string', () => {
        expect(seedsFromPromptText(JSON.stringify(PROMPT)).get('1')).toBe(91987083756186);
    });
    it('returns an empty map for malformed JSON or empty input', () => {
        for (const v of ['{not json', '', undefined, null, 42]) {
            expect(seedsFromPromptText(v).size).toBe(0);
        }
    });
});

describe('pickMetadataReader', () => {
    const png = () => 'png';
    const webp = () => 'webp';
    const pnginfo = { getPngMetadata: png, getWebpMetadata: webp };

    it('picks the PNG reader by MIME type, and by extension when the type is blank', () => {
        expect(pickMetadataReader({ name: 'a.png', type: 'image/png' }, pnginfo)).toBe(png);
        expect(pickMetadataReader({ name: 'A.PNG', type: '' }, pnginfo)).toBe(png);
    });
    it('picks the webp reader by MIME type, and by extension when the type is blank (mutation W1)', () => {
        expect(pickMetadataReader({ name: 'a.webp', type: 'image/webp' }, pnginfo)).toBe(webp);
        expect(pickMetadataReader({ name: 'shot.WEBP', type: '' }, pnginfo)).toBe(webp);
        expect(pickMetadataReader({ name: 'shot.webp', type: 'application/octet-stream' }, pnginfo)).toBe(webp);
    });
    it('returns null for other files, a missing pnginfo, or a reader that is not a function', () => {
        expect(pickMetadataReader({ name: 'w.json', type: 'application/json' }, pnginfo)).toBeNull();
        expect(pickMetadataReader({ name: 'a.jpg', type: 'image/jpeg' }, pnginfo)).toBeNull();
        expect(pickMetadataReader({ name: 'a.png', type: 'image/png' }, null)).toBeNull();
        expect(pickMetadataReader(null, pnginfo)).toBeNull();
        expect(pickMetadataReader({ name: 'a.webp', type: 'image/webp' }, { getPngMetadata: png })).toBeNull();
    });
});

describe('promptTextFromMeta', () => {
    it('returns the prompt string under the lowercase key', () => {
        expect(promptTextFromMeta({ prompt: '{"1":{}}', workflow: '{}' })).toBe('{"1":{}}');
    });
    it('falls back to the capitalised key written by WAS Node Suite webp EXIF (mutation W2)', () => {
        expect(promptTextFromMeta({ Prompt: '{"2":{}}', Workflow: '{}' })).toBe('{"2":{}}');
    });
    it('returns undefined for missing or non-string prompts', () => {
        expect(promptTextFromMeta({})).toBeUndefined();
        expect(promptTextFromMeta(null)).toBeUndefined();
        expect(promptTextFromMeta({ prompt: 42 })).toBeUndefined();
        expect(promptTextFromMeta({ prompt: { '1': {} } })).toBeUndefined();
    });
});

describe('applyImageSeed', () => {
    const seeds = seedsFromPrompt(PROMPT);

    it('sets lastSeed and mirrors the property for a matching node (string id)', () => {
        const { node, widget } = makeNode('1');
        expect(applyImageSeed(node, seeds)).toBe(true);
        expect(widget.lastSeed).toBe(91987083756186);
        expect(node.properties.dazzle_last_seed).toBe(91987083756186);
    });
    it('matches a numeric live id against the string prompt key', () => {
        const { node, widget } = makeNode(1);
        expect(applyImageSeed(node, seeds)).toBe(true);
        expect(widget.lastSeed).toBe(91987083756186);
    });
    it('overrides an already-hydrated (stale) lastSeed and property: the prompt outranks the workflow property', () => {
        const { node, widget } = makeNode('1', { lastSeed: 111111111111111, prop: 111111111111111 });
        expect(applyImageSeed(node, seeds)).toBe(true);
        expect(widget.lastSeed).toBe(91987083756186);
        expect(node.properties.dazzle_last_seed).toBe(91987083756186);
    });
    it('never touches widget.value or random mode', () => {
        const { node, widget } = makeNode('1');
        applyImageSeed(node, seeds);
        expect(widget.value).toEqual({ on: true, value: -1 });
        expect(widget.randomizeMode).toBe(true);
    });
    it('is a no-op (false) for a node absent from the prompt block', () => {
        const { node, widget } = makeNode('2', { lastSeed: 5, prop: 5 });
        expect(applyImageSeed(node, seeds)).toBe(false);
        expect(widget.lastSeed).toBe(5);
        expect(node.properties.dazzle_last_seed).toBe(5);
    });
    it('is a no-op (false) when the node has no seed widget, an empty map, or bad arguments', () => {
        const { node } = makeNode('1', { withWidget: false });
        expect(applyImageSeed(node, seeds)).toBe(false);
        expect(node.properties.dazzle_last_seed).toBeUndefined();
        expect(applyImageSeed(makeNode('1').node, new Map())).toBe(false);
        expect(applyImageSeed(null, seeds)).toBe(false);
        expect(applyImageSeed(makeNode('1').node, null)).toBe(false);
    });
    it('creates node.properties when the node has none', () => {
        const widget = new SeedWidget('fill_seed', -1, { services: { prompt: vi.fn() } });
        const node = { id: '1', widgets: [widget] };
        expect(applyImageSeed(node, seeds)).toBe(true);
        expect(node.properties.dazzle_last_seed).toBe(91987083756186);
    });
});
