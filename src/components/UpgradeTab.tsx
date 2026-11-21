import { useEffect, useMemo, useState } from "react";
import type { GameData, ItemKey } from "../data";
import { type Build, type Target, emptyBuild, targetId } from "../model";
import { planBuild } from "../engine";
import { Picker } from "./Picker";
import { TargetList } from "./TargetList";
import { PlanView } from "./PlanView";

// Tier -> name adjective used by BitCraft buildings/items.
const ADJ: Record<number, string> = {
  1: "Rough",
  2: "Simple",
  3: "Sturdy",
  4: "Fine",
  5: "Exquisite",
  6: "Peerless",
  7: "Ornate",
  8: "Pristine",
  9: "Magnificent",
  10: "Flawless",
};
const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STATION_RE = /Station|Loom|Kiln|Smelter|Oven|Tanning|Workbench|Forge|Press|Wheel|Research Desk|Altar/i;

export function UpgradeTab({
  data,
  storage,
  onRefresh,
}: {
  data: GameData;
  storage?: Record<ItemKey, number> | null;
  onRefresh: () => void;
}) {
  const [tier, setTier] = useState<number | null>(null);
  const [build, setBuild] = useState<Build>(emptyBuild());
  const [chosen, setChosen] = useState<Record<ItemKey, number>>({});
  const [overrides, setOverrides] = useState<Record<ItemKey, number>>({});

  function stationsForTier(t: number): Target[] {
    const adj = ADJ[t];
    if (!adj) return [];
    return data.buildings
      .filter((b) => b.n.startsWith(adj + " ") && STATION_RE.test(b.n))
      .sort((a, b) => a.n.localeCompare(b.n))
      .map((b) => ({ t: "b", id: b.id, q: 1 }) as Target);
  }

  function selectTier(t: number) {
    setTier(t);
    setBuild({ name: `Tier ${t} stations`, targets: stationsForTier(t) });
  }

  function addTarget(tt: Target) {
    setBuild((b) => {
      const id = targetId(tt);
      if (b.targets.find((x) => targetId(x) === id))
        return { ...b, targets: b.targets.map((x) => (targetId(x) === id ? { ...x, q: x.q + tt.q } : x)) };
      return { ...b, targets: [...b.targets, tt] };
    });
  }
  function setQty(id: string, q: number) {
    setBuild((b) => ({ ...b, targets: b.targets.map((x) => (targetId(x) === id ? { ...x, q: Math.max(0, q) } : x)) }));
  }
  function removeTarget(id: string) {
    setBuild((b) => ({ ...b, targets: b.targets.filter((x) => targetId(x) !== id) }));
  }

  const plan = useMemo(() => planBuild(data, build, chosen), [data, build, chosen]);
  const buildSig = useMemo(
    () => "upg:" + build.targets.map((t) => targetId(t) + ":" + t.q).sort().join("|"),
    [build.targets]
  );

  // Persist hardset overrides for the upgrade build.
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

  const stationCount = build.targets.length;

  return (
    <main className="layout">
      <section className="col-left">
        <div className="panel">
          <div className="panel-head">
            <h2>Settlement upgrade</h2>
          </div>
          <p className="hint">
            Pick a target tier to auto-add one of each station for it, then adjust — add passive
            stations, or remove ones you already have. Research books are tracked separately in the
            Build Planner.
          </p>
          <div className="tier-row">
            <span>Tier</span>
            {TIERS.map((t) => (
              <button key={t} className={tier === t ? "tchip on" : "tchip"} onClick={() => selectTier(t)}>
                {t}
              </button>
            ))}
          </div>

          {tier && (
            <p className="muted small" style={{ marginTop: 10 }}>
              {stationCount} {stationCount === 1 ? "station" : "stations"} for the <b>{ADJ[tier]}</b> (T{tier}) tier.
              Add more below.
            </p>
          )}

          <Picker data={data} onAdd={addTarget} />
          <TargetList data={data} targets={build.targets} onQty={setQty} onRemove={removeTarget} />
          {build.targets.length > 0 && (
            <button
              className="btn ghost small clear"
              onClick={() => {
                setBuild(emptyBuild());
                setTier(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <section className="col-right">
        {build.targets.length === 0 ? (
          <div className="panel empty">
            <h2>Pick a target tier</h2>
            <p>
              Choose a tier above and BitForge drops in one of each station for it, then totals all
              the build materials divided by profession — with the same hardset, storage and filter
              tools as the Build Planner.
            </p>
            <p className="hint">Need the research books too? Add them in the Build Planner tab.</p>
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
