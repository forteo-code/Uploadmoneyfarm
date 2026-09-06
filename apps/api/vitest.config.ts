import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database-backed tests share one dev database, so they must not race.
    fileParallelism: false,
    testTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    // Runs before the test module is imported, which is what makes the
    // import-time environment validation in src/env.ts survivable.
    setupFiles: ["./src/test-setup.ts"],
  },
});
