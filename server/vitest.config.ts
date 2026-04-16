import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    // src/managed/*.test.ts use a custom runner (not vitest describe/it) — excluded.
    // CLI hardening adds vitest tests under src/cli/ only.
    include: ['test/**/*.test.ts', 'src/cli/**/*.test.ts'],
  },
});
