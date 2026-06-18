import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@splash/utils": resolve(__dirname, "packages/utils/src/index.ts"),
      "@splash/config": resolve(__dirname, "packages/config/src/index.ts"),
      "@splash/safety": resolve(__dirname, "packages/safety/src/index.ts"),
      "@splash/memory": resolve(__dirname, "packages/memory/src/index.ts"),
      "@splash/providers": resolve(__dirname, "packages/providers/src/index.ts"),
      "@splash/connectors": resolve(__dirname, "packages/connectors/src/index.ts"),
      "@splash/skills": resolve(__dirname, "packages/skills/src/index.ts"),
      "@splash/tools": resolve(__dirname, "packages/tools/src/index.ts"),
      "@splash/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@splash/gateway": resolve(__dirname, "packages/gateway/src/index.ts"),
      "@splash/plugins": resolve(__dirname, "packages/plugins/src/index.ts"),
      "@splash/mcp": resolve(__dirname, "packages/mcp/src/index.ts"),
      "@splash/migrate": resolve(__dirname, "packages/migrate/src/index.ts"),
    },
  },
});
