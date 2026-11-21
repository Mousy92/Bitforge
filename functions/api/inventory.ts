// GET /api/inventory?claim=<id>[&debug=1]
// Proxies the Bitjita claim-inventory endpoint, aggregates everything on hand
// into { "i<id>"|"c<id>": quantity }, and returns it with CORS. The browser
// can't call Bitjita directly (CORS / rate limits), so this does it server-side
// with a short cache. ?debug=1 returns the raw structure so field names can be
// inspected.

const BITJITA = "https://bitjita.com";

function json(obj: unknown, status = 200, cache = 0): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  };
  if (cache) headers["cache-control"] = `public, max-age=${cache}`;
  return new Response(JSON.stringify(obj), { status, headers });
}

// Does this object look like an inventory stack (an item id + a quantity)?
function stackOf(node: any): { key: string; qty: number } | null {
  if (!node || typeof node !== "object") return null;
  const id = node.item_id ?? node.itemId;
  const qty = node.quantity ?? node.qty ?? node.count ?? node.amount;
  if (id == null || typeof qty !== "number") return null;
  const t = String(node.item_type ?? node.type ?? "Item").toLowerCase();
  const kind = t.startsWith("cargo") ? "c" : "i";
  return { key: `${kind}${id}`, qty };
}

// Recursively sum every stack found under `node` into `out`. Recognized stacks
// are treated as leaves (not descended into) to avoid double counting.
function collect(node: any, out: Record<string, number>): void {
  if (Array.isArray(node)) {
    for (const x of node) collect(x, out);
    return;
  }
  if (node && typeof node === "object") {
    const s = stackOf(node);
    if (s) {
      out[s.key] = (out[s.key] || 0) + s.qty;
      return;
    }
    for (const k of Object.keys(node)) collect(node[k], out);
  }
}

export async function onRequestGet(context: any): Promise<Response> {
  const url = new URL(context.request.url);
  const claim = (url.searchParams.get("claim") || "").trim();
  const debug = url.searchParams.get("debug");
  if (!/^\d{1,25}$/.test(claim)) return json({ error: "invalid claim id" }, 400);

  let res: Response;
  try {
    res = await fetch(`${BITJITA}/api/claims/${claim}/inventories`, {
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

  if (debug) {
    const sample = (arr: any) => (Array.isArray(arr) && arr.length ? arr[0] : null);
    const bld = Array.isArray(data?.buildings) ? data.buildings : [];
    return json({
      topKeys: data && typeof data === "object" ? Object.keys(data) : typeof data,
      lengths: {
        items: Array.isArray(data?.items) ? data.items.length : undefined,
        cargos: Array.isArray(data?.cargos) ? data.cargos.length : undefined,
        buildings: bld.length,
      },
      sampleItem: sample(data?.items),
      sampleCargo: sample(data?.cargos),
      sampleBuilding: bld.length ? { keys: Object.keys(bld[0]), inventory0: sample(bld[0]?.inventory) } : null,
    });
  }

  // Prefer the detailed building contents; fall back to top-level items/cargos.
  let totals: Record<string, number> = {};
  const buildings = Array.isArray(data?.buildings) ? data.buildings : [];
  if (buildings.length) collect(buildings, totals);
  let source = "buildings";
  if (Object.keys(totals).length === 0) {
    totals = {};
    collect(data?.items, totals);
    collect(data?.cargos, totals);
    source = "top";
  }

  return json({ claim, source, distinct: Object.keys(totals).length, totals }, 200, 30);
}
