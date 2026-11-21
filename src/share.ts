// Encode/decode a build into a compact, URL-safe string. The whole build travels
// in the link (and in export codes) — no backend, no accounts. Uses lz-string so
// even large builds stay well under URL length limits.

import LZString from "lz-string";
import type { Build, Target } from "./model";

const VERSION = 1;

// Compact wire form: [version, name, [ [kindFlag, idOrKey, qty], ... ] ]
// kindFlag: 0 = building (idOrKey is a number), 1 = item (idOrKey is the string key)
type WireTarget = [0 | 1, number | string, number];
type Wire = [number, string, WireTarget[]];

function toWire(build: Build): Wire {
  const ts: WireTarget[] = build.targets.map((t) =>
    t.t === "b" ? [0, t.id, t.q] : [1, t.k, t.q]
  );
  return [VERSION, build.name || "", ts];
}

function fromWire(w: Wire): Build {
  const [, name, ts] = w;
  const targets: Target[] = (ts || [])
    .map((wt): Target | null => {
      const [flag, ref, qty] = wt;
      const q = Number(qty) || 0;
      if (flag === 0) return { t: "b", id: Number(ref), q };
      if (flag === 1) return { t: "i", k: String(ref), q };
      return null;
    })
    .filter((x): x is Target => x !== null);
  return { name: String(name || ""), targets };
}

export function encodeBuild(build: Build): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(toWire(build)));
}

export function decodeBuild(code: string): Build | null {
  try {
    const json = LZString.decompressFromEncodedURIComponent(code);
    if (!json) return null;
    const w = JSON.parse(json) as Wire;
    if (!Array.isArray(w) || w[0] !== VERSION) return null;
    return fromWire(w);
  } catch {
    return null;
  }
}

/** Full shareable URL for the current page + build. */
export function shareUrl(build: Build): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#b=${encodeBuild(build)}`;
}

/** Read a build from the current URL hash, if present. */
export function buildFromHash(): Build | null {
  const m = location.hash.match(/[#&]b=([^&]+)/);
  return m ? decodeBuild(m[1]) : null;
}

/** A saved-build short id from the URL hash (#s=<id>), if present. */
export function shortIdFromHash(): string | null {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

/** Full short-link URL for a saved build id. */
export function shortShareUrl(id: string): string {
  return `${location.origin}${location.pathname}#s=${id}`;
}

/** Write the build into the URL hash without adding a history entry. */
export function syncHash(build: Build): void {
  const code = encodeBuild(build);
  history.replaceState(null, "", `${location.pathname}#b=${code}`);
}
