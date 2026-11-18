import { useMemo, useState } from "react";
import { type GameData, recipesFor } from "../data";
import type { Target } from "../model";

interface Row {
  kind: "building" | "item";
  label: string;
  lname: string;
  tier: number;
  // payload
  id?: number;
  key?: string;
  craftable: boolean;
}

export function Picker({ data, onAdd }: { data: GameData; onAdd: (t: Target) => void }) {
  const [q, setQ] = useState("");
  const [qty, setQty] = useState(1);
  const [focus, setFocus] = useState(false);

  const index = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    for (const b of data.buildings) {
      rows.push({
        kind: "building",
        label: b.n,
        lname: b.n.toLowerCase(),
        tier: -1,
        id: b.id,
        craftable: true,
      });
    }
    for (const [key, it] of Object.entries(data.items)) {
      rows.push({
        kind: "item",
        label: it.n,
        lname: it.n.toLowerCase(),
        tier: it.t,
        key,
        craftable: recipesFor(data, key).length > 0,
      });
    }
    return rows;
  }, [data]);

  const results = useMemo<Row[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const starts: Row[] = [];
    const contains: Row[] = [];
    for (const r of index) {
      const i = r.lname.indexOf(term);
      if (i === 0) starts.push(r);
      else if (i > 0) contains.push(r);
      if (starts.length > 60) break;
    }
    const rank = (r: Row) =>
      (r.kind === "building" ? 0 : 1) * 2 + (r.craftable ? 0 : 1);
    return [...starts, ...contains].sort((a, b) => rank(a) - rank(b)).slice(0, 40);
  }, [q, index]);

  function add(r: Row) {
    const t: Target =
      r.kind === "building"
        ? { t: "b", id: r.id!, q: qty }
        : { t: "i", k: r.key!, q: qty };
    onAdd(t);
    setQ("");
  }

  return (
    <div className="picker">
      <div className="picker-row">
        <input
          className="search"
          placeholder="Search a building or item…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
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
      </div>
      {focus && results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i} onMouseDown={() => add(r)}>
              <span className={`pill ${r.kind}`}>{r.kind === "building" ? "Build" : "Item"}</span>
              <span className="r-name">{r.label}</span>
              {r.tier > 0 && <span className="r-tier">T{r.tier}</span>}
              {!r.craftable && r.kind === "item" && <span className="r-raw">raw</span>}
              <span className="r-add">+ add</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
