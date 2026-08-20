import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: ".",
  plugins: [react()],
  resolve: {
    dedupe: ["three"],
    alias: {
      "@genetic-assembly/visualizations": path.resolve(import.meta.dirname, "../visualizations/src/index.ts"),
    },
  },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
  },
  server: {
    port: 3333,
    open: true,
    fs: {
      allow: [".."],
    },
  },
});
