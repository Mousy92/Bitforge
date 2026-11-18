# BitForge

A **BitCraft build & crafting planner**. Add the buildings and items you want,
and BitForge expands every recipe down to raw materials, totals everything up,
and **divides the whole list by the profession** that makes or gathers each thing —
so each crafter knows exactly what to produce. Then share the entire plan with a
single link.

No accounts, no backend. A build lives entirely inside its share link, so the
whole thing is a static site you can host anywhere (your own domain, Cloudflare
Pages, Netlify, Vercel, GitHub Pages…).

## Why

Most BitCraft tools sort a crafting list *by item*, page by page — you end up
hunting through sub-lists to figure out what a Carpenter actually needs to make.
BitForge compiles **one consolidated shopping list and groups it by skill**:

```
Forestry    240  Rough Wood Log
Foraging    200  Rough Plant Fiber     @ Foraging Station
              2  Rough Plant Roots
Carpentry    80  Rough Plank           @ Carpentry Station
             80  Rough Stripped Wood   @ Carpentry Station
              4  Rough Timber          @ Carpentry Station
Tailoring     5  Rough Spool Of Thread @ Tailoring Station
```

## Features

- **Search & add** any of ~875 constructable buildings or ~9,000 items.
- **Recursive material rollup** — expands intermediate crafts down to gatherables.
- **Grouped by profession**, gathering skills first, with per-skill progress bars.
- **Crafting-station hints** (`@ Carpentry Station`) so you know where to make each item.
- **Multiple recipes?** Pick which one to use per item; the plan recomputes live.
- **Progress tracking** — check things off as you gather; saved per build on your device.
- **Shareable link** — the full build is compressed into the URL. Also exports a short code.
- **Copy as text** for pasting into Discord.

## Data

Game data comes from the community
[BitCraft_GameData](https://github.com/BitCraftToolBox/BitCraft_GameData)
project (`cereal/cs` branch), preprocessed into a slim snapshot the browser can
load (~2.2 MB, ~350 KB gzipped). The preprocessor:

- merges the item and cargo namespaces and self-heals cross-namespace references;
- strips reciprocal **pack/unpack recipes** (e.g. logs ⇄ log package) that would
  otherwise create infinite cycles and double-counted totals, rewriting all
  material references into base gather units;
- tags each raw material with a best-effort gathering profession.

### Refreshing the data

```bash
# Clone the game data (cereal/cs branch) somewhere, then:
GAMEDATA_DIR=/path/to/BitCraft_GameData/static npm run data
```

This regenerates `public/data/gamedata.json`. Commit the result to ship an update.

> Not affiliated with Clockwork Labs. The game devs have noted that publicly
> queryable data access may change over time, which is why BitForge ships a
> static snapshot rather than depending on a live API at runtime.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/ (static, deploy anywhere)
npm run preview
```

## Deploy

It's a static site with hash-based state, so no SPA rewrite rules are needed.
Point any static host at `dist/`. For a custom domain, build and upload `dist/`,
or connect the repo to Cloudflare Pages / Netlify / Vercel with:

- **Build command:** `npm run build`
- **Output directory:** `dist`

## Roadmap

- **Upgrade Planner tab** — pick a target tier/level, drop in the stations you
  want, and front-load the **research books** needed first, then roll up the
  station build materials (same by-profession view).
- Optional live inventory via the [Bitjita API](https://bitjita.com/docs/api) to
  subtract what you already have.
- Optional short links (needs a tiny backend) on top of the link-encoded builds.

## License

MIT — see [LICENSE](LICENSE).
