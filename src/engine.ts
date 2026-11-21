// Planning engine: expand a build into every material it needs, aggregated and
// grouped by profession. This is the core value of BitForge — one consolidated
// list, divided by the skill that produces each thing, not per-item sub-lists.

import {
  type GameData,
  type ItemKey,
  professionFor,
  recipesFor,
  resolveKey,
  skillName,
} from "./data";
import type { Build } from "./model";

export interface PlanLine {
  key: ItemKey;
  name: string;
  qty: number; // total quantity needed
  tier: number;
  rarity: string;
  profession: string;
  craftable: boolean;
  /** building type where it's crafted (craftables only), for the "craft at" hint */
  craftAt?: string;
  level?: number; // skill level required (craftables)
}

export interface BuildLine {
  id: number;
  name: string;
  qty: number;
  profession: string;
  level: number;
}

export interface ProfessionGroup {
  profession: string;
  lines: PlanLine[];
  /** distinct materials in this bucket */
  count: number;
}

export interface Plan {
  /** construction lines for the target buildings themselves */
  builds: BuildLine[];
  /** every material, aggregated by key */
  lines: PlanLine[];
  /** materials grouped by the profession that produces them */
  byProfession: ProfessionGroup[];
  /** only the raw/gathered leaves (nothing crafts them) */
  raw: PlanLine[];
  warnings: string[];
}

const MAX_DEPTH = 60;

// Preferred display order of professions (gathering first, then refiners).
const PROF_ORDER = [
  "Forestry",
  "Mining",
  "Foraging",
  "Hunting",
  "Fishing",
  "Farming",
  "Hexite Gathering",
  "Carpentry",
  "Masonry",
  "Smithing",
  "Leatherworking",
  "Tailoring",
  "Scholar",
  "Cooking",
  "Merchanting",
  "Taming",
  "Slayer",
  "Sailing",
  "Construction",
];

/**
 * Expand `build` into a full plan.
 * @param chosen optional map of itemKey -> recipe index, when an item has
 *               multiple recipes and the user picked a non-default one.
 */
export function planBuild(
  data: GameData,
  build: Build,
  chosen: Record<ItemKey, number> = {}
): Plan {
  const totals = new Map<ItemKey, number>();
  const warnings: string[] = [];
  const buildings = new Map<number, number>(); // building id -> qty

  // Walk a required item, accumulating totals and recursing into its recipe.
  // `path` guards against any residual cycles (packaging is already stripped
  // upstream, but defensive cycle handling keeps the UI from ever hanging).
  function walk(key: ItemKey, qty: number, depth: number, path: Set<ItemKey>) {
    const rk = resolveKey(data, key);
    totals.set(rk, (totals.get(rk) || 0) + qty);

    const recs = recipesFor(data, rk);
    if (!recs.length) return; // raw / gathered leaf
    if (depth >= MAX_DEPTH || path.has(rk)) {
      if (path.has(rk)) warnings.push(`Recipe cycle at ${data.items[rk]?.n ?? rk}`);
      return;
    }
    const idx = Math.min(chosen[rk] ?? 0, recs.length - 1);
    const r = recs[idx];
    const batches = Math.ceil(qty / (r.out || 1));
    const nextPath = new Set(path);
    nextPath.add(rk);
    for (const [k, id, q] of r.mats) {
      walk(`${k}${id}`, q * batches, depth + 1, nextPath);
    }
  }

  for (const t of build.targets) {
    if (t.q <= 0) continue;
    if (t.t === "b") {
      const b = data.buildings.find((x) => x.id === t.id);
      if (!b) {
        warnings.push(`Unknown building id ${t.id}`);
        continue;
      }
      buildings.set(t.id, (buildings.get(t.id) || 0) + t.q);
      for (const [k, id, q] of b.recipe.mats) {
        walk(`${k}${id}`, q * t.q, 0, new Set());
      }
    } else {
      walk(t.k, t.q, 0, new Set());
    }
  }

  // Build output lines.
  const lines: PlanLine[] = [];
  for (const [key, qty] of totals) {
    const it = data.items[key];
    const recs = recipesFor(data, key);
    const craftable = recs.length > 0;
    const idx = Math.min(chosen[key] ?? 0, Math.max(0, recs.length - 1));
    const r = craftable ? recs[idx] : undefined;
    lines.push({
      key,
      name: it?.n ?? key,
      qty,
      tier: it?.t ?? -1,
      rarity: it?.r ?? "",
      profession: professionFor(data, key, chosen),
      craftable,
      craftAt: r ? buildingTypeLabel(data, r.bt) : undefined,
      level: r?.lv,
    });
  }

  lines.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));

  // Group by profession.
  const groupMap = new Map<string, PlanLine[]>();
  for (const l of lines) {
    if (!groupMap.has(l.profession)) groupMap.set(l.profession, []);
    groupMap.get(l.profession)!.push(l);
  }
  const byProfession: ProfessionGroup[] = [...groupMap.entries()]
    .map(([profession, ls]) => ({ profession, lines: ls, count: ls.length }))
    .sort((a, b) => profRank(a.profession) - profRank(b.profession));

  const builds: BuildLine[] = [...buildings.entries()].map(([id, qty]) => {
    const b = data.buildings.find((x) => x.id === id)!;
    return {
      id,
      name: b.n,
      qty,
      profession: skillName(data, b.recipe.sk) || "Construction",
      level: b.recipe.lv,
    };
  });
  builds.sort((a, b) => a.name.localeCompare(b.name));

  const raw = lines.filter((l) => !l.craftable);

  return { builds, lines, byProfession, raw, warnings: dedupe(warnings) };
}

function buildingTypeLabel(data: GameData, bt: number): string | undefined {
  if (!bt) return undefined;
  return data.buildingTypes[String(bt)] || undefined;
}

function profRank(p: string): number {
  const i = PROF_ORDER.indexOf(p);
  return i === -1 ? PROF_ORDER.length + 1 : i;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Expand a single target into a nested tree (for the drill-down detail view).
 */
export interface TreeNode {
  key: ItemKey;
  name: string;
  qty: number;
  tier: number;
  profession: string;
  craftable: boolean;
  children: TreeNode[];
}

export function expandTree(
  data: GameData,
  key: ItemKey,
  qty: number,
  chosen: Record<ItemKey, number> = {},
  depth = 0,
  path: Set<ItemKey> = new Set()
): TreeNode {
  const rk = resolveKey(data, key);
  const it = data.items[rk];
  const recs = recipesFor(data, rk);
  const node: TreeNode = {
    key: rk,
    name: it?.n ?? rk,
    qty,
    tier: it?.t ?? -1,
    profession: professionFor(data, rk, chosen),
    craftable: recs.length > 0,
    children: [],
  };
  if (!recs.length || depth >= MAX_DEPTH || path.has(rk)) return node;
  const idx = Math.min(chosen[rk] ?? 0, recs.length - 1);
  const r = recs[idx];
  const batches = Math.ceil(qty / (r.out || 1));
  const nextPath = new Set(path);
  nextPath.add(rk);
  for (const [k, id, q] of r.mats) {
    node.children.push(expandTree(data, `${k}${id}`, q * batches, chosen, depth + 1, nextPath));
  }
  return node;
}
