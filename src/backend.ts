// Client for the optional save/short-link backend (Cloudflare Pages Functions +
// KV). Everything degrades gracefully: if the backend isn't available (e.g. the
// single-file offline build, or before KV is configured), callers fall back to
// the self-contained #b= link.

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
