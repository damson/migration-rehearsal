import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // `tools/` is included so the readability check's formulas are pinned. The
    // repo's other tool, check-placeholders, is exercised by CI running it
    // rather than by a test; the difference is that this one does arithmetic,
    // and a wrong coefficient is silent.
    include: ['reference/**/*.test.ts', 'tools/**/*.test.mjs'],
  },
});
