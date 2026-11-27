import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  type GameData,
  type ItemKey,
  canonKey,
  itemName,
  professionFor,
  recipesFor,
} from "../data";
import type { Plan, PlanLine } from "../engine";

type View = "profession" | "raw" | "flat" | "tree" | "step";
type Progress = Record<ItemKey, number>;

const PROG_PREFIX = "bitforge:prog:";

/** Keys whose total requirement is met — struck through in rows and sub-lists. */
const DoneContext = createContext<Set<ItemKey>>(new Set());

// Processing-depth labels: 0 = gathered, 1 = made from raw, etc.
function depthLabel(d: number): string {
  return (
    ["Raw / gathered", "Single-processed", "Double-processed", "Triple-processed"][d] ??
    `${d}× processed`
  );
}
function depthBadge(d: number): string {
  return d === 0 ? "raw" : `×${d}`;
}
function groupByDepth(lines: PlanLine[]): Map<number, PlanLine[]> {
  const m = new Map<number, PlanLine[]>();
  for (const l of lines) {
    if (!m.has(l.depth)) m.set(l.depth, []);
    m.get(l.depth)!.push(l);
  }
  return m;
}

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
  roots,
  treeDefault,
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
  /** Top-level items (recipe-tree roots). When set, a "Recipe tree" view is offered. */
  roots?: { key: ItemKey; qty: number }[];
  treeDefault?: boolean;
}) {
  const [view, setView] = useState<View>(treeDefault && roots && roots.length ? "tree" : "profession");
  const [progress, setProgress] = useState<Progress>({});
  const [filter, setFilter] = useState("");
  const [hideDone, setHideDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bitforge:hidedone") === "1";
    } catch {
      return false;
    }
  });
  function toggleHideDone(v: boolean) {
    setHideDone(v);
    try {
      localStorage.setItem("bitforge:hidedone", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  // Collapse state per profession section (by index). Collapsed = in the set.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  function toggleSection(i: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }
  function scrollToProf(i: number) {
    document.getElementById("profsec-" + i)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Jump: open only this section, collapse the rest, then scroll to it.
  function soloSection(i: number, count: number) {
    const next = new Set<number>();
    for (let j = 0; j < count; j++) if (j !== i) next.add(j);
    setCollapsed(next);
    setTimeout(() => scrollToProf(i), 40);
  }

  // Floating "back to top" that also names the section you're currently in.
  const [scrolled, setScrolled] = useState(false);
  const [curProf, setCurProf] = useState("");
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 260);
      let cur = "";
      for (let i = 0; i < plan.byProfession.length; i++) {
        const el = document.getElementById("profsec-" + i);
        if (el && el.getBoundingClientRect().top <= 140) cur = plan.byProfession[i].profession;
      }
      setCurProf(cur);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [plan.byProfession, view]);

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

  // Overall progress across the whole build. Uses the same per-line "have"
  // logic as the sections: a hardset override wins, else tracked + pulled storage.
  const storedAt = (key: ItemKey) => (storage ? storage[key] || 0 : 0);
  const effHaveTop = (l: PlanLine) =>
    overrides[l.key] !== undefined ? overrides[l.key] : (progress[l.key] || 0) + storedAt(l.key);
  const doneLines = plan.lines.filter((l) => effHaveTop(l) >= l.qty).length;
  const itemPct = plan.lines.length ? Math.round((doneLines / plan.lines.length) * 100) : 0;
  // Keys whose total requirement is met — struck through everywhere (rows + sub-lists).
  const doneKeys = useMemo(() => {
    const s = new Set<ItemKey>();
    for (const l of plan.lines) if (effHaveTop(l) >= l.qty) s.add(canonKey(data, l.key));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.lines, progress, overrides, storage, data]);
  const totalUnits = plan.lines.reduce((s, l) => s + l.qty, 0);
  const haveUnits = plan.lines.reduce((s, l) => s + Math.min(effHaveTop(l), l.qty), 0);
  const unitPct = totalUnits ? Math.round((haveUnits / totalUnits) * 100) : 0;

  function copyText() {
    const txt = planToText(data, plan);
    navigator.clipboard?.writeText(txt).catch(() => prompt("Copy plan:", txt));
  }

  return (
    <DoneContext.Provider value={doneKeys}>
    <div className="plan">
      <div className="panel-head">
        <h2>Materials needed</h2>
        <div className="spacer" />
        <button className="btn ghost small" onClick={copyText}>
          Copy as text
        </button>
      </div>

      <div className="overall">
        <div className="overall-top">
          <span className="overall-pct">{itemPct}%</span>
          <span className="overall-label">
            <b>{doneLines.toLocaleString()}</b> of <b>{plan.lines.length.toLocaleString()}</b> materials complete
          </span>
          <span className="spacer" />
          <span className="overall-units" title="Share of total material units you have (counts partials)">
            {unitPct}% of units ({haveUnits.toLocaleString()}/{totalUnits.toLocaleString()})
          </span>
        </div>
        <span className="overall-bar">
          <span className="overall-bar-fill" style={{ width: `${itemPct}%` }} />
          <span className="overall-bar-units" style={{ width: `${unitPct}%` }} />
        </span>
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
        {roots && roots.length > 0 && (
          <button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>
            Recipe tree
          </button>
        )}
        <button className={view === "profession" ? "on" : ""} onClick={() => setView("profession")}>
          By profession
        </button>
        <button className={view === "raw" ? "on" : ""} onClick={() => setView("raw")}>
          Raw materials ({rawCount})
        </button>
        <button className={view === "step" ? "on" : ""} onClick={() => setView("step")}>
          By step
        </button>
        <button className={view === "flat" ? "on" : ""} onClick={() => setView("flat")}>
          Everything
        </button>
      </div>

      <div className="mat-filter">
        <input
          className="search"
          placeholder="Filter materials… (e.g. plank, ink, ingot)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button className="mat-filter-x" onClick={() => setFilter("")} title="Clear filter">
            ×
          </button>
        )}
        {filter.trim() && (
          <span className="mat-filter-count">
            {plan.lines.filter((l) => l.name.toLowerCase().includes(filter.trim().toLowerCase())).length}{" "}
            match
          </span>
        )}
        <label className="hidedone-toggle" title="Hide materials you've already finished">
          <input type="checkbox" checked={hideDone} onChange={(e) => toggleHideDone(e.target.checked)} />
          Hide completed
        </label>
      </div>

      {view === "profession" && plan.byProfession.length > 1 && (
        <div className="prof-jump">
          <span className="prof-jump-label">Jump to:</span>
          {plan.byProfession.map((g, i) => {
            const done = g.lines.filter((l) => effHaveTop(l) >= l.qty).length;
            const haveU = g.lines.reduce((s, l) => s + Math.min(effHaveTop(l), l.qty), 0);
            const totalU = g.lines.reduce((s, l) => s + l.qty, 0);
            const pct = totalU ? Math.round((haveU / totalU) * 100) : 0;
            if (hideDone && done >= g.lines.length) return null;
            return (
              <button
                key={g.profession}
                className="prof-jump-chip"
                onClick={() => soloSection(i, plan.byProfession.length)}
                title={`Show only ${g.profession}`}
              >
                <span dangerouslySetInnerHTML={{ __html: g.profession }} />
                <em className={pct === 100 ? "done" : ""}>{pct}%</em>
              </button>
            );
          })}
          {collapsed.size > 0 && (
            <button className="prof-jump-all" onClick={() => setCollapsed(new Set())} title="Expand every section">
              Expand all
            </button>
          )}
        </div>
      )}

      {plan.warnings.length > 0 && (
        <div className="warnings">
          {plan.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {view === "profession" &&
        plan.byProfession.map((g, i) => (
          <ProfessionBlock
            key={g.profession}
            anchor={"profsec-" + i}
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
            filter={filter}
            hideDone={hideDone}
            open={!collapsed.has(i)}
            onToggleOpen={() => toggleSection(i)}
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
          filter={filter}
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
          storage={storage}
          overrides={overrides}
          onOverride={onOverride}
          onRefresh={onRefresh}
          filter={filter}
          hideDone={hideDone}
        />
      )}

      {view === "step" &&
        [...groupByDepth(plan.lines).entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([d, ls]) => (
            <ProfessionBlock
              key={"step" + d}
              data={data}
              title={depthLabel(d)}
              lines={ls}
              progress={progress}
              onHave={setHave}
              chosen={chosen}
              onChoose={onChoose}
              flatProf
              storage={storage}
              overrides={overrides}
              onOverride={onOverride}
              onRefresh={onRefresh}
              filter={filter}
              hideDone={hideDone}
            />
          ))}

      {view === "tree" && roots && (
        <ul className="prereq treeroot-list">
          {roots.map((r, i) => (
            <TreeRoot key={i + ":" + r.key} data={data} rootKey={r.key} qty={r.qty} chosen={chosen} />
          ))}
        </ul>
      )}

      {scrolled && (
        <button
          className="backtotop"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Back to top"
        >
          {curProf && <span className="btt-prof" dangerouslySetInnerHTML={{ __html: curProf }} />}
          <span className="btt-arrow">↑ Top</span>
        </button>
      )}
    </div>
    </DoneContext.Provider>
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
  filter,
  hideDone,
  anchor,
  open,
  onToggleOpen,
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
  filter?: string;
  hideDone?: boolean;
  anchor?: string;
  open?: boolean;
  onToggleOpen?: () => void;
}) {
  const [openLocal, setOpenLocal] = useState(true);
  const controlled = open !== undefined;
  const openState = controlled ? open : openLocal;
  const toggleOpen = () => (controlled ? onToggleOpen?.() : setOpenLocal((o) => !o));
  // Per-section hide-completed: null = follow the global toggle, else override it.
  const [localHide, setLocalHide] = useState<boolean | null>(null);
  const effHide = localHide === null ? !!hideDone : localHide;
  const [refreshing, setRefreshing] = useState(false);
  const stored = (key: ItemKey) => (storage ? storage[key] || 0 : 0);
  const hasOverride = (key: ItemKey) => overrides[key] !== undefined;
  // A hardset override wins; otherwise manual progress + pulled storage.
  const effHave = (l: PlanLine) =>
    hasOverride(l.key) ? overrides[l.key] : (progress[l.key] || 0) + stored(l.key);
  const term = (filter || "").trim().toLowerCase();
  let shown = term ? lines.filter((l) => l.name.toLowerCase().includes(term)) : lines;
  if (effHide) shown = shown.filter((l) => effHave(l) < l.qty);
  // Hide a section with nothing to show (no matches, or all done when hiding completed).
  if ((term || effHide) && shown.length === 0) return null;
  const isOpen = term ? true : openState;
  const done = lines.filter((l) => effHave(l) >= l.qty).length;
  // Unit-weighted progress, so partial amounts (storage/tracked) show up — not
  // just fully-finished lines.
  const haveU = lines.reduce((s, l) => s + Math.min(effHave(l), l.qty), 0);
  const totalU = lines.reduce((s, l) => s + l.qty, 0);
  const pct = totalU ? Math.round((haveU / totalU) * 100) : 0;

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="profblock" id={anchor}>
      <div className="profhead">
        <button className="profhead-main" onClick={toggleOpen}>
          <span className="chev">{isOpen ? "▾" : "▸"}</span>
          <span className="profname" dangerouslySetInnerHTML={{ __html: title }} />
          <span className="profmeta">
            {term
              ? `${shown.length} of ${lines.length}`
              : effHide
                ? `${shown.length} left of ${lines.length}`
                : `${lines.length} ${lines.length === 1 ? "item" : "items"}`}
          </span>
          <span className="profbar">
            <span className="profbar-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="profpct">{pct}%</span>
        </button>
        <button
          className={effHide ? "prof-hide on" : "prof-hide"}
          title={effHide ? "Showing only unfinished — click to show completed" : "Hide completed in this section"}
          onClick={() => setLocalHide(!effHide)}
        >
          {effHide ? "🙈" : "👁"}
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
      {isOpen && (
        <ul className="matlist">
          {shown.map((l) => (
            <MatRow
              key={l.key}
              data={data}
              l={l}
              eff={effHave(l)}
              inStore={stored(l.key)}
              have={progress[l.key] || 0}
              ov={overrides[l.key]}
              chosen={chosen}
              onChoose={onChoose}
              onOverride={onOverride}
              onHave={onHave}
              flatProf={flatProf}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MatRow({
  data,
  l,
  eff,
  inStore,
  have,
  ov,
  chosen,
  onChoose,
  onOverride,
  onHave,
  flatProf,
}: {
  data: GameData;
  l: PlanLine;
  eff: number;
  inStore: number;
  have: number;
  ov: number | undefined;
  chosen: Record<ItemKey, number>;
  onChoose: (key: ItemKey, idx: number) => void;
  onOverride: (key: ItemKey, n: number | null) => void;
  onHave: (key: ItemKey, n: number) => void;
  flatProf?: boolean;
}) {
  const [showReq, setShowReq] = useState(false);
  const complete = eff >= l.qty;
  const remaining = Math.max(0, l.qty - eff);
  const recs = recipesFor(data, l.key);

  return (
    <li className={complete ? "mat done" : "mat"}>
      <div className="mat-main">
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
          {l.craftable ? (
            <button
              className="m-expand"
              onClick={() => setShowReq((s) => !s)}
              title="Show prerequisite materials"
            >
              <span className="m-expand-chev">{showReq ? "▾" : "▸"}</span>
              {l.name}
            </button>
          ) : (
            l.name
          )}
          {l.tier > 0 && <span className="m-tier">T{l.tier}</span>}
          <span
            className={`m-depth d${Math.min(l.depth, 4)}`}
            title={depthLabel(l.depth)}
          >
            {depthBadge(l.depth)}
          </span>
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
      </div>
      {showReq && l.craftable && (
        <Prereqs data={data} keyId={l.key} qty={l.qty} chosen={chosen} depth={0} path={new Set()} />
      )}
    </li>
  );
}

/** The direct ingredients needed to craft `qty` of `keyId`, each expandable further. */
/** A top-level recipe-tree root: the item itself, with its direct ingredients shown. */
function TreeRoot({
  data,
  rootKey,
  qty,
  chosen,
}: {
  data: GameData;
  rootKey: ItemKey;
  qty: number;
  chosen: Record<ItemKey, number>;
}) {
  const done = useContext(DoneContext);
  const rk = canonKey(data, rootKey);
  const it = data.items[rk];
  const prof = professionFor(data, rk, chosen);
  const craftable = recipesFor(data, rk).length > 0;
  return (
    <li className={done.has(rk) ? "prereq-node tree-root done" : "prereq-node tree-root"}>
      <div className="prereq-row">
        <span className="prereq-toggle dim">◆</span>
        <span className="prereq-qty">{qty.toLocaleString()}</span>
        <span className="prereq-name">
          <b>{it?.n ?? rk}</b>
          {it && it.t > 0 && <span className="m-tier">T{it.t}</span>}
          <span className="prereq-prof">{prof}</span>
        </span>
      </div>
      {craftable && <Prereqs data={data} keyId={rk} qty={qty} chosen={chosen} depth={0} path={new Set()} />}
    </li>
  );
}

function Prereqs({
  data,
  keyId,
  qty,
  chosen,
  depth,
  path,
}: {
  data: GameData;
  keyId: ItemKey;
  qty: number;
  chosen: Record<ItemKey, number>;
  depth: number;
  path: Set<ItemKey>;
}) {
  const rk = canonKey(data, keyId);
  const recs = recipesFor(data, rk);
  if (!recs.length) return null;
  const idx = Math.min(chosen[rk] ?? 0, recs.length - 1);
  const r = recs[idx];
  const batches = Math.ceil(qty / (r.out || 1));
  const nextPath = new Set(path);
  nextPath.add(rk);
  return (
    <ul className="prereq">
      {r.mats.map(([k, id, q]) => (
        <PrereqNode
          key={`${k}${id}`}
          data={data}
          keyId={`${k}${id}`}
          qty={q * batches}
          chosen={chosen}
          depth={depth + 1}
          path={nextPath}
        />
      ))}
    </ul>
  );
}

function PrereqNode({
  data,
  keyId,
  qty,
  chosen,
  depth,
  path,
}: {
  data: GameData;
  keyId: ItemKey;
  qty: number;
  chosen: Record<ItemKey, number>;
  depth: number;
  path: Set<ItemKey>;
}) {
  const [open, setOpen] = useState(false);
  const done = useContext(DoneContext);
  const rk = canonKey(data, keyId);
  const it = data.items[rk];
  const recs = recipesFor(data, rk);
  // A node is a dead end for the tree if it's raw, already on the path (cycle), or too deep.
  const expandable = recs.length > 0 && !path.has(rk) && depth < 40;
  const prof = professionFor(data, rk, chosen);
  const isDone = done.has(rk);
  return (
    <li className={isDone ? "prereq-node done" : "prereq-node"}>
      <div className="prereq-row">
        {expandable ? (
          <button className="prereq-toggle" onClick={() => setOpen((o) => !o)} title="Show its ingredients">
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="prereq-toggle dim">{recs.length ? "↻" : "•"}</span>
        )}
        <span className="prereq-qty">{qty.toLocaleString()}</span>
        <span className="prereq-name">
          {it?.n ?? rk}
          {it && it.t > 0 && <span className="m-tier">T{it.t}</span>}
          <span className="prereq-prof">{prof}</span>
        </span>
      </div>
      {open && expandable && (
        <Prereqs data={data} keyId={rk} qty={qty} chosen={chosen} depth={depth} path={path} />
      )}
    </li>
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
