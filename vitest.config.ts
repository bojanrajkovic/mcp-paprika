import { configDefaults, defineConfig } from "vitest/config";

// The suite is split into four projects by file-suffix tier (ADR-0013). A plain
// `pnpm test` runs all four and stays the single gate; the tier is visible in the
// run output and a `--project <name>` filter runs one tier. The `unit` project owns
// both pure-unit and the harness-driven module-integration tests (both `*.test.ts`),
// plus property tests; it must exclude the e2e/external files, which also end in
// `.test.ts`. Integration (`*.test.integration.ts`) is naturally excluded — it does
// not end in `.test.ts`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/*.e2e.test.ts", "**/*.external.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["src/**/*.test.integration.ts", "test/**/*.test.integration.ts"],
        },
      },
      {
        test: {
          name: "e2e",
          include: ["src/**/*.e2e.test.ts"],
        },
      },
      {
        test: {
          name: "external",
          include: ["src/**/*.external.test.ts"],
        },
      },
    ],
  },
});
