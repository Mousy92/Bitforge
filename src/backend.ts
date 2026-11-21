// Client for the optional save/short-link backend (Cloudflare Pages Functions +
// KV). Everything degrades gracefully: if the backend isn't available (e.g. the
// single-file offline build, or before KV is configured), callers fall back to
// the self-contained #b= link.

import { type GameData, type ItemKey, canonKey, resolveKey } from "./data";
import type { Build } from "./model";
import { decodeBuild, encodeBuild } from "./share";

/** Save a build server-side; returns a short id, or null if unavailable. */
export async function saveBuildRemote(build: Build): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/builds`, {
      method: "POST",
      body: encodeBuild(build),
      headers: { "content-type": "text/plain" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

/** Load a build by short id; returns the Build, or null if missing/unavailable. */
export async function loadBuildRemote(id: string): Promise<Build | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/builds/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string };
    return data.code ? decodeBuild(data.code) : null;
  } catch {
    return null;
  }
}

export interface InventoryResult {
  totals: Record<ItemKey, number>; // keyed by canonical plan keys
  distinct: number;
  source: string;
}

export interface EquipItem {
  slot: string;
  key: ItemKey; // resolved to a key present in gamedata when possible
  tier: number | null;
  rarity: string | null;
  name: string | null;
}
export interface EquipmentResult {
  items: EquipItem[];
  count: number;
}

/** Pull a player's equipped gear from Bitjita (via our proxy). Returns null on
 *  failure. Item keys are resolved into the gamedata namespace for lookup. */
export async function pullEquipment(
  data: GameData,
  player: string
): Promise<EquipmentResult | null> {
  try {
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/equipment?player=${encodeURIComponent(player)}`
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      items?: { slot?: string; key?: string; tier?: number | null; rarity?: string | null; name?: string | null }[];
    };
    const items: EquipItem[] = (d.items || [])
      .filter((x) => x && x.key)
      .map((x) => ({
        slot: x.slot || "",
        key: resolveKey(data, x.key as ItemKey),
        tier: x.tier ?? null,
        rarity: x.rarity ?? null,
        name: x.name ?? null,
      }));
    return { items, count: items.length };
  } catch {
    return null;
  }
}

/** Pull a claim's on-hand storage from Bitjita (via our proxy) and map it to
 *  canonical plan keys. Returns null on failure. */
export async function pullInventory(
  data: GameData,
  claim: string
): Promise<InventoryResult | null> {
  try {
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/inventory?claim=${encodeURIComponent(claim)}`
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { totals?: Record<string, number>; source?: string };
    const totals: Record<ItemKey, number> = {};
    for (const [k, q] of Object.entries(d.totals || {})) {
      const ck = canonKey(data, k);
      totals[ck] = (totals[ck] || 0) + (q || 0);
    }
    return { totals, distinct: Object.keys(totals).length, source: d.source || "" };
  } catch {
    return null;
  }
}
