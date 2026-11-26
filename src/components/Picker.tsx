import { useMemo, useState } from "react";
import { type GameData, professionFor, recipesFor } from "../data";
import type { Target } from "../model";

interface Row {
  kind: "building" | "item";
  label: string;
  lname: string;
  tier: number;
  rarity: string;
  tag: string;
  profession: string;
  craftable: boolean;
  id?: number;
  key?: string;
}

interface Filters {
  profession: string;
  tier: number | null; // null = any
  rarity: string;
  tag: string;
  kind: "all" | "building" | "item";
  source: "all" | "craftable" | "raw";
}

const emptyFilters: Filters = {
  profession: "",
  tier: null,
  rarity: "",
  tag: "",
  kind: "all",
  source: "all",
};

const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14];

export function Picker({ data, onAdd }: { data: GameData; onAdd: (t: Target) => void }) {
  const [q, setQ] = useState("");
  const [qty, setQty] = useState(1);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);

  const professions = useMemo(() => Object.values(data.skills).sort(), [data]);
  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const it of Object.values(data.items)) if (it.r) set.add(it.r);
    return [...set];
  }, [data]);

  const index = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const b of data.buildings) {
      rows.push({
        kind: "building",
        label: b.n,
        lname: b.n.toLowerCase(),
        tier: -1,
        rarity: "",
        tag: "",
        profession: data.skills[String(b.recipe.sk)] || "Construction",
        craftable: true,
        id: b.id,
      });
    }
    for (const [key, it] of Object.entries(data.items)) {
      // Skip bundled "Package" cargo twins — they're packaging duplicates of a
      // craftable item and dead-end; users should add the real item.
      if (it.tag === "Package") continue;
      rows.push({
        kind: "item",
        label: it.n,
        lname: it.n.toLowerCase(),
        tier: it.t,
        rarity: it.r,
        tag: it.tag,
        profession: professionFor(data, key),
        craftable: recipesFor(data, key).length > 0,
        key,
      });
    }
    return rows;
  }, [data]);

  const activeCount =
    (filters.profession ? 1 : 0) +
    (filters.tier !== null ? 1 : 0) +
    (filters.rarity ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.kind !== "all" ? 1 : 0) +
    (filters.source !== "all" ? 1 : 0);

  const hasQuery = q.trim().length > 0 || activeCount > 0;

  const results = useMemo<Row[]>(() => {
    if (!hasQuery) return [];
    const term = q.trim().toLowerCase();
    const tagTerm = filters.tag.trim().toLowerCase();
    const matched: Row[] = [];
    for (const r of index) {
      if (filters.kind !== "all" && r.kind !== filters.kind) continue;
      if (filters.source === "craftable" && !r.craftable) continue;
      if (filters.source === "raw" && r.craftable && r.kind === "item") continue;
      if (filters.profession && r.profession !== filters.profession) continue;
      if (filters.tier !== null && r.tier !== filters.tier) continue;
      if (filters.rarity && r.rarity !== filters.rarity) continue;
      if (tagTerm && !r.tag.toLowerCase().includes(tagTerm)) continue;
      if (term && !r.lname.includes(term)) continue;
      matched.push(r);
      if (matched.length > 400) break;
    }
    // rank: name-start first, then buildings, then alpha
    const rank = (r: Row) => {
      const starts = term && r.lname.startsWith(term) ? 0 : 1;
      const kindRank = r.kind === "building" ? 0 : 1;
      return starts * 10 + kindRank;
    };
    return matched.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)).slice(0, 200);
  }, [q, filters, index, hasQuery]);

  function add(r: Row) {
    onAdd(r.kind === "building" ? { t: "b", id: r.id!, q: qty } : { t: "i", k: r.key!, q: qty });
  }
  function set<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters((f) => ({ ...f, [k]: v }));
  }

  return (
    <div className="picker">
      <div className="picker-row">
        <input
          className="search"
          placeholder="Search a building or item…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="qty-pick">
          ×
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <button
          className={`btn small ${activeCount ? "primary" : "ghost"} filter-btn`}
          onClick={() => setShowFilters((s) => !s)}
        >
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
      </div>

      {showFilters && (
        <div className="filters">
          <div className="filter-grid">
            <label>
              Profession
              <select value={filters.profession} onChange={(e) => set("profession", e.target.value)}>
                <option value="">Any</option>
                {professions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rarity
              <select value={filters.rarity} onChange={(e) => set("rarity", e.target.value)}>
                <option value="">Any</option>
                {rarities.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                value={filters.kind}
                onChange={(e) => set("kind", e.target.value as Filters["kind"])}
              >
                <option value="all">All</option>
                <option value="building">Buildings</option>
                <option value="item">Items</option>
              </select>
            </label>
            <label>
              Source
              <select
                value={filters.source}
                onChange={(e) => set("source", e.target.value as Filters["source"])}
              >
                <option value="all">All</option>
                <option value="craftable">Craftable</option>
                <option value="raw">Raw / gathered</option>
              </select>
            </label>
            <label className="tag-filter">
              Tag contains
              <input
                value={filters.tag}
                placeholder="e.g. Tool, Armor, Plank…"
                onChange={(e) => set("tag", e.target.value)}
              />
            </label>
          </div>
          <div className="tier-row">
            <span>Tier</span>
            <button className={filters.tier === null ? "tchip on" : "tchip"} onClick={() => set("tier", null)}>
              Any
            </button>
            {TIERS.map((t) => (
              <button
                key={t}
                className={filters.tier === t ? "tchip on" : "tchip"}
                onClick={() => set("tier", filters.tier === t ? null : t)}
              >
                {t}
              </button>
            ))}
            {activeCount > 0 && (
              <button className="btn ghost small clear-filters" onClick={() => setFilters(emptyFilters)}>
                Reset filters
              </button>
            )}
          </div>
        </div>
      )}

      {hasQuery && (
        <div className="browse">
          <div className="browse-head">
            {results.length >= 200 ? "200+" : results.length} match
            {results.length === 1 ? "" : "es"}
            {results.length >= 200 && <span className="hint"> · narrow your filters to see more</span>}
          </div>
          <ul className="browse-list">
            {results.map((r, i) => (
              <li key={i}>
                <span className={`pill ${r.kind}`}>{r.kind === "building" ? "Build" : "Item"}</span>
                <span className="b-name" title={r.label}>
                  {r.label}
                </span>
                {r.tier > 0 && <span className="b-tier">T{r.tier}</span>}
                <span className="b-prof">{r.profession}</span>
                <button className="b-add" onClick={() => add(r)}>
                  + add
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="b-empty">No matches. Try loosening a filter.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
