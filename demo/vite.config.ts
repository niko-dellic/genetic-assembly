import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  resolve: {
    dedupe: ["three"],
  },
  build: {
    outDir: "./dist",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
    fs: {
      allow: [".."],
    },
  },
});
