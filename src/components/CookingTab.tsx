import { useEffect, useMemo, useState } from "react";
import type { FoodRaw, GameData } from "../data";

const FAV_KEY = "bitforge:favfoods";

type SortKey = "n" | "t" | "hg" | "hp" | "st";

function fmtDur(s: number): string {
  if (!s) return "";
  if (s >= 3600) return `${(s / 3600).toFixed(s % 3600 ? 1 : 0)}h`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}
function fmtStat(value: number, isPct: boolean): string {
  if (isPct) {
    const p = value * 100;
    return `${p > 0 ? "+" : ""}${Number(p.toFixed(1))}%`;
  }
  return `${value > 0 ? "+" : ""}${value}`;
}

export function CookingTab({ data }: { data: GameData }) {
  const foods = data.foods ?? [];
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<number | null>(null);
  const [buff, setBuff] = useState("");
  const [sort, setSort] = useState<SortKey>("t");
  const [dir, setDir] = useState<1 | -1>(1);
  const [favs, setFavs] = useState<Set<number>>(new Set());
  const [favOnly, setFavOnly] = useState(false);

  // Load/persist favorite foods.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavs(new Set(JSON.parse(raw) as number[]));
    } catch {
      /* ignore */
    }
  }, []);
  function toggleFav(id: number) {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {
        /* storage may be unavailable */
      }
      return next;
    });
  }

  const tiers = useMemo(() => [...new Set(foods.map((f) => f.t))].filter((t) => t > 0).sort((a, b) => a - b), [foods]);

  // Distinct buff stat labels present in the data, for the buff filter dropdown.
  const buffLabels = useMemo(() => {
    const set = new Set<string>();
    for (const f of foods) for (const b of f.buffs) for (const [lbl] of b.stats) set.add(lbl);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [foods]);

  // Best (largest magnitude) value a food grants for the selected buff label.
  function buffValue(f: FoodRaw, label: string): number {
    let best = 0;
    for (const b of f.buffs)
      for (const [lbl, v] of b.stats)
        if (lbl === label && Math.abs(v) > Math.abs(best)) best = v;
    return best;
  }

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = foods.filter((f) => {
      if (favOnly && !favs.has(f.id)) return false;
      if (tier !== null && f.t !== tier) return false;
      if (buff && !f.buffs.some((b) => b.stats.some(([lbl]) => lbl === buff))) return false;
      if (!term) return true;
      if (f.n.toLowerCase().includes(term) || f.tag.toLowerCase().includes(term)) return true;
      return f.buffs.some(
        (b) => b.d.toLowerCase().includes(term) || b.stats.some(([lbl]) => lbl.toLowerCase().includes(term))
      );
    });
    // When a buff is picked, strongest-first by that buff; otherwise the chosen column sort.
    if (buff) {
      r = [...r].sort((a, b) => Math.abs(buffValue(b, buff)) - Math.abs(buffValue(a, buff)) || a.n.localeCompare(b.n));
    } else {
      r = [...r].sort((a, b) => {
        let cmp: number;
        if (sort === "n") cmp = a.n.localeCompare(b.n);
        else cmp = (a[sort] as number) - (b[sort] as number);
        return (cmp || a.n.localeCompare(b.n)) * dir;
      });
    }
    // Pin favorites to the top (unless already filtering to favorites only).
    if (!favOnly && favs.size) {
      r = [...r].sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)));
    }
    return r;
  }, [foods, q, tier, buff, sort, dir, favs, favOnly]);

  function setSortKey(k: SortKey) {
    if (k === sort) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(k);
      setDir(k === "n" ? 1 : -1);
    }
  }
  const arrow = (k: SortKey) => (sort === k ? (dir === 1 ? " ▲" : " ▼") : "");

  if (!foods.length) {
    return (
      <main className="layout single">
        <div className="panel empty">
          <h2>No food data</h2>
          <p className="hint">Regenerate the dataset to include foods.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="layout single">
      <div className="panel">
        <div className="panel-head">
          <h2>Food &amp; buffs</h2>
          <div className="spacer" />
          <span className="muted small">{rows.length} of {foods.length} foods</span>
        </div>

        <div className="mat-filter">
          <input
            className="search"
            placeholder="Search food, type, or buff… (e.g. stamina, crafting speed, meal)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="mat-filter-x" onClick={() => setQ("")} title="Clear">
              ×
            </button>
          )}
        </div>

        <div className="tier-row">
          <span>Tier</span>
          <button className={tier === null ? "tchip on" : "tchip"} onClick={() => setTier(null)}>
            Any
          </button>
          {tiers.map((t) => (
            <button key={t} className={tier === t ? "tchip on" : "tchip"} onClick={() => setTier(tier === t ? null : t)}>
              {t}
            </button>
          ))}
          <span className="buff-filter">
            <span>Buff</span>
            <select className="buff-select" value={buff} onChange={(e) => setBuff(e.target.value)}>
              <option value="">Any buff</option>
              {buffLabels.map((lbl) => (
                <option key={lbl} value={lbl}>
                  {lbl}
                </option>
              ))}
            </select>
            {buff && (
              <button className="tchip clear-buff" onClick={() => setBuff("")} title="Clear buff filter">
                × {buff}
              </button>
            )}
          </span>
          <button
            className={favOnly ? "tchip on fav-chip" : "tchip fav-chip"}
            onClick={() => setFavOnly((v) => !v)}
            title="Show only your saved foods"
            style={{ marginLeft: "auto" }}
          >
            ★ Favorites{favs.size ? ` (${favs.size})` : ""}
          </button>
        </div>

        <div className="food-table-wrap">
          <table className="food-table">
            <thead>
              <tr>
                <th className="s" onClick={() => setSortKey("n")}>Food{arrow("n")}</th>
                <th className="s num" onClick={() => setSortKey("t")}>Tier{arrow("t")}</th>
                <th className="s num" onClick={() => setSortKey("hg")}>Hunger{arrow("hg")}</th>
                <th className="s num" onClick={() => setSortKey("hp")}>HP{arrow("hp")}</th>
                <th className="s num" onClick={() => setSortKey("st")}>Stam{arrow("st")}</th>
                <th>Buffs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <FoodRow key={f.id} f={f} active={buff} fav={favs.has(f.id)} onFav={() => toggleFav(f.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function FoodRow({
  f,
  active,
  fav,
  onFav,
}: {
  f: FoodRaw;
  active?: string;
  fav: boolean;
  onFav: () => void;
}) {
  return (
    <tr className={fav ? "fav-row" : ""}>
      <td className="food-name">
        <button
          className={fav ? "fav-star on" : "fav-star"}
          onClick={onFav}
          title={fav ? "Remove from favorites" : "Save as favorite"}
          aria-label="Toggle favorite"
        >
          {fav ? "★" : "☆"}
        </button>
        {f.n}
        {f.tag && <span className="food-tag">{f.tag}</span>}
        {!f.combat && <span className="food-nocombat" title="Not usable in combat">no-combat</span>}
      </td>
      <td className="num">{f.t > 0 ? `T${f.t}` : "—"}</td>
      <td className="num">{f.hg || ""}</td>
      <td className="num">{f.hp || ""}</td>
      <td className="num">{f.st || ""}</td>
      <td>
        {f.buffs.length === 0 && <span className="muted">—</span>}
        {f.buffs.map((b, i) => (
          <div key={i} className={`buff ${b.ben ? "" : "bad"}`}>
            <span className="buff-name">{b.d}</span>
            {b.dur > 0 && <span className="buff-dur">{fmtDur(b.dur)}</span>}
            {b.stats.map(([lbl, v, pct], j) => (
              <span key={j} className={`buff-stat${active && lbl === active ? " hit" : ""}`}>
                {lbl} {fmtStat(v, pct)}
              </span>
            ))}
          </div>
        ))}
      </td>
    </tr>
  );
}
