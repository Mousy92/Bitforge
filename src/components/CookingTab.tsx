import { useMemo, useState } from "react";
import type { FoodRaw, GameData } from "../data";

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
  const [sort, setSort] = useState<SortKey>("t");
  const [dir, setDir] = useState<1 | -1>(1);

  const tiers = useMemo(() => [...new Set(foods.map((f) => f.t))].filter((t) => t > 0).sort((a, b) => a - b), [foods]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let r = foods.filter((f) => {
      if (tier !== null && f.t !== tier) return false;
      if (!term) return true;
      if (f.n.toLowerCase().includes(term) || f.tag.toLowerCase().includes(term)) return true;
      return f.buffs.some(
        (b) => b.d.toLowerCase().includes(term) || b.stats.some(([lbl]) => lbl.toLowerCase().includes(term))
      );
    });
    r = [...r].sort((a, b) => {
      let cmp: number;
      if (sort === "n") cmp = a.n.localeCompare(b.n);
      else cmp = (a[sort] as number) - (b[sort] as number);
      return (cmp || a.n.localeCompare(b.n)) * dir;
    });
    return r;
  }, [foods, q, tier, sort, dir]);

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
                <FoodRow key={f.id} f={f} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function FoodRow({ f }: { f: FoodRaw }) {
  return (
    <tr>
      <td className="food-name">
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
              <span key={j} className="buff-stat">
                {lbl} {fmtStat(v, pct)}
              </span>
            ))}
          </div>
        ))}
      </td>
    </tr>
  );
}
