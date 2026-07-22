import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single-file build: all JS/CSS/fonts inline into index.html.
// Reason: Chrome CORS-blocks external ES module scripts under file://, so a
// multi-file build opens blank when double-clicked; the inlined page opens
// offline via file:// directly.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", target: "es2022", assetsInlineLimit: 100_000_000 },
  plugins: [viteSingleFile()],
});
