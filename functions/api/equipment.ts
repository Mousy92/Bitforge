// GET /api/equipment?player=<id>[&debug=1]
// Proxies the Bitjita player-equipment endpoint and normalizes it into a flat
// list of equipped items: { slot, key, tier, rarity, name }. The browser can't
// call Bitjita directly (CORS / rate limits), so this does it server-side on
// Cloudflare's edge. ?debug=1 returns the raw structure so field names can be
// inspected against the live response (the exact schema isn't documented).

const BITJITA = "https://bitjita.com";

function json(obj: unknown, status = 200, cache = 0): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };
  if (cache) headers["cache-control"] = `public, max-age=${cache}`;
  return new Response(JSON.stringify(obj), { status, headers });
}

// Pull the first defined value among several candidate field names.
function pick(node: any, keys: string[]): any {
  for (const k of keys) if (node != null && node[k] != null) return node[k];
  return undefined;
}

// Given an element of the equipment array, find the underlying item object.
// Bitjita may put item fields directly on the slot element, or nest them under
// .item / .contents / .stack — handle all of these.
function itemOf(node: any): any {
  if (!node || typeof node !== "object") return null;
  const nested = node.item ?? node.contents ?? node.stack ?? node.equipment ?? null;
  if (nested && typeof nested === "object" && (nested.item_id ?? nested.itemId ?? nested.id) != null)
    return nested;
  if ((node.item_id ?? node.itemId ?? node.id) != null) return node;
  return nested || null;
}

function extract(node: any): {
  slot: string;
  key: string;
  itemId: number;
  type: string;
  tier: number | null;
  rarity: string | null;
  name: string | null;
} | null {
  const it = itemOf(node);
  if (!it) return null;
  const rawId = pick(it, ["item_id", "itemId", "id"]);
  const id = Number(rawId);
  if (!Number.isFinite(id)) return null;
  const typeStr = String(pick(it, ["item_type", "type", "itemType"]) ?? "Item").toLowerCase();
  const kind = typeStr.startsWith("cargo") ? "c" : "i";
  const slot = String(
    pick(node, ["slot", "slotName", "slot_name", "slotType", "slot_type", "equipmentSlot", "index"]) ?? ""
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

// Find the array most likely to hold equipment slots.
function equipmentArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  for (const k of ["equipment", "equipped", "slots", "gear", "items"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  // Some responses wrap it one level deeper (e.g. { player: { equipment: [...] } }).
  if (data && typeof data === "object") {
    for (const v of Object.values(data)) {
      if (v && typeof v === "object") {
        for (const k of ["equipment", "equipped", "slots", "gear"]) {
          if (Array.isArray((v as any)[k])) return (v as any)[k];
        }
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

  let res: Response;
  try {
    res = await fetch(`${BITJITA}/api/players/${player}/equipment`, {
      headers: { "user-agent": "bitforge/1.0 (+bitforge.mousyhub.com)", accept: "application/json" },
    });
  } catch (e) {
    return json({ error: "upstream fetch failed", detail: String(e) }, 502);
  }
  if (!res.ok) return json({ error: "upstream error", status: res.status }, 502);

  let data: any;
  try {
    data = await res.json();
  } catch {
    return json({ error: "upstream returned non-JSON" }, 502);
  }

  const arr = equipmentArray(data);

  if (debug) {
    return json({
      topKeys: data && typeof data === "object" ? Object.keys(data) : typeof data,
      equipmentLen: arr.length,
      sampleRaw: arr.length ? arr[0] : null,
      sampleExtracted: arr.length ? extract(arr[0]) : null,
    });
  }

  const items = arr.map(extract).filter((x): x is NonNullable<typeof x> => x != null);
  return json({ player, count: items.length, items }, 200, 15);
}
