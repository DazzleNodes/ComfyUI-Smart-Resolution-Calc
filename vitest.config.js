import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        setupFiles: ['./tests/unit/setup.js'],
        include: ['tests/unit/**/*.test.js'],
    },
});
