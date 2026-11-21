import { useEffect, useMemo, useState } from "react";
import type { GameData, ItemKey } from "../data";
import { itemName } from "../data";
import { planBuild } from "../engine";
import type { Target } from "../model";
import {
  type GearIndex,
  type GearLine,
  buildGearIndex,
  categoriesInOrder,
  craftableTiers,
  lineForItem,
  resolveTarget,
} from "../gear";
import { pullEquipment } from "../backend";
import { PlanView } from "./PlanView";

interface Tracked {
  lineKey: string;
  cur: number; // current tier
  tgt: number; // target tier
}

const PLAYER_LS = "bitforge:player";
const GEAR_LS = "bitforge:gear";

export function GearTab({
  data,
  storage,
  onRefresh,
}: {
  data: GameData;
  storage?: Record<ItemKey, number> | null;
  onRefresh: () => void;
}) {
  const index = useMemo(() => buildGearIndex(data), [data]);
  const [player, setPlayer] = useState<string>(() => {
    try {
      return localStorage.getItem(PLAYER_LS) || "";
    } catch {
      return "";
    }
  });
  const [tracked, setTracked] = useState<Tracked[]>(() => {
    try {
      const r = localStorage.getItem(GEAR_LS);
      return r ? (JSON.parse(r) as Tracked[]) : [];
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [addQ, setAddQ] = useState("");
  const [chosen, setChosen] = useState<Record<ItemKey, number>>({});
  const [overrides, setOverrides] = useState<Record<ItemKey, number>>({});

  function persist(next: Tracked[]) {
    setTracked(next);
    try {
      localStorage.setItem(GEAR_LS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // Build a plan from every piece whose target tier beats its current tier.
  const build = useMemo(() => {
    const targets: Target[] = [];
    for (const t of tracked) {
      const line = index.lines.get(t.lineKey);
      if (!line || t.tgt <= t.cur) continue;
      const item = resolveTarget(line, t.tgt);
      if (item) targets.push({ t: "i", k: item.key, q: 1 });
    }
    return { name: "Gear upgrades", targets };
  }, [tracked, index]);

  const plan = useMemo(() => planBuild(data, build, chosen), [data, build, chosen]);
  const buildSig = useMemo(
    () => "gear:" + tracked.map((t) => `${t.lineKey}>${t.tgt}`).sort().join("|"),
    [tracked]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bitforge:override:" + buildSig);
      setOverrides(raw ? JSON.parse(raw) : {});
    } catch {
      setOverrides({});
    }
  }, [buildSig]);
  function setOverride(key: ItemKey, n: number | null) {
    setOverrides((o) => {
      const next = { ...o };
      if (n === null || Number.isNaN(n)) delete next[key];
      else next[key] = Math.max(0, n);
      try {
        localStorage.setItem("bitforge:override:" + buildSig, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function addLine(lineKey: string, cur?: number) {
    const line = index.lines.get(lineKey);
    if (!line) return;
    const tiers = craftableTiers(line);
    const curTier = cur ?? line.items[0]?.tier ?? 1;
    const tgt = tiers.find((t) => t > curTier) ?? tiers[tiers.length - 1] ?? curTier;
    persist([
      ...tracked.filter((t) => t.lineKey !== lineKey),
      { lineKey, cur: curTier, tgt },
    ]);
    setAddQ("");
  }
  function setField(lineKey: string, field: "cur" | "tgt", val: number) {
    persist(
      tracked.map((t) => {
        if (t.lineKey !== lineKey) return t;
        const next = { ...t, [field]: val };
        if (field === "cur" && next.tgt < val) next.tgt = val;
        return next;
      })
    );
  }
  function remove(lineKey: string) {
    persist(tracked.filter((t) => t.lineKey !== lineKey));
  }

  async function pull() {
    const id = player.trim();
    if (!/^\d{5,25}$/.test(id)) {
      setMsg("Enter your numeric player ID (from your bitjita.com/players/… URL).");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      localStorage.setItem(PLAYER_LS, id);
    } catch {
      /* ignore */
    }
    const res = await pullEquipment(data, id);
    setBusy(false);
    if (!res) {
      setMsg("Couldn't reach equipment for that player. Check the ID.");
      return;
    }
    if (!res.count) {
      setMsg("No equipped gear found for that player.");
      return;
    }
    // Merge pulled gear into tracked, keeping any target tiers already chosen.
    const byLine = new Map(tracked.map((t) => [t.lineKey, t]));
    let added = 0;
    for (const eq of res.items) {
      const line = lineForItem(data, index, eq.key);
      if (!line) continue;
      const cur = eq.tier ?? line.items[0]?.tier ?? 1;
      const tiers = craftableTiers(line);
      const existing = byLine.get(line.lineKey);
      const tgt = existing?.tgt ?? (tiers.find((t) => t > cur) ?? tiers[tiers.length - 1] ?? cur);
      byLine.set(line.lineKey, { lineKey: line.lineKey, cur, tgt });
      added++;
    }
    persist([...byLine.values()]);
    setMsg(`Pulled ${added} equipped piece${added === 1 ? "" : "s"}.`);
  }

  // Manual-add search over gear lines.
  const addResults = useMemo(() => {
    const q = addQ.trim().toLowerCase();
    if (!q) return [];
    const out: GearLine[] = [];
    for (const line of index.lines.values()) {
      const label = `${line.suffix} ${line.rarity} ${line.tag}`.toLowerCase();
      if (label.includes(q)) out.push(line);
      if (out.length > 40) break;
    }
    return out.sort((a, b) => a.tag.localeCompare(b.tag) || a.suffix.localeCompare(b.suffix)).slice(0, 14);
  }, [addQ, index]);

  const cats = categoriesInOrder();
  const upgradeCount = build.targets.length;

  return (
    <main className="layout">
      <section className="col-left">
        <div className="panel">
          <div className="panel-head">
            <h2>Your gear</h2>
          </div>
          <p className="hint">
            Pull your equipped gear from{" "}
            <a href="https://bitjita.com" target="_blank" rel="noreferrer">
              Bitjita
            </a>
            , then pick a target tier for each piece. BitForge totals the upgrade materials by
            profession.
          </p>
          <div className="store-row">
            <input
              className="search"
              placeholder="Player ID (number from your bitjita.com/players/… URL)"
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
              inputMode="numeric"
            />
            <button className="btn primary small" disabled={busy} onClick={pull}>
              {busy ? "Pulling…" : "Pull gear"}
            </button>
          </div>
          {msg && <div className="store-msg">{msg}</div>}

          <div className="gear-add">
            <input
              className="search"
              placeholder="Add gear manually… (e.g. axe, plated boots, shortsword)"
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
            />
            {addResults.length > 0 && (
              <ul className="gear-add-results">
                {addResults.map((line) => (
                  <li key={line.lineKey}>
                    <button onClick={() => addLine(line.lineKey)}>
                      <span className="gear-add-name">{line.suffix}</span>
                      <span className="gear-add-meta">
                        {line.rarity} · {line.tag}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {tracked.length > 0 && (
            <button className="btn ghost small clear" onClick={() => persist([])}>
              Clear all gear
            </button>
          )}
        </div>

        <TrackedList
          data={data}
          index={index}
          tracked={tracked}
          cats={cats}
          onCur={(lk, v) => setField(lk, "cur", v)}
          onTgt={(lk, v) => setField(lk, "tgt", v)}
          onRemove={remove}
        />
      </section>

      <section className="col-right">
        {upgradeCount === 0 ? (
          <div className="panel empty">
            <h2>Track your gear upgrades</h2>
            <p>
              Pull your equipped gear with your Bitjita player ID (or add pieces manually), then set
              a <b>target tier</b> for each. BitForge rolls up every upgrade's materials and{" "}
              <b>divides them by profession</b> — with the same storage, hardset and progress tools
              as the Build Planner.
            </p>
            <p className="hint">
              Pieces already at their target tier won't add to the list — bump a target above its
              current tier to see what it costs.
            </p>
          </div>
        ) : (
          <PlanView
            data={data}
            plan={plan}
            chosen={chosen}
            onChoose={(key, idx) => setChosen((c) => ({ ...c, [key]: idx }))}
            buildSig={buildSig}
            storage={storage}
            overrides={overrides}
            onOverride={setOverride}
            onRefresh={onRefresh}
          />
        )}
      </section>
    </main>
  );
}

function TrackedList({
  data,
  index,
  tracked,
  cats,
  onCur,
  onTgt,
  onRemove,
}: {
  data: GameData;
  index: GearIndex;
  tracked: Tracked[];
  cats: ReturnType<typeof categoriesInOrder>;
  onCur: (lineKey: string, v: number) => void;
  onTgt: (lineKey: string, v: number) => void;
  onRemove: (lineKey: string) => void;
}) {
  if (!tracked.length) return null;
  // Group tracked pieces by category.
  const byCat = new Map<string, Tracked[]>();
  for (const t of tracked) {
    const line = index.lines.get(t.lineKey);
    if (!line) continue;
    if (!byCat.has(line.category)) byCat.set(line.category, []);
    byCat.get(line.category)!.push(t);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Tracking</h2>
        <div className="spacer" />
        <span className="muted small">{tracked.length} pieces</span>
      </div>
      {cats
        .filter((c) => byCat.has(c.id))
        .map((c) => (
          <div key={c.id} className="gear-cat">
            <div className="gear-cat-head">{c.label}</div>
            <ul className="gear-list">
              {byCat.get(c.id)!.map((t) => {
                const line = index.lines.get(t.lineKey)!;
                const tiers = [...new Set(line.items.map((i) => i.tier))].sort((a, b) => a - b);
                const ctiers = craftableTiers(line);
                const targetItem = resolveTarget(line, t.tgt);
                const upgrading = t.tgt > t.cur;
                return (
                  <li key={t.lineKey} className={upgrading ? "gear-row" : "gear-row flat"}>
                    <div className="gear-row-main">
                      <span className="gear-name">
                        {line.suffix}
                        <span className="gear-rarity">{line.rarity}</span>
                      </span>
                      <button className="gear-x" onClick={() => onRemove(t.lineKey)} title="Stop tracking">
                        ×
                      </button>
                    </div>
                    <div className="gear-row-tiers">
                      <label className="gear-tier">
                        <span>Have</span>
                        <select value={t.cur} onChange={(e) => onCur(t.lineKey, Number(e.target.value))}>
                          {tiers.map((tt) => (
                            <option key={tt} value={tt}>
                              T{tt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="gear-arrow">→</span>
                      <label className="gear-tier">
                        <span>Target</span>
                        <select value={t.tgt} onChange={(e) => onTgt(t.lineKey, Number(e.target.value))}>
                          {ctiers.map((tt) => (
                            <option key={tt} value={tt}>
                              T{tt}
                            </option>
                          ))}
                        </select>
                      </label>
                      {upgrading && targetItem ? (
                        <span className="gear-target-name" title="Craft target">
                          {itemName(data, targetItem.key)}
                        </span>
                      ) : (
                        <span className="gear-maxed">at target</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );
}
