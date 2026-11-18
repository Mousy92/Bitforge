import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static SPA. `base: "./"` keeps asset paths relative so it works when served
// from a domain root, a subpath, or a static host without extra config.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
