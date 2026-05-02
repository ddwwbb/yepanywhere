import { tmpdir } from "node:os";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const nodeMajor = Number.parseInt(
  process.versions.node.split(".")[0] ?? "0",
  10,
);
const localStoragePath = join(tmpdir(), "yep-anywhere-vitest-localstorage");
const localStorageExecArgv =
  nodeMajor >= 22 ? [`--localstorage-file=${localStoragePath}`] : [];

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ["source"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    exclude: ["e2e/**", "node_modules/**"],
    passWithNoTests: true,
    maxWorkers: 3,
    minWorkers: 1,
    poolOptions: {
      threads: {
        execArgv: localStorageExecArgv,
      },
      forks: {
        execArgv: localStorageExecArgv,
      },
    },
  },
});
