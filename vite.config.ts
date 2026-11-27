import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const MOCK_TARGET = process.env.MOCK_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: MOCK_TARGET, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: MOCK_TARGET, changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: false },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    css: false,
    restoreMocks: true,
    include: ["tests/**/*.spec.{ts,tsx}"],
  },
});

