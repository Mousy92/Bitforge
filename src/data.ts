// Data layer: load the slim gamedata snapshot and expose typed lookups.
// The snapshot is produced by scripts/build-data.mjs from the BitCraft_GameData
// community repo (cereal/cs branch). Keys in the file are short to keep it small;
// we expand them into friendly shapes here.

export type Kind = "i" | "c"; // item or cargo
export type MatRef = [Kind, number, number]; // [kind, id, quantity]

export interface ItemRaw {
  n: string; // name
  t: number; // tier (-1 = none)
  tag: string;
  r: string; // rarity
  ic: string; // icon asset name
  gp?: string; // gather profession (only on raw/uncrafted items)
}

export interface RecipeRaw {
  sk: number; // skill id
  lv: number; // level required
  bt: number; // building type id
  bl: number; // building tier
  out: number; // output quantity
  act: number; // actions required
  mats: MatRef[];
}

export interface BuildingRaw {
  id: number;
  n: string;
  desc: string;
  ic: string;
  ft: number; // function type
  recipe: { sk: number; lv: number; act: number; mats: MatRef[] };
}

export interface FoodBuff {
  d: string; // description
  ben: boolean; // beneficial
  dur: number; // duration seconds
  stats: [string, number, boolean][]; // [label, value, isPct]
}

export interface FoodRaw {
  id: number;
  n: string;
  t: number; // tier
  tag: string;
  r: string; // rarity
  ic: string;
  hp: number;
  st: number; // stamina
  hg: number; // hunger
  tp: number; // teleportation energy
  combat: boolean;
  buffs: FoodBuff[];
}

export interface GameData {
  generatedAt: string;
  sourceCommit: string;
  foods?: FoodRaw[];
  skills: Record<string, string>;
  buildingTypes: Record<string, string>;
  items: Record<string, ItemRaw>;
  buildings: BuildingRaw[];
  recipes: Record<string, RecipeRaw[]>;
  /** base/inventory id -> canonical craftable key (for matching pulled storage) */
  aliasMap?: Record<string, string>;
  /** RNG drop rates: itemKey -> sources, each { chance 0-1, qty, source name } */
  drops?: Record<string, { chance: number; qty: number; source: string }[]>;
}

/** A key like "i1010001" or "c150000" identifying an item/cargo across namespaces. */
export type ItemKey = string;
export const keyOf = (kind: Kind, id: number): ItemKey => `${kind}${id}`;

let DATA: GameData | null = null;

export async function loadGameData(): Promise<GameData> {
  if (DATA) return DATA;
  // Single-file / offline build: the generator output is bundled and attached to
  // the window by main.local.tsx, so there's nothing to fetch.
  const bundled = (globalThis as unknown as { __GAMEDATA__?: GameData }).__GAMEDATA__;
  if (bundled) {
    DATA = bundled;
    return DATA;
  }
  // `?v=<content-hash>` busts the day-long CDN/browser cache on the stable
  // gamedata.json filename whenever the data content changes (see vite.config.ts).
  const v = typeof __DATA_VERSION__ === "string" ? __DATA_VERSION__ : "";
  const res = await fetch(`${import.meta.env.BASE_URL}data/gamedata.json${v ? `?v=${v}` : ""}`);
  if (!res.ok) throw new Error(`Failed to load game data (${res.status})`);
  DATA = (await res.json()) as GameData;
  return DATA;
}

export function getData(): GameData {
  if (!DATA) throw new Error("Game data not loaded yet");
  return DATA;
}

/** Resolve a material key across the item/cargo namespaces (self-heals bad refs). */
export function resolveKey(data: GameData, key: ItemKey): ItemKey {
  if (data.items[key]) return key;
  const alt = key[0] === "i" ? "c" + key.slice(1) : "i" + key.slice(1);
  return data.items[alt] ? alt : key;
}

export function itemName(data: GameData, key: ItemKey): string {
  return data.items[resolveKey(data, key)]?.n ?? key;
}

/**
 * Canonical key the planner uses for an item, resolving both the item/cargo
 * namespace and base/craftable twins. Used to match a pulled inventory (which
 * reports base inventory ids) to the keys that appear in a plan.
 */
export function canonKey(data: GameData, key: ItemKey): ItemKey {
  if (data.aliasMap && data.aliasMap[key]) return data.aliasMap[key];
  const r = resolveKey(data, key);
  if (data.aliasMap && data.aliasMap[r]) return data.aliasMap[r];
  return r;
}

export function skillName(data: GameData, id: number): string {
  return data.skills[String(id)] || "";
}

export function buildingTypeName(data: GameData, id: number): string {
  return data.buildingTypes[String(id)] || "";
}

/** The first (primary) crafting recipe for an item, if any. */
export function recipeFor(data: GameData, key: ItemKey): RecipeRaw | undefined {
  const recs = data.recipes[resolveKey(data, key)];
  return recs && recs.length ? recs[0] : undefined;
}

export function recipesFor(data: GameData, key: ItemKey): RecipeRaw[] {
  return data.recipes[resolveKey(data, key)] || [];
}

/**
 * The profession responsible for producing a line item:
 *  - craftable -> the skill of its (chosen) recipe
 *  - raw       -> its tagged gather profession, else "Raw / Gathered"
 */
export const RAW_BUCKET = "Raw / Gathered";
export function professionFor(
  data: GameData,
  key: ItemKey,
  chosen?: Record<ItemKey, number>
): string {
  const rk = resolveKey(data, key);
  const recs = data.recipes[rk];
  if (recs && recs.length) {
    const idx = Math.min(chosen?.[rk] ?? 0, recs.length - 1);
    return skillName(data, recs[idx].sk) || "Crafting";
  }
  return data.items[rk]?.gp || RAW_BUCKET;
}
