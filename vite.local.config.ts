import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds a single self-contained index.html (JS, CSS and game data all inlined)
// into dist-local/. Open that file directly in a browser — fully offline.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist-local",
    assetsInlineLimit: 100_000_000, // inline everything
    rollupOptions: { input: "index.local.html" },
  },
});
