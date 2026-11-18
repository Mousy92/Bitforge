#!/usr/bin/env node
// Build a slim BitForge dataset from the BitCraft_GameData "cereal/cs" static tables.
//
// Usage:
//   node scripts/build-data.mjs [path-to-gamedata-static-dir]
//
// The source tables live in the community repo BitCraftToolBox/BitCraft_GameData
// on the `cereal/cs` branch, under /static. Clone it and point this script at that
// folder (or set GAMEDATA_DIR). It writes a compact public/data/gamedata.json that
// the app loads at runtime.
//
// Output schema (keys kept short on purpose — this ships to the browser):
//   {
//     generatedAt, sourceCommit,
//     skills:    { [id]: name },
//     items:     { ["i"+id | "c"+id]: { n, t(ier), tag, r(arity), ic(on) } },
//     buildings: [ { id, n, desc, cat, ic, recipe } ],   // recipe may be null
//     recipes:   { [outputKey]: [ recipe, ... ] }         // crafting recipes by output item
//   }
// where a recipe is: { sk(ill), lv(level), bt(buildingType|0), bl(buildingTier|0),
//                      out(putQty), act(ions), mats: [ [kind, id, qty], ... ] }
// and kind is "i" (item) or "c" (cargo).

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const SRC =
  process.argv[2] ||
  process.env.GAMEDATA_DIR ||
  "/home/user/bitcrafttoolbox/bitcraft_gamedata/static";

const OUT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../public/data/gamedata.json"
);

function load(name) {
  const p = path.join(SRC, `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Missing table: ${p}\nPoint this script at the gamedata /static dir.`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function sourceCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: SRC, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .slice(0, 12);
  } catch {
    return "unknown";
  }
}

const KIND = { Item: "i", Cargo: "c" };

console.log(`Reading tables from ${SRC} ...`);

const skillDesc = load("skill_desc");
const itemDesc = load("item_desc");
const cargoDesc = load("cargo_desc");
const buildingDesc = load("building_desc");
const constructionRecipes = load("construction_recipe_desc");
const craftingRecipes = load("crafting_recipe_desc");
const buildingTypes = load("building_type_desc");

// Membership sets so we can self-heal cross-namespace references: the game data
// sometimes lists a cargo id inside an item-stack array (and in theory vice versa).
// ~494 such entries exist; resolving them against the real tables fixes all of them.
const itemIdSet = new Set(itemDesc.map((i) => i.id));
const cargoIdSet = new Set(cargoDesc.map((c) => c.id));
function resolveKind(declaredType, id) {
  const k = KIND[declaredType] || "i";
  if (k === "i" && !itemIdSet.has(id) && cargoIdSet.has(id)) return "c";
  if (k === "c" && !cargoIdSet.has(id) && itemIdSet.has(id)) return "i";
  return k;
}
const mat = (s) => [resolveKind(s.item_type, s.item_id), s.item_id, s.quantity];

// Keyword -> gathering profession, for raw materials that no recipe produces.
// Best-effort; anything unmatched falls into the "Raw / Gathered" bucket in the UI.
const GATHER_RULES = [
  [/log|wood|timber|stick|bark|sap|branch|plank|lumber/i, "Forestry"],
  [/ore|stone|rock|boulder|clay|salt|coal|flint|gem|crystal|sand|ingot|metal/i, "Mining"],
  [/fiber|plant|flower|blossom|herb|berry|mushroom|moss|root|leaf|reed|cotton|straw|nut|seed/i, "Foraging"],
  [/hide|pelt|leather|meat|bone|carcass|fur|animal|feather/i, "Hunting"],
  [/fish|shell|clam|crab|seaweed|pearl|bait/i, "Fishing"],
  [/crop|grain|wheat|vegetable|fruit|wool|milk|egg/i, "Farming"],
  [/hexite|shard|ancient/i, "Hexite Gathering"],
];
function gatherProfession(name, tag) {
  const hay = `${tag} ${name}`;
  for (const [re, prof] of GATHER_RULES) if (re.test(hay)) return prof;
  return "";
}

// ---- skills (professions) ----
const skills = {};
for (const s of skillDesc) {
  if (s.name && s.name !== "ANY") skills[s.id] = s.name;
}

// ---- building type names (for "crafted at") ----
const buildingTypeName = {};
for (const bt of buildingTypes) buildingTypeName[bt.id] = bt.name;

// ---- items + cargo, merged into one lookup with prefixed keys ----
const items = {};
const cleanName = (n) => (typeof n === "string" ? n.trim() : "");
for (const it of itemDesc) {
  const n = cleanName(it.name);
  if (!n || n === "{0}") continue;
  items[`i${it.id}`] = {
    n,
    t: it.tier,
    tag: it.tag || "",
    r: it.rarity || "",
    ic: it.icon_asset_name || "",
  };
}
for (const cg of cargoDesc) {
  const n = cleanName(cg.name);
  if (!n) continue;
  items[`c${cg.id}`] = {
    n,
    t: cg.tier,
    tag: cg.tag || "",
    r: cg.rarity || "",
    ic: cg.icon_asset_name || "",
  };
}

// ---- crafting recipes, indexed by the item they produce ----
// Many recipes share an output; we keep them all so the planner can offer choices.
const recipes = {};
let recipeCount = 0;
for (const r of craftingRecipes) {
  const outputs = r.crafted_item_stacks || [];
  if (!outputs.length) continue;

  const mats = [];
  for (const s of r.consumed_item_stacks || []) mats.push(mat(s));
  for (const s of r.consumed_cargo_stacks || []) mats.push(mat(s));
  if (!mats.length) continue; // nothing consumed -> not a useful crafting node

  const lvl = (r.level_requirements || [])[0] || {};
  const bq = r.building_requirement || {};

  // One recipe can yield several outputs (e.g. byproducts). Index under each.
  for (const out of outputs) {
    const outKey = `${resolveKind(out.item_type, out.item_id)}${out.item_id}`;
    const recipe = {
      sk: lvl.skill_id || 0,
      lv: lvl.level || 0,
      bt: bq.building_type || 0,
      bl: bq.tier || 0,
      out: out.quantity || 1,
      act: r.actions_required || 0,
      mats,
    };
    (recipes[outKey] ||= []).push(recipe);
    recipeCount++;
  }
}

// ---- strip packaging (pack <-> unpack) cycles -------------------------------
// BitCraft lets you pack a bulk resource into a cargo "package" and unpack it.
// That shows up as two reciprocal single-material recipes:
//   Package  (out 1)   <- 100x Base
//   Base     (out 100) <- 1x  Package
// Left in, these create infinite cycles and double-counted totals. We detect the
// pair, record how many base units a package holds, delete BOTH recipes, then
// rewrite every material reference to a package into its base units. After this
// the material graph is entirely in gather/craft units (logs, fiber, ...), with
// packages removed from planning.
const singleMatRecipe = (key) =>
  (recipes[key] || []).find((r) => r.mats.length === 1);

const packaging = {}; // packageKey -> { base, per }  (per = base units in one package)
for (const [key, recs] of Object.entries(recipes)) {
  for (const r of recs) {
    if (r.mats.length !== 1) continue;
    const [mk, mid, mq] = r.mats[0];
    const matKey = `${mk}${mid}`;
    const back = singleMatRecipe(matKey);
    if (!back) continue;
    const [bk, bid] = back.mats[0];
    if (`${bk}${bid}` !== key) continue; // not reciprocal
    // reciprocal pair found. The "package" is the side produced one-at-a-time.
    if (r.out === 1 && mq > 1) {
      packaging[key] = { base: matKey, per: mq, skill: r.sk }; // this recipe packs
    }
  }
}

function stripPackagingRecipe(key) {
  const recs = recipes[key];
  if (!recs) return;
  const kept = recs.filter((r) => {
    if (r.mats.length !== 1) return true;
    const mk = `${r.mats[0][0]}${r.mats[0][1]}`;
    // drop if this is a pack recipe (key is a package) or an unpack recipe
    // (its single material is a package)
    return !(packaging[key] || packaging[mk]);
  });
  if (kept.length) recipes[key] = kept;
  else delete recipes[key];
}
for (const key of Object.keys(recipes)) stripPackagingRecipe(key);

// Record the gather skill a package's base came from, so attribution is exact.
for (const { base, skill } of Object.values(packaging)) {
  const it = items[base];
  if (it && !recipes[base] && skill && skills[skill]) it.gp = skills[skill];
}

// Rewrite a material list, expanding any package reference into base units.
function rewriteMats(mats) {
  const out = [];
  for (let [k, id, q] of mats) {
    let key = `${k}${id}`;
    let guard = 0;
    while (packaging[key] && guard++ < 10) {
      const p = packaging[key];
      q *= p.per;
      key = p.base;
      k = key[0];
      id = +key.slice(1);
    }
    out.push([k, id, q]);
  }
  // merge duplicates that collapsed to the same base
  const merged = {};
  for (const [k, id, q] of out) merged[`${k}${id}`] = (merged[`${k}${id}`] || 0) + q;
  return Object.entries(merged).map(([key, q]) => [key[0], +key.slice(1), q]);
}
for (const recs of Object.values(recipes))
  for (const r of recs) r.mats = rewriteMats(r.mats);

// ---- tag a gathering profession onto raw items (those no recipe produces) ----
// Craftables carry their producing skill via recipes[key][0].sk at runtime; raw
// materials get a best-effort gather profession so the by-profession view is complete.
let taggedRaw = 0;
for (const [k, it] of Object.entries(items)) {
  if (recipes[k]) continue; // craftable -> skill comes from its recipe
  const gp = gatherProfession(it.n, it.tag);
  if (gp) {
    it.gp = gp;
    taggedRaw++;
  }
}

// ---- buildings with their construction recipe ----
const recipeByBuilding = {};
for (const cr of constructionRecipes) {
  if (cr.building_description_id) recipeByBuilding[cr.building_description_id] = cr;
}

const buildings = [];
for (const b of buildingDesc) {
  const n = cleanName(b.name);
  if (!n) continue;
  const cr = recipeByBuilding[b.id];
  let recipe = null;
  if (cr) {
    let mats = [];
    for (const s of cr.consumed_item_stacks || []) mats.push(mat(s));
    for (const s of cr.consumed_cargo_stacks || []) mats.push(mat(s));
    mats = rewriteMats(mats); // expand packages -> base units
    const lvl = (cr.level_requirements || [])[0] || {};
    recipe = {
      sk: lvl.skill_id || 0,
      lv: lvl.level || 0,
      act: cr.actions_required || 0,
      mats,
    };
  }
  // Only keep buildings that are actually constructable (have a recipe) to cut noise.
  if (!recipe || !recipe.mats.length) continue;

  // Derive a category from the building's first function type if present.
  const fn = (b.functions || [])[0] || {};
  buildings.push({
    id: b.id,
    n,
    desc: cleanName(b.description),
    ic: b.icon_asset_name || "",
    ft: fn.function_type || 0,
    recipe,
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceCommit: sourceCommit(),
  skills,
  buildingTypes: buildingTypeName,
  items,
  buildings,
  recipes,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));

const bytes = fs.statSync(OUT).size;
console.log(`Wrote ${OUT}`);
console.log(
  `  items=${Object.keys(items).length}  buildings=${buildings.length}  ` +
    `recipe-outputs=${Object.keys(recipes).length} (${recipeCount} recipes)  ` +
    `raw-tagged=${taggedRaw}  size=${(bytes / 1024 / 1024).toFixed(2)}MB  ` +
    `source=${out.sourceCommit}`
);
