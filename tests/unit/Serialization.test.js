import { describe, it, expect, vi } from 'vitest';
import { applyDazzleSerialization } from '../../web/utils/serialization.js';
import { SeedWidget } from '../../web/components/SeedWidget.js';
import { DimensionWidget } from '../../web/components/DimensionWidget.js';

/**
 * Frontend 1.5x writes `widgets_values_named` in the same call as
 * `widgets_values`, so the two are consistent by construction; our
 * `widgets_values_by_name` (v0.5.2, for frontends that restore by index
 * only) can go stale under 1.53 (2026-09-26: an image carried height 1216
 * in our block while every other record said 2100, and our restore won).
 *
 * Contract under test:
 *  - restore: `widgets_values_named` outranks `widgets_values_by_name`;
 *    ours is used only when the frontend's block is absent (old files, old
 *    frontends); values are cloned, never assigned by reference
 *  - serialize: when the frontend has written `widgets_values_named`, we do
 *    not add `widgets_values_by_name`; otherwise we do, as before
 */

const services = { prompt: vi.fn() };

/** Minimal LiteGraph-like node type. `frontendWritesNamed` simulates a 1.5x frontend. */
function makeNodeType({ frontendWritesNamed }) {
    class FakeNode {
        constructor() {
            this.properties = {};
            this.widgets = [
                new DimensionWidget('dimension_height', 1024, true, { services }),
                new SeedWidget('fill_seed', -1, { services }),
            ];
        }
        serialize() {
            const values = this.widgets.map(w => w.value);
            const data = { widgets_values: values };
            if (frontendWritesNamed) data.widgets_values_named = Object.fromEntries(this.widgets.map(w => [w.name, w.value]));
            return data;
        }
        configure(info) {
            if (info.properties) Object.assign(this.properties, info.properties);
            // positional restore, as LGraphNode does
            (info.widgets_values || []).forEach((v, i) => { if (this.widgets[i]) this.widgets[i].value = v; });
        }
        setDirtyCanvas() {}
    }
    applyDazzleSerialization(FakeNode, {});
    return FakeNode;
}

const H = (value, on = true) => ({ on, value });

describe('serialize: by-name block only when the frontend has none', () => {
    it('does not add widgets_values_by_name when widgets_values_named is present (1.5x frontend)', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        n.widgets[0].value = H(2100);
        const s = n.serialize();
        expect(s.widgets_values_named.dimension_height).toEqual(H(2100));
        expect(s).not.toHaveProperty('widgets_values_by_name');
    });

    it('adds widgets_values_by_name when the frontend writes no named block (older frontend)', () => {
        const T = makeNodeType({ frontendWritesNamed: false });
        const n = new T();
        n.widgets[0].value = H(2100);
        const s = n.serialize();
        expect(s.widgets_values_by_name.dimension_height).toEqual(H(2100));
        expect(s.widgets_values_by_name.fill_seed).toEqual({ on: true, value: -1 });
    });
});

describe('serialize: beforeSerialize hook', () => {
    it('runs before the frontend serialize, so a carrier widget synced there is what gets saved', () => {
        const order = [];
        class FakeNode {
            constructor() { this.widgets = [{ name: 'scale', value: 1 }]; this.properties = {}; }
            serialize() { order.push('frontend'); return { widgets_values: this.widgets.map(w => w.value) }; }
            configure() {}
        }
        applyDazzleSerialization(FakeNode, { beforeSerialize: (node) => { order.push('before'); node.widgets[0].value = 1.5; } });
        const s = new FakeNode().serialize();
        expect(order).toEqual(['before', 'frontend']);
        expect(s.widgets_values).toEqual([1.5]);
    });
});

describe('configure: precedence and cloning', () => {
    it('the frontend named block outranks a disagreeing (stale) by-name block', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        n.configure({
            widgets_values: [H(2100), { on: true, value: -1 }],
            widgets_values_named: { dimension_height: H(2100), fill_seed: { on: true, value: -1 } },
            widgets_values_by_name: { dimension_height: H(1216), fill_seed: { on: true, value: 333670668065774 } },
        });
        expect(n.widgets[0].value).toEqual(H(2100));
        expect(n.widgets[1].value).toEqual({ on: true, value: -1 });
        expect(n.widgets[1].randomizeMode).toBe(true);           // random mode kept
    });

    it('falls back to our by-name block when the named block is absent (old file / old frontend)', () => {
        const T = makeNodeType({ frontendWritesNamed: false });
        const n = new T();
        n.configure({
            widgets_values: [H(999), { on: true, value: -1 }],   // index block may be misaligned on old frontends
            widgets_values_by_name: { dimension_height: H(1216), fill_seed: { on: true, value: 42 } },
        });
        expect(n.widgets[0].value).toEqual(H(1216));
        expect(n.widgets[1].value).toEqual({ on: true, value: 42 });
        expect(n.widgets[1].randomizeMode).toBe(false);          // fixed seed clears random mode
    });

    it('restores by clone: the widget never holds the info object itself', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        const named = { dimension_height: H(2100), fill_seed: { on: true, value: -1 } };
        n.configure({ widgets_values: [H(2100), { on: true, value: -1 }], widgets_values_named: named });
        expect(n.widgets[0].value).toEqual(H(2100));
        expect(n.widgets[0].value).not.toBe(named.dimension_height);
        n.widgets[0].value.value = 512;
        expect(named.dimension_height.value).toBe(2100);
    });

    it('a fixed seed restored from the named block clears random mode', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        n.configure({ widgets_values: [H(1024), { on: true, value: 7 }], widgets_values_named: { dimension_height: H(1024), fill_seed: { on: true, value: 7 } } });
        expect(n.widgets[1].value.value).toBe(7);
        expect(n.widgets[1].randomizeMode).toBe(false);
    });

    it('drops the loaded by-name and widgets_config copies a 1.5x frontend leaves on the node (no stale echo)', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        // Simulate the frontend preserving the file's unknown keys as own properties before configure
        const info = { widgets_values: [H(2100), { on: true, value: -1 }], widgets_values_named: { dimension_height: H(2100), fill_seed: { on: true, value: -1 } },
            widgets_values_by_name: { dimension_height: H(1216), fill_seed: { on: true, value: 5 } }, widgets_config: { scale: { leftStep: 0.2, rightStep: 0.4 } } };
        n.widgets_values_by_name = info.widgets_values_by_name;
        n.widgets_config = info.widgets_config;
        n.configure(info);
        expect(n.widgets[0].value).toEqual(H(2100));
        expect(Object.prototype.hasOwnProperty.call(n, 'widgets_values_by_name')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(n, 'widgets_config')).toBe(false);
        // and the loaded data itself no longer carries our blocks for the frontend to stash
        expect(info).not.toHaveProperty('widgets_values_by_name');
        expect(info).not.toHaveProperty('widgets_config');
        expect(info.widgets_values_named).toBeDefined();               // the frontend's block is left alone
    });

    it('strips our blocks from info.extensions too, and removes an emptied extensions object', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        const info = { widgets_values: [H(1024), { on: true, value: -1 }], widgets_values_named: { dimension_height: H(1024), fill_seed: { on: true, value: -1 } },
            extensions: { widgets_values_by_name: { dimension_height: H(1216) }, widgets_config: { scale: {} } } };
        n.configure(info);
        expect(info).not.toHaveProperty('extensions');
        const info2 = { widgets_values: [H(1024), { on: true, value: -1 }], extensions: { widgets_values_by_name: {}, someone_elses: 1 } };
        n.configure(info2);
        expect(info2.extensions).toEqual({ someone_elses: 1 });
    });

    it('the node-specific onConfigure hook still sees the pre-v0.12.5 widgets_config block', () => {
        let seen = null;
        class FakeNode { constructor() { this.widgets = []; this.properties = {}; } configure() {} serialize() { return {}; } }
        applyDazzleSerialization(FakeNode, { onConfigure: (info) => { seen = info.widgets_config; } });
        new FakeNode().configure({ widgets_config: { scale: { leftStep: 0.2, rightStep: 0.4 } } });
        expect(seen).toEqual({ scale: { leftStep: 0.2, rightStep: 0.4 } });
    });

    it('ignores names the node does not have and leaves other widgets alone', () => {
        const T = makeNodeType({ frontendWritesNamed: true });
        const n = new T();
        n.configure({ widgets_values: [H(1024), { on: true, value: -1 }], widgets_values_named: { nonexistent: 1, fill_seed: { on: true, value: -1 } } });
        expect(n.widgets[0].value).toEqual(H(1024));
    });
});
