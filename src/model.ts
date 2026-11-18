// The user's build: a named list of targets (buildings and/or items + quantities).
import type { ItemKey } from "./data";

export type Target =
  | { t: "b"; id: number; q: number } // a building to construct
  | { t: "i"; k: ItemKey; q: number }; // an item/cargo to craft or gather

export interface Build {
  name: string;
  targets: Target[];
}

export const emptyBuild = (): Build => ({ name: "", targets: [] });

export function targetId(t: Target): string {
  return t.t === "b" ? `b${t.id}` : `i${t.k}`;
}
