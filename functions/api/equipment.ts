// GET /api/equipment?player=<id>[&debug=1]
// Proxies the Bitjita player equipment-presets endpoint and normalizes it into
// a list of presets, each with its equipped items:
//   { presets: [{ name, items: [{ slot, key, tier, rarity, name }] }], count }
// Bitjita groups equipped gear under presets (loadouts), each a set of named
// slots. The exact JSON schema isn't documented, so extraction is defensive and
// ?debug=1 returns the raw payloads so field names can be inspected.

const BITJITA = "https://bitjita.com";

function json(obj: unknown, status = 200, cache = 0): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };
  if (cache) headers["cache-control"] = `public, max-age=${cache}`;
  return new Response(JSON.stringify(obj), { status, headers });
}

function pick(node: any, keys: string[]): any {
  for (const k of keys) if (node != null && node[k] != null) return node[k];
  return undefined;
}

async function getJSON(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "bitforge/1.0 (+bitforge.mousyhub.com)", accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Extract one equipped item from a slot entry. `slotKey` is the key under which
// the entry was found when the collection is an object map.
function extractItem(
  el: any,
  slotKey: string | null
): { slot: string; key: string; itemId: number; type: string; tier: number | null; rarity: string | null; name: string | null } | null {
  if (!el || typeof el !== "object") return null;
  // The item fields may be directly on the entry or nested.
  const it = el.item ?? el.contents ?? el.equipment ?? el.stack ?? el;
  if (!it || typeof it !== "object") return null;
  // Prefer explicit item-id fields over a bare `id` (which may be a slot id).
  const idRaw =
    it.item_id ?? it.itemId ?? it.itemID ?? el.item_id ?? el.itemId ?? el.itemID ?? it.id ?? el.id;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return null;
  const typeStr = String(pick(it, ["item_type", "type", "itemType"]) ?? pick(el, ["item_type", "type"]) ?? "Item").toLowerCase();
  const kind = typeStr.startsWith("cargo") ? "c" : "i";
  const slot = String(
    pick(el, ["slot", "slotName", "slot_name", "slotType", "slot_type", "equipmentSlot", "name"]) ??
      slotKey ??
      ""
  );
  const tierRaw = pick(it, ["tier", "level", "itemTier"]);
  const tier = tierRaw == null ? null : Number(tierRaw);
  const rarity = pick(it, ["rarity", "rarityStr", "quality"]);
  const name = pick(it, ["name", "itemName", "displayName"]);
  return {
    slot,
    key: `${kind}${id}`,
    itemId: id,
    type: kind === "c" ? "cargo" : "item",
    tier: tier != null && Number.isFinite(tier) ? tier : null,
    rarity: rarity != null ? String(rarity) : null,
    name: name != null ? String(name) : null,
  };
}

// Turn a slot collection (array of entries, or an object map slot->entry) into items.
function itemsFromCollection(coll: any): ReturnType<typeof extractItem>[] {
  if (!coll) return [];
  const entries: [string | null, any][] = Array.isArray(coll)
    ? coll.map((e) => [null, e] as [null, any])
    : typeof coll === "object"
      ? Object.entries(coll)
      : [];
  const out: ReturnType<typeof extractItem>[] = [];
  for (const [slotKey, el] of entries) {
    const item = extractItem(el, slotKey);
    if (item) out.push(item);
  }
  return out;
}

// The collection of slots inside a preset-ish object.
function collectionOf(node: any): any {
  if (Array.isArray(node)) return node;
  return (
    pick(node, ["equipment", "equipped", "slots", "gear", "items", "loadout"]) ?? node
  );
}

// Find the list of presets in the response. Falls back to treating the whole
// response as a single "Equipped" set.
function findPresets(data: any): { name: string; coll: any }[] {
  const p = pick(data, ["presets", "equipmentPresets", "equipment_presets", "loadouts"]);
  if (Array.isArray(p) && p.length) {
    return p.map((pre, i) => ({
      name: String(pick(pre, ["name", "presetName", "label", "title"]) ?? `Preset ${i + 1}`),
      coll: collectionOf(pre),
    }));
  }
  // single equipment collection somewhere in the payload
  const eq = pick(data, ["equipment", "equipped", "slots", "gear"]);
  if (eq) return [{ name: "Equipped", coll: collectionOf(eq) }];
  if (Array.isArray(data)) return [{ name: "Equipped", coll: data }];
  // one level deeper (e.g. { player: { presets: [...] } })
  if (data && typeof data === "object") {
    for (const v of Object.values(data)) {
      if (v && typeof v === "object") {
        const inner = findPresets(v);
        if (inner.length && inner.some((pr) => itemsFromCollection(pr.coll).length)) return inner;
      }
    }
  }
  return [];
}

export async function onRequestGet(context: any): Promise<Response> {
  const url = new URL(context.request.url);
  const player = (url.searchParams.get("player") || "").trim();
  const debug = url.searchParams.get("debug");
  if (!/^\d{1,25}$/.test(player)) return json({ error: "invalid player id" }, 400);

  const base = `${BITJITA}/api/players/${player}`;
  // Prefer the presets endpoint; fall back to the plain equipment endpoint.
  const presetsRaw = await getJSON(`${base}/equipment/presets`);
  const equipRaw = presetsRaw == null ? await getJSON(`${base}/equipment`) : null;
  const sourceData = presetsRaw ?? equipRaw;

  if (debug) {
    return json({
      triedPresets: `${base}/equipment/presets`,
      triedEquipment: `${base}/equipment`,
      presetsTopKeys: presetsRaw && typeof presetsRaw === "object" ? Object.keys(presetsRaw) : typeof presetsRaw,
      equipTopKeys: equipRaw && typeof equipRaw === "object" ? Object.keys(equipRaw) : typeof equipRaw,
      rawPresets: presetsRaw,
      rawEquipment: equipRaw,
    });
  }

  if (sourceData == null) return json({ error: "upstream error or no data" }, 502);

  const presets = findPresets(sourceData)
    .map((pr) => ({
      name: pr.name,
      items: itemsFromCollection(pr.coll).filter((x): x is NonNullable<typeof x> => x != null),
    }))
    .filter((pr) => pr.items.length > 0);

  const count = presets.reduce((s, p) => s + p.items.length, 0);
  // `items` kept for backward-compat: the first preset's items.
  return json({ player, presets, items: presets[0]?.items ?? [], count }, 200, 15);
}
