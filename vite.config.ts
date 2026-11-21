import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Content-hash of the game-data snapshot, injected at build time. The data file
// is served under a stable name (`data/gamedata.json`) with a long cache, so the
// loader appends `?v=<hash>` — when the data content changes the URL changes and
// any stale cached copy (e.g. one from before a new field like `foods` existed)
// is bypassed. Unchanged data keeps the same URL, so it still caches hard.
function dataVersion(): string {
  try {
    const raw = readFileSync("public/data/gamedata.json", "utf8");
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  } catch {
    return "0";
  }
}

// Static SPA. `base: "./"` keeps asset paths relative so it works when served
// from a domain root, a subpath, or a static host without extra config.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __DATA_VERSION__: JSON.stringify(dataVersion()),
  },
});
