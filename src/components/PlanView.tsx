import { useEffect, useState } from "react";
import { type GameData, type ItemKey, itemName, recipesFor } from "../data";
import type { Plan, PlanLine } from "../engine";

type View = "profession" | "raw" | "flat";
type Progress = Record<ItemKey, number>;

const PROG_PREFIX = "bitforge:prog:";

export function PlanView({
  data,
  plan,
  chosen,
  onChoose,
  buildSig,
  storage,
  overrides,
  onOverride,
  onRefresh,
}: {
  data: GameData;
  plan: Plan;
  chosen: Record<ItemKey, number>;
  onChoose: (key: ItemKey, idx: number) => void;
  buildSig: string;
  storage?: Record<ItemKey, number> | null;
  overrides: Record<ItemKey, number>;
  onOverride: (key: ItemKey, n: number | null) => void;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<View>("profession");
  const [progress, setProgress] = useState<Progress>({});

  // Load/save progress scoped to this build.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROG_PREFIX + buildSig);
      setProgress(raw ? JSON.parse(raw) : {});
    } catch {
      setProgress({});
    }
  }, [buildSig]);
  function setHave(key: ItemKey, have: number) {
    setProgress((p) => {
      const next = { ...p, [key]: Math.max(0, have) };
      try {
        localStorage.setItem(PROG_PREFIX + buildSig, JSON.stringify(next));
      } catch {
        /* storage may be unavailable; progress just won't persist */
      }
      return next;
    });
  }

  const totalDistinct = plan.lines.length;
  const rawCount = plan.raw.length;
  const professions = plan.byProfession.length;

  function copyText() {
    const txt = planToText(data, plan);
    navigator.clipboard?.writeText(txt).catch(() => prompt("Copy plan:", txt));
  }

  return (
    <div className="plan">
      <div className="panel-head">
        <h2>Materials needed</h2>
        <div className="spacer" />
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
            storage={storage}
            overrides={overrides}
            onOverride={onOverride}
            onRefresh={onRefresh}
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
          storage={storage}
          overrides={overrides}
          onOverride={onOverride}
          onRefresh={onRefresh}
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
          storage={storage}
          overrides={overrides}
          onOverride={onOverride}
          onRefresh={onRefresh}
        />
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
  storage,
  overrides,
  onOverride,
  onRefresh,
}: {
  data: GameData;
  title: string;
  lines: PlanLine[];
  progress: Progress;
  onHave: (key: ItemKey, n: number) => void;
  chosen: Record<ItemKey, number>;
  onChoose: (key: ItemKey, idx: number) => void;
  flatProf?: boolean;
  storage?: Record<ItemKey, number> | null;
  overrides: Record<ItemKey, number>;
  onOverride: (key: ItemKey, n: number | null) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const stored = (key: ItemKey) => (storage ? storage[key] || 0 : 0);
  const hasOverride = (key: ItemKey) => overrides[key] !== undefined;
  // A hardset override wins; otherwise manual progress + pulled storage.
  const effHave = (l: PlanLine) =>
    hasOverride(l.key) ? overrides[l.key] : (progress[l.key] || 0) + stored(l.key);
  const done = lines.filter((l) => effHave(l) >= l.qty).length;
  const pct = lines.length ? Math.round((done / lines.length) * 100) : 0;

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="profblock">
      <div className="profhead">
        <button className="profhead-main" onClick={() => setOpen((o) => !o)}>
          <span className="chev">{open ? "▾" : "▸"}</span>
          <span className="profname" dangerouslySetInnerHTML={{ __html: title }} />
          <span className="profmeta">
            {lines.length} {lines.length === 1 ? "item" : "items"}
          </span>
          <span className="profbar">
            <span className="profbar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="profpct">{pct}%</span>
        </button>
        <button
          className="prof-refresh"
          title="Refresh quantities from storage (keeps your hardset overrides)"
          disabled={refreshing}
          onClick={refresh}
        >
          {refreshing ? "…" : "↻"}
        </button>
      </div>
      {open && (
        <ul className="matlist">
          {lines.map((l) => {
            const eff = effHave(l);
            const complete = eff >= l.qty;
            const remaining = Math.max(0, l.qty - eff);
            const inStore = stored(l.key);
            const have = progress[l.key] || 0;
            const recs = recipesFor(data, l.key);
            const ov = overrides[l.key];
            return (
              <li key={l.key} className={complete ? "mat done" : "mat"}>
                <input
                  type="checkbox"
                  checked={complete}
                  onChange={(e) => onOverride(l.key, e.target.checked ? l.qty : null)}
                  title="Hardset complete"
                />
                <input
                  className="m-override"
                  type="text"
                  inputMode="numeric"
                  value={ov === undefined ? "" : ov}
                  placeholder="set"
                  title="Hardset the amount you have (overrides storage, kept on refresh). Clear to go back to auto."
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    onOverride(l.key, t === "" ? null : Number(t.replace(/[^\d]/g, "")) || 0);
                  }}
                />
                <span className="m-qty" title={eff > 0 ? `${remaining.toLocaleString()} still needed` : undefined}>
                  {eff > 0 && !complete ? remaining.toLocaleString() : l.qty.toLocaleString()}
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
                    className="m-have-input"
                    type="text"
                    inputMode="numeric"
                    value={have || ""}
                    placeholder="0"
                    title="Track what you've gathered (used when no hardset override)"
                    onChange={(e) => onHave(l.key, Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
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
