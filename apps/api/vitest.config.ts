import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database-backed tests share one dev database, so they must not race.
    fileParallelism: false,
    testTimeout: 30_000,
    include: ["src/**/*.test.ts"],
  },
});
