// Gear taxonomy and upgrade-target resolution for the Gear Tracker.
//
// BitCraft gear comes as discrete items per (tier, rarity): e.g. a forester's
// axe line runs Flint Axe (T1) -> Pyrelite Axe (T2) -> ... -> Astralite Axe
// (T10), each in several rarities. We group items into "lines" (the same piece
// across tiers, at one rarity) so we can offer "upgrade this to tier N" and
// resolve it to the craftable item whose recipe we roll up.

import type { GameData, ItemKey, ItemRaw } from "./data";
import { resolveKey } from "./data";

export type GearCategory =
  | "tool"
  | "weapon"
  | "armor"
  | "charm"
  | "instrument"
  | "trinket"
  | "cosmetic";

export interface GearCatInfo {
  id: GearCategory;
  label: string;
  order: number;
}

const CATS: GearCatInfo[] = [
  { id: "tool", label: "Tools", order: 0 },
  { id: "weapon", label: "Weapons", order: 1 },
  { id: "armor", label: "Armor", order: 2 },
  { id: "charm", label: "Charms", order: 3 },
  { id: "instrument", label: "Instruments", order: 4 },
  { id: "trinket", label: "Trinkets", order: 5 },
  { id: "cosmetic", label: "Cosmetic", order: 6 },
];
const CAT_BY_ID = new Map(CATS.map((c) => [c.id, c]));

/** Classify a tag into a gear category, or null if it isn't equippable gear. */
export function categoryOf(tag: string): GearCatInfo | null {
  if (!tag) return null;
  if (/(^| )Tool$/.test(tag)) return CAT_BY_ID.get("tool")!;
  if (tag === "Weapon") return CAT_BY_ID.get("weapon")!;
  if (tag === "Metal Armor" || tag === "Dungeon Equipment") return CAT_BY_ID.get("armor")!;
  if (/Charm$/.test(tag)) return CAT_BY_ID.get("charm")!;
  if (/Instrument$/.test(tag)) return CAT_BY_ID.get("instrument")!;
  if (tag === "Trinket") return CAT_BY_ID.get("trinket")!;
  if (/Cosmetic/.test(tag)) return CAT_BY_ID.get("cosmetic")!;
  return null;
}

export interface GearItem {
  key: ItemKey;
  name: string;
  tier: number;
  rarity: string;
  tag: string;
  craftable: boolean;
}

export interface GearLine {
  lineKey: string;
  tag: string;
  rarity: string;
  suffix: string; // the shared piece name, e.g. "Axe", "Plated Boots"
  category: GearCategory;
  items: GearItem[]; // sorted by tier
}

export interface GearIndex {
  lines: Map<string, GearLine>;
  lineOfItem: Map<ItemKey, string>; // itemKey -> lineKey
  byCategory: Map<GearCategory, GearLine[]>;
}

/** The shared piece name: drop the leading material word (Flint, Umbracite…). */
function suffixOf(name: string): string {
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

function lineKeyOf(tag: string, rarity: string, suffix: string): string {
  return `${tag}|${rarity}|${suffix}`;
}

export function buildGearIndex(data: GameData): GearIndex {
  const lines = new Map<string, GearLine>();
  const lineOfItem = new Map<ItemKey, string>();

  for (const [key, it] of Object.entries(data.items) as [ItemKey, ItemRaw][]) {
    const cat = categoryOf(it.tag);
    if (!cat || (it.t ?? -1) < 1) continue;
    const suffix = suffixOf(it.n);
    const rarity = it.r || "Common";
    const lk = lineKeyOf(it.tag, rarity, suffix);
    let line = lines.get(lk);
    if (!line) {
      line = { lineKey: lk, tag: it.tag, rarity, suffix, category: cat.id, items: [] };
      lines.set(lk, line);
    }
    const craftable = !!(data.recipes[key] && data.recipes[key].length);
    line.items.push({ key, name: it.n, tier: it.t, rarity, tag: it.tag, craftable });
    lineOfItem.set(key, lk);
  }

  // Sort each line by tier (craftable first within a tier so twins resolve well).
  for (const line of lines.values()) {
    line.items.sort((a, b) => a.tier - b.tier || Number(b.craftable) - Number(a.craftable));
  }

  const byCategory = new Map<GearCategory, GearLine[]>();
  for (const line of lines.values()) {
    if (!byCategory.has(line.category)) byCategory.set(line.category, []);
    byCategory.get(line.category)!.push(line);
  }
  for (const arr of byCategory.values()) {
    arr.sort((a, b) => a.tag.localeCompare(b.tag) || a.suffix.localeCompare(b.suffix) || a.rarity.localeCompare(b.rarity));
  }

  return { lines, lineOfItem, byCategory };
}

export function categoriesInOrder(): GearCatInfo[] {
  return [...CATS].sort((a, b) => a.order - b.order);
}

/** Resolve the gear line for an item key (handles item/cargo namespace). */
export function lineForItem(data: GameData, index: GearIndex, key: ItemKey): GearLine | null {
  const lk = index.lineOfItem.get(key) ?? index.lineOfItem.get(resolveKey(data, key));
  return lk ? index.lines.get(lk) ?? null : null;
}

/**
 * The craftable item in `line` at the given tier (prefers a craftable twin). If
 * no craftable exists at that exact tier, returns the nearest craftable at a
 * higher tier, else null.
 */
export function resolveTarget(line: GearLine, tier: number): GearItem | null {
  const atTier = line.items.filter((i) => i.tier === tier);
  const craft = atTier.find((i) => i.craftable);
  if (craft) return craft;
  // nearest craftable at or above the requested tier
  const up = line.items.filter((i) => i.tier >= tier && i.craftable).sort((a, b) => a.tier - b.tier);
  return up[0] ?? atTier[0] ?? null;
}

/** Tiers available in a line that you can craft (for the target dropdown). */
export function craftableTiers(line: GearLine): number[] {
  return [...new Set(line.items.filter((i) => i.craftable).map((i) => i.tier))].sort((a, b) => a - b);
}
