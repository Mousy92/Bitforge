// Gear taxonomy and upgrade-target resolution for the Gear Tracker.
//
// BitCraft gear comes as discrete items per (tier, rarity): e.g. a forester's
// axe runs Flint Axe (T1) -> ... -> Astralite Axe (T10), each in several
// rarities (Common..Mythic). We group every tier/rarity variant into a "piece"
// (the axe slot) so the tracker can target a specific tier AND rarity and
// resolve it to the craftable item whose recipe we roll up.

import type { GameData, ItemKey, ItemRaw } from "./data";
import { resolveKey, skillName } from "./data";

export type GearCategory =
  | "tool"
  | "weapon"
  | "armor"
  | "charm"
  | "instrument"
  | "trinket"
  | "cosmetic";

/** The three tracker subtabs and which categories each contains. */
export type GearSubtab = "gear" | "trinkets" | "armor";
export const SUBTABS: { id: GearSubtab; label: string; cats: GearCategory[] }[] = [
  { id: "gear", label: "Gear", cats: ["tool", "weapon"] },
  { id: "trinkets", label: "Trinkets", cats: ["trinket", "charm", "instrument"] },
  { id: "armor", label: "Armor", cats: ["armor"] },
];
export function subtabOfCategory(cat: GearCategory): GearSubtab | null {
  for (const s of SUBTABS) if (s.cats.includes(cat)) return s.id;
  return null;
}

// Rarity ordering, weakest to strongest. Top rarity = last.
export const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
export function rarityRank(r: string): number {
  const i = RARITIES.indexOf(r);
  return i === -1 ? 0 : i;
}

/** Classify a tag into a gear category, or null if it isn't equippable gear. */
export function categoryOf(tag: string): GearCategory | null {
  if (!tag) return null;
  if (/(^| )Tool$/.test(tag)) return "tool";
  if (tag === "Weapon") return "weapon";
  // Body armor comes as metal armor and leather/cloth clothing (all have armor stats).
  if (tag === "Metal Armor" || tag === "Dungeon Equipment" || /(Leather|Cloth) Clothing$/.test(tag))
    return "armor";
  if (/Charm$/.test(tag)) return "charm";
  if (/Instrument$/.test(tag)) return "instrument";
  // Artifact slots: trinkets, jewelry (rings/amulets) and automata hearts.
  if (tag === "Trinket" || tag === "Jewelry" || /Heart$/.test(tag)) return "trinket";
  if (/Cosmetic/.test(tag)) return "cosmetic";
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

export interface GearPiece {
  pieceKey: string; // tag|suffix
  tag: string;
  suffix: string; // the shared piece name, e.g. "Axe", "Plated Boots"
  category: GearCategory;
  items: GearItem[]; // every tier/rarity variant, sorted by tier then rarity
}

export interface GearIndex {
  pieces: Map<string, GearPiece>;
  pieceOfItem: Map<ItemKey, string>;
  byCategory: Map<GearCategory, GearPiece[]>;
}

/** The shared piece name: drop the leading material word (Flint, Umbracite…). */
function suffixOf(name: string): string {
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export function buildGearIndex(data: GameData): GearIndex {
  const pieces = new Map<string, GearPiece>();
  const pieceOfItem = new Map<ItemKey, string>();

  for (const [key, it] of Object.entries(data.items) as [ItemKey, ItemRaw][]) {
    const cat = categoryOf(it.tag);
    if (!cat || (it.t ?? -1) < 1) continue;
    const suffix = suffixOf(it.n);
    const pk = `${it.tag}|${suffix}`;
    let piece = pieces.get(pk);
    if (!piece) {
      piece = { pieceKey: pk, tag: it.tag, suffix, category: cat, items: [] };
      pieces.set(pk, piece);
    }
    const craftable = !!(data.recipes[key] && data.recipes[key].length);
    piece.items.push({ key, name: it.n, tier: it.t, rarity: it.r || "Common", tag: it.tag, craftable });
    pieceOfItem.set(key, pk);
  }

  for (const piece of pieces.values()) {
    piece.items.sort(
      (a, b) =>
        a.tier - b.tier ||
        rarityRank(a.rarity) - rarityRank(b.rarity) ||
        Number(b.craftable) - Number(a.craftable)
    );
  }

  const byCategory = new Map<GearCategory, GearPiece[]>();
  for (const piece of pieces.values()) {
    if (!byCategory.has(piece.category)) byCategory.set(piece.category, []);
    byCategory.get(piece.category)!.push(piece);
  }
  for (const arr of byCategory.values()) {
    arr.sort((a, b) => a.tag.localeCompare(b.tag) || a.suffix.localeCompare(b.suffix));
  }

  return { pieces, pieceOfItem, byCategory };
}

/** Resolve the gear piece for an item key (handles item/cargo namespace). */
export function pieceForItem(data: GameData, index: GearIndex, key: ItemKey): GearPiece | null {
  const pk = index.pieceOfItem.get(key) ?? index.pieceOfItem.get(resolveKey(data, key));
  return pk ? index.pieces.get(pk) ?? null : null;
}

/** All tiers present in a piece (any rarity). */
export function tiersOf(piece: GearPiece): number[] {
  return [...new Set(piece.items.map((i) => i.tier))].sort((a, b) => a - b);
}

/** Tiers that have at least one craftable variant. */
export function craftableTiers(piece: GearPiece): number[] {
  return [...new Set(piece.items.filter((i) => i.craftable).map((i) => i.tier))].sort((a, b) => a - b);
}

/** Rarities available at a tier, strongest last. `craftableOnly` restricts to craftable variants. */
export function raritiesAtTier(piece: GearPiece, tier: number, craftableOnly = false): string[] {
  const rs = piece.items
    .filter((i) => i.tier === tier && (!craftableOnly || i.craftable))
    .map((i) => i.rarity);
  return [...new Set(rs)].sort((a, b) => rarityRank(a) - rarityRank(b));
}

/** The strongest craftable rarity at a tier (falls back to any rarity present). */
export function topRarityAtTier(piece: GearPiece, tier: number): string {
  const craft = raritiesAtTier(piece, tier, true);
  if (craft.length) return craft[craft.length - 1];
  const any = raritiesAtTier(piece, tier, false);
  return any.length ? any[any.length - 1] : "Common";
}

/** The highest craftable tier for a piece. */
export function maxCraftableTier(piece: GearPiece): number {
  const ts = craftableTiers(piece);
  return ts.length ? ts[ts.length - 1] : tiersOf(piece)[0] ?? 1;
}

/**
 * The craftable item at (tier, rarity). Falls back to a lower rarity at the same
 * tier, then to the nearest craftable at a higher tier, then any variant there.
 */
export function resolve(piece: GearPiece, tier: number, rarity: string): GearItem | null {
  const atTier = piece.items.filter((i) => i.tier === tier);
  const exact = atTier.find((i) => i.rarity === rarity && i.craftable);
  if (exact) return exact;
  // nearest craftable rarity at this tier, at or below the requested rarity, else any craftable
  const wanted = rarityRank(rarity);
  const downCraft = atTier
    .filter((i) => i.craftable && rarityRank(i.rarity) <= wanted)
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  if (downCraft[0]) return downCraft[0];
  const anyCraft = atTier.filter((i) => i.craftable).sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  if (anyCraft[0]) return anyCraft[0];
  // climb tiers
  const up = piece.items.filter((i) => i.tier > tier && i.craftable).sort((a, b) => a.tier - b.tier);
  return up[0] ?? atTier[0] ?? null;
}

/**
 * Each tool you'd craft climbing from `curTier` (exclusive) to `tgtTier`
 * (inclusive), at the target rarity (with resolve()'s fallbacks).
 */
export function stepsBetween(
  piece: GearPiece,
  curTier: number,
  tgtTier: number,
  tgtRarity: string
): GearItem[] {
  const out: GearItem[] = [];
  for (let t = curTier + 1; t <= tgtTier; t++) {
    const item = resolve(piece, t, tgtRarity);
    if (item) out.push(item);
  }
  return out;
}

/** Is (tgtT,tgtR) actually an upgrade over (curT,curR)? */
export function isUpgrade(curT: number, curR: string, tgtT: number, tgtR: string): boolean {
  return tgtT > curT || (tgtT === curT && rarityRank(tgtR) > rarityRank(curR));
}

/** The profession skill that crafts this piece (from its recipes), e.g. "Carpentry". */
export function professionOf(data: GameData, piece: GearPiece): string {
  for (const i of piece.items) {
    const recs = data.recipes[i.key];
    if (recs && recs.length) {
      const sk = skillName(data, recs[0].sk);
      if (sk) return sk;
    }
  }
  return "";
}

/** Minimum craft level required for each craftable tier of a piece. */
export function tierLevels(data: GameData, piece: GearPiece): Map<number, number> {
  const out = new Map<number, number>();
  for (const i of piece.items) {
    if (!i.craftable) continue;
    const recs = data.recipes[i.key];
    if (!recs || !recs.length) continue;
    const lv = recs[0].lv ?? 0;
    const prev = out.get(i.tier);
    if (prev === undefined || lv < prev) out.set(i.tier, lv);
  }
  return out;
}

/**
 * The tier a player of `level` should be using for this piece: the highest
 * craftable tier whose required level they've reached. Falls back to the lowest
 * craftable tier if they haven't reached any.
 */
export function recommendedTier(data: GameData, piece: GearPiece, level: number): number {
  const levels = tierLevels(data, piece);
  const tiers = [...levels.keys()].sort((a, b) => a - b);
  let rec = tiers[0] ?? 1;
  for (const t of tiers) if ((levels.get(t) ?? 0) <= level) rec = t;
  return rec;
}
