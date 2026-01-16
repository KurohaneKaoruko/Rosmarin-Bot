import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src'),
        },
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts']
    }
});

