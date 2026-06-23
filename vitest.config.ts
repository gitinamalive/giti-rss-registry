import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['scripts/**/*.ts'],
            exclude: ['scripts/add-feeds-batch.ts', 'scripts/enrich-categories.ts'],
        },
    },
});