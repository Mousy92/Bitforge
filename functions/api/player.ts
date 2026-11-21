// GET /api/player?player=<id>[&debug=1]
// Proxies the Bitjita player profile and normalizes the skill levels into
// { name, skills: [{ name, level }] }. The exact schema isn't documented, so
// extraction is defensive and ?debug=1 returns the raw shape for inspection.

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

// Find the array that holds skill entries.
function skillsArray(data: any): any[] {
  for (const k of ["skills", "experience", "levels", "skillLevels", "skill_levels"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  // one level deeper (e.g. { player: { skills: [...] } })
  if (data && typeof data === "object") {
    for (const v of Object.values(data)) {
      if (v && typeof v === "object") {
        for (const k of ["skills", "experience", "levels"]) {
          if (Array.isArray((v as any)[k])) return (v as any)[k];
        }
      }
    }
  }
  return [];
}

function extractSkill(node: any): { name: string; level: number } | null {
  if (!node || typeof node !== "object") return null;
  const name = pick(node, ["skill_name", "skillName", "name", "skill", "title"]);
  const levelRaw = pick(node, ["level", "lvl", "skill_level", "skillLevel"]);
  const level = Number(levelRaw);
  if (name == null || !Number.isFinite(level)) return null;
  return { name: String(name), level };
}

export async function onRequestGet(context: any): Promise<Response> {
  const url = new URL(context.request.url);
  const player = (url.searchParams.get("player") || "").trim();
  const debug = url.searchParams.get("debug");
  if (!/^\d{1,25}$/.test(player)) return json({ error: "invalid player id" }, 400);

  let res: Response;
  try {
    res = await fetch(`${BITJITA}/api/players/${player}`, {
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

  const arr = skillsArray(data);
  const name =
    pick(data, ["username", "name", "player_name", "playerName", "displayName"]) ??
    pick(data?.player ?? {}, ["username", "name", "player_name"]) ??
    null;

  if (debug) {
    return json({
      topKeys: data && typeof data === "object" ? Object.keys(data) : typeof data,
      name,
      skillsLen: arr.length,
      sampleRaw: arr.length ? arr[0] : null,
      sampleExtracted: arr.length ? extractSkill(arr[0]) : null,
    });
  }

  const skills = arr.map(extractSkill).filter((x): x is { name: string; level: number } => x != null);
  return json({ player, name: name != null ? String(name) : null, skills }, 200, 60);
}
