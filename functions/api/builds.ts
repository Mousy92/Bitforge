// POST /api/builds  — save a build, return a short id.
// The body is the lz-string-encoded build code (same string used in #b= links).
// Stored in the BUILDS KV namespace. Values are tiny (a few hundred bytes).

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

// Unambiguous short id (no look-alike chars).
function shortId(n = 7): string {
  const alphabet = "23456789abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

export async function onRequestPost(context: any): Promise<Response> {
  const { request, env } = context;
  if (!env || !env.BUILDS) return json({ error: "storage not configured" }, 503);

  const code = (await request.text()).trim();
  if (!code || code.length > 12000) return json({ error: "invalid size" }, 400);
  // lz-string compressToEncodedURIComponent alphabet: letters, digits, + - $
  if (!/^[A-Za-z0-9+\-$]+$/.test(code)) return json({ error: "invalid code" }, 400);

  let id = shortId();
  for (let i = 0; i < 4; i++) {
    if ((await env.BUILDS.get(id)) === null) break;
    id = shortId();
  }
  // Keep saved builds for a year; touched builds effectively live as long as used.
  await env.BUILDS.put(id, code, { expirationTtl: 60 * 60 * 24 * 365 });
  return json({ id });
}

// CORS preflight (harmless; same-origin in practice).
export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
