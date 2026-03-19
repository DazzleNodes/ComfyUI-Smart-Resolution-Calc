/**
 * Vitest setup — mock ComfyUI globals that widgets reference.
 *
 * Widgets access `app` global via the services pattern (this.services.prompt),
 * so most tests don't need the app mock. But some framework-level code
 * (like the default services fallback) references `app` at import time.
 */

// Mock browser globals that debug_logger.js accesses at module load time
globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
};

globalThis.window = {
    location: { search: '' },
    devicePixelRatio: 1,
    open: () => {},
};

// Mock the ComfyUI `app` global
globalThis.app = {
    canvas: {
        prompt: () => {},
        setDirty: () => {},
    },
    graph: {
        _nodes: [],
        links: {},
        getNodeById: () => null,
    },
};

// Mock LiteGraph globals
globalThis.LiteGraph = {
    INPUT: 1,
    OUTPUT: 2,
    NODE_WIDGET_HEIGHT: 20,
};
