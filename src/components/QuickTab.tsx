import { useEffect, useMemo, useState } from "react";
import type { GameData, ItemKey } from "../data";
import { type Build, type Target, emptyBuild, targetId } from "../model";
import { planBuild } from "../engine";
import { Picker } from "./Picker";
import { TargetList } from "./TargetList";
import { PlanView } from "./PlanView";

// A throwaway scratch list: add what you're crafting, get the material task list
// divided by profession — without touching (or sharing) your saved build. Kept
// in localStorage so a refresh doesn't lose it, but separate from the main build.
const SCRATCH_LS = "bitforge:scratch";

export function QuickTab({
  data,
  storage,
  onRefresh,
}: {
  data: GameData;
  storage?: Record<ItemKey, number> | null;
  onRefresh: () => void;
}) {
  const [build, setBuild] = useState<Build>(() => {
    try {
      const r = localStorage.getItem(SCRATCH_LS);
      if (r) return JSON.parse(r) as Build;
    } catch {
      /* ignore */
    }
    return emptyBuild();
  });
  const [chosen, setChosen] = useState<Record<ItemKey, number>>({});
  const [overrides, setOverrides] = useState<Record<ItemKey, number>>({});

  function persist(b: Build) {
    setBuild(b);
    try {
      localStorage.setItem(SCRATCH_LS, JSON.stringify(b));
    } catch {
      /* ignore */
    }
  }

  function addTarget(t: Target) {
    persist(
      (() => {
        const id = targetId(t);
        const existing = build.targets.find((x) => targetId(x) === id);
        if (existing)
          return { ...build, targets: build.targets.map((x) => (targetId(x) === id ? { ...x, q: x.q + t.q } : x)) };
        return { ...build, targets: [...build.targets, t] };
      })()
    );
  }
  function setQty(id: string, q: number) {
    persist({ ...build, targets: build.targets.map((x) => (targetId(x) === id ? { ...x, q: Math.max(0, q) } : x)) });
  }
  function removeTarget(id: string) {
    persist({ ...build, targets: build.targets.filter((x) => targetId(x) !== id) });
  }
  function clear() {
    if (build.targets.length && !confirm("Clear this scratch list?")) return;
    persist(emptyBuild());
  }

  const plan = useMemo(() => planBuild(data, build, chosen), [data, build, chosen]);
  const buildSig = useMemo(
    () => "scratch:" + build.targets.map((t) => targetId(t) + ":" + t.q).sort().join("|"),
    [build.targets]
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

  return (
    <main className="layout">
      <section className="col-left">
        <div className="panel">
          <div className="panel-head">
            <h2>Quick craft</h2>
          </div>
          <p className="hint">
            A scratch list for something you're making right now — add items, get the materials by
            profession. It's <b>not</b> added to your saved build or share link.
          </p>
          <Picker data={data} onAdd={addTarget} />
          <TargetList data={data} targets={build.targets} onQty={setQty} onRemove={removeTarget} />
          {build.targets.length > 0 && (
            <button className="btn ghost small clear" onClick={clear}>
              Clear list
            </button>
          )}
        </div>
      </section>

      <section className="col-right">
        {build.targets.length === 0 ? (
          <div className="panel empty">
            <h2>What are you crafting?</h2>
            <p>
              Search any item or building on the left and set a quantity. BitForge totals every
              material you need, divided by profession — a quick task list you can check off, with no
              effect on your main build.
            </p>
            <p className="hint">This list lives only on this device and clears whenever you want.</p>
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
