// GET /api/builds/:id — fetch a saved build's code.

export async function onRequestGet(context: any): Promise<Response> {
  const { env, params } = context;
  if (!env || !env.BUILDS) {
    return new Response(JSON.stringify({ error: "storage not configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const id = String(params.id || "").slice(0, 32);
  const code = await env.BUILDS.get(id);
  if (code === null) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ code }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
