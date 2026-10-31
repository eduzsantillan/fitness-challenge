import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['backend/tests/**/*.test.ts', 'web/tests/**/*.test.ts'] } });
