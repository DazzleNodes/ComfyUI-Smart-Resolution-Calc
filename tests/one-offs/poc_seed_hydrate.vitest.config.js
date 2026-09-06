// One-off vitest config for the seed-hydration PoC. Reuses the unit-test
// globals setup; scopes `include` to the single PoC file so it never runs
// as part of `npm run test:unit`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        setupFiles: ['./tests/unit/setup.js'],
        include: ['tests/one-offs/poc_seed_hydrate_on_configure.test.js'],
    },
});
