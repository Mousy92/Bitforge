import { useState } from "react";
import { type GameData, type ItemKey, itemName, recipesFor } from "../data";
import type { Plan, PlanLine } from "../engine";

type View = "profession" | "raw" | "flat";
type Progress = Record<ItemKey, number>;

export function PlanView({
  data,
  plan,
  chosen,
  onChoose,
  progress,
  onHave,
}: {
  data: GameData;
  plan: Plan;
  chosen: Record<ItemKey, number>;
  onChoose: (key: ItemKey, idx: number) => void;
  progress: Progress;
  onHave: (key: ItemKey, n: number) => void;
}) {
  const [view, setView] = useState<View>("profession");
  const setHave = onHave;
  const [hideDone, setHideDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bitforge:hidedone") !== "0";
    } catch {
      return true;
    }
  });
  function toggleHideDone(b: boolean) {
    setHideDone(b);
    try {
      localStorage.setItem("bitforge:hidedone", b ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const totalDistinct = plan.lines.length;
  const rawCount = plan.raw.length;
  const professions = plan.byProfession.length;
  const effTop = (l: PlanLine) => (progress[l.key] || 0) + l.onHand;
  const remaining = plan.lines.filter((l) => effTop(l) < l.qty).length;

  function copyText() {
    const txt = planToText(data, plan);
    navigator.clipboard?.writeText(txt).catch(() => prompt("Copy plan:", txt));
  }

  return (
    <div className="plan">
      <div className="panel-head">
        <h2>Materials needed</h2>
        <div className="spacer" />
        <label className="hide-done" title="Hide items you've fully gathered or already have in storage">
          <input type="checkbox" checked={hideDone} onChange={(e) => toggleHideDone(e.target.checked)} />
          Hide completed
        </label>
        <button className="btn ghost small" onClick={copyText}>
          Copy as text
        </button>
      </div>

      <div className="stats">
        <Stat n={plan.builds.reduce((s, b) => s + b.qty, 0)} label="to build" />
        <Stat n={totalDistinct} label="materials" />
        <Stat n={professions} label="professions" />
        <Stat n={rawCount} label="raw/gathered" />
      </div>

      {plan.builds.length > 0 && (
        <div className="builds-summary">
          {plan.builds.map((b) => (
            <span key={b.id} className="build-chip">
              {b.qty}× {b.name}
              <em>
                {b.profession} {b.level > 1 ? `L${b.level}` : ""}
              </em>
            </span>
          ))}
        </div>
      )}

      <div className="viewtabs">
        <button className={view === "profession" ? "on" : ""} onClick={() => setView("profession")}>
          By profession
        </button>
        <button className={view === "raw" ? "on" : ""} onClick={() => setView("raw")}>
          Raw materials ({rawCount})
        </button>
        <button className={view === "flat" ? "on" : ""} onClick={() => setView("flat")}>
          Everything
        </button>
      </div>

      {plan.warnings.length > 0 && (
        <div className="warnings">
          {plan.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {hideDone && remaining === 0 && (
        <div className="done-banner">
          ✅ Everything's gathered or already in storage — nothing left to collect!
        </div>
      )}

      {view === "profession" &&
        plan.byProfession.map((g) => (
          <ProfessionBlock
            key={g.profession}
            data={data}
            title={g.profession}
            lines={g.lines}
            progress={progress}
            onHave={setHave}
            chosen={chosen}
            onChoose={onChoose}
            hideDone={hideDone}
          />
        ))}

      {view === "raw" && (
        <ProfessionBlock
          data={data}
          title="Raw &amp; gathered materials"
          lines={plan.raw}
          progress={progress}
          onHave={setHave}
          chosen={chosen}
          onChoose={onChoose}
          flatProf
            hideDone={hideDone}
        />
      )}

      {view === "flat" && (
        <ProfessionBlock
          data={data}
          title="All materials"
          lines={plan.lines}
          progress={progress}
          onHave={setHave}
          chosen={chosen}
          onChoose={onChoose}
          flatProf
          hideDone={hideDone}
        />
      )}

      {plan.consumed.length > 0 && <ConsumedLog consumed={plan.consumed} />}
    </div>
  );
}

function ConsumedLog({ consumed }: { consumed: Plan["consumed"] }) {
  const [open, setOpen] = useState(false);
  const total = consumed.reduce((s, c) => s + c.qty, 0);
  return (
    <div className="profblock consumed">
      <button className="profhead" onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="profname">Consumption log</span>
        <span className="profmeta">
          {consumed.length} materials · {total.toLocaleString()} total used by completed components
        </span>
      </button>
      {open && (
        <ul className="matlist">
          {consumed.map((c) => (
            <li key={c.key} className="mat">
              <span className="m-qty">{c.qty.toLocaleString()}</span>
              <span className="m-name">
                {c.name}
                {c.tier > 0 && <span className="m-tier">T{c.tier}</span>}
                <span className="m-prof">{c.profession}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <span className="stat-n">{n.toLocaleString()}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

function ProfessionBlock({
  data,
  title,
  lines,
  progress,
  onHave,
  chosen,
  onChoose,
  flatProf,
  hideDone,
}: {
  data: GameData;
  title: string;
  lines: PlanLine[];
  progress: Progress;
  onHave: (key: ItemKey, n: number) => void;
  chosen: Record<ItemKey, number>;
  onChoose: (key: ItemKey, idx: number) => void;
  flatProf?: boolean;
  hideDone?: boolean;
}) {
  const [open, setOpen] = useState(true);
  // on-hand (from pulled storage) is already applied in the engine as l.onHand.
  const effHave = (l: PlanLine) => (progress[l.key] || 0) + l.onHand;
  const done = lines.filter((l) => effHave(l) >= l.qty).length;
  const pct = lines.length ? Math.round((done / lines.length) * 100) : 0;
  const visible = hideDone ? lines.filter((l) => effHave(l) < l.qty) : lines;
  // When hiding completed items, drop a fully-finished section entirely.
  if (hideDone && visible.length === 0) return null;

  return (
    <div className="profblock">
      <button className="profhead" onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="profname" dangerouslySetInnerHTML={{ __html: title }} />
        <span className="profmeta">
          {hideDone && visible.length !== lines.length
            ? `${visible.length} left · ${lines.length} total`
            : `${lines.length} ${lines.length === 1 ? "item" : "items"}`}
        </span>
        <span className="profbar">
          <span className="profbar-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="profpct">{pct}%</span>
      </button>
      {open && (
        <ul className="matlist">
          {visible.map((l) => {
            const have = progress[l.key] || 0;
            const inStore = l.onHand;
            const eff = have + inStore;
            const complete = eff >= l.qty;
            const remaining = Math.max(0, l.qty - eff);
            const recs = recipesFor(data, l.key);
            return (
              <li key={l.key} className={complete ? "mat done" : "mat"}>
                <input
                  type="checkbox"
                  checked={complete}
                  onChange={(e) => onHave(l.key, e.target.checked ? l.qty : 0)}
                  title="Mark complete"
                />
                <span className="m-qty" title={inStore ? `${remaining.toLocaleString()} still needed` : undefined}>
                  {inStore && !complete ? remaining.toLocaleString() : l.qty.toLocaleString()}
                </span>
                <span className="m-name">
                  {l.name}
                  {l.tier > 0 && <span className="m-tier">T{l.tier}</span>}
                  {flatProf && <span className="m-prof">{l.profession}</span>}
                  {l.craftable && l.craftAt && (
                    <span className="m-at" title="Crafting station">
                      @ {l.craftAt}
                    </span>
                  )}
                  {recs.length > 1 && (
                    <select
                      className="m-recipe"
                      value={chosen[l.key] ?? 0}
                      onChange={(e) => onChoose(l.key, Number(e.target.value))}
                      title="Choose recipe"
                    >
                      {recs.map((r, i) => (
                        <option key={i} value={i}>
                          via {r.mats.map(([k, id]) => itemName(data, `${k}${id}`)).join(" + ").slice(0, 40)}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
                <span className="m-have">
                  {inStore > 0 && (
                    <span className="m-store" title="In your pulled storage">
                      📦 {inStore.toLocaleString()}
                    </span>
                  )}
                  <input
                    type="number"
                    min={0}
                    value={have || ""}
                    placeholder="0"
                    onChange={(e) => onHave(l.key, Number(e.target.value) || 0)}
                  />
                  <span className="m-have-sep">/ {l.qty.toLocaleString()}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function planToText(data: GameData, plan: Plan): string {
  const lines: string[] = [];
  lines.push("BitForge build plan");
  if (plan.builds.length) {
    lines.push("");
    lines.push("Build:");
    for (const b of plan.builds) lines.push(`  ${b.qty}x ${b.name}`);
  }
  for (const g of plan.byProfession) {
    lines.push("");
    lines.push(`== ${g.profession} ==`);
    for (const l of g.lines) {
      lines.push(`  ${l.qty.toLocaleString()}x ${l.name}${l.tier > 0 ? ` (T${l.tier})` : ""}`);
    }
  }
  void data;
  return lines.join("\n");
}
