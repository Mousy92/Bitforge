import { useEffect, useMemo, useState } from "react";
import type { GameData, ItemKey } from "../data";
import { itemName } from "../data";
import { planBuild } from "../engine";
import type { Target } from "../model";
import {
  type GearIndex,
  type GearPiece,
  type GearSubtab,
  SUBTABS,
  buildGearIndex,
  craftableTiers,
  isUpgrade,
  maxCraftableTier,
  pieceForItem,
  professionOf,
  raritiesAtTier,
  recommendedTier,
  resolve,
  stepsBetween,
  tiersOf,
  topRarityAtTier,
} from "../gear";
import { type PlayerSkill, pullEquipment, pullPlayer } from "../backend";
import { PlanView } from "./PlanView";

interface PieceState {
  cur: { t: number; r: string };
  tgt: { t: number; r: string };
}
interface Preset {
  name: string;
  gear: Record<string, PieceState>;
}
interface Member {
  id: string;
  name: string;
  playerId: string;
  presets: Preset[];
  activePreset: number;
  skills: PlayerSkill[];
}

const VILLAGE_LS = "bitforge:village3";
const SUB_LS = "bitforge:gearsub";
const STEP_LS = "bitforge:gearstep";

const uid = () => Math.random().toString(36).slice(2, 9);
const newMember = (name: string): Member => ({
  id: uid(),
  name,
  playerId: "",
  presets: [{ name: "Preset 1", gear: {} }],
  activePreset: 0,
  skills: [],
});

function loadVillage(): Member[] {
  try {
    const r = localStorage.getItem(VILLAGE_LS);
    if (r) {
      const v = JSON.parse(r) as Member[];
      if (Array.isArray(v) && v.length) {
        // normalize any partial shapes
        return v.map((m) => ({
          ...m,
          presets: m.presets?.length ? m.presets : [{ name: "Preset 1", gear: {} }],
          activePreset: Math.min(m.activePreset || 0, (m.presets?.length || 1) - 1),
          skills: m.skills || [],
        }));
      }
    }
  } catch {
    /* ignore */
  }
  return [newMember("Me")];
}

function topTarget(piece: GearPiece): { t: number; r: string } {
  const t = maxCraftableTier(piece);
  return { t, r: topRarityAtTier(piece, t) };
}
const activeGear = (m: Member): Record<string, PieceState> => m.presets[m.activePreset]?.gear ?? {};

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
  const [village, setVillage] = useState<Member[]>(loadVillage);
  const [activeId, setActiveId] = useState<string>(() => loadVillage()[0]?.id ?? "");
  const [sub, setSub] = useState<GearSubtab>(() => {
    try {
      return (localStorage.getItem(SUB_LS) as GearSubtab) || "gear";
    } catch {
      return "gear";
    }
  });
  const [scope, setScope] = useState<string>("all");
  const [stepEach, setStepEachState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STEP_LS) === "1";
    } catch {
      return false;
    }
  });
  const [chosen, setChosen] = useState<Record<ItemKey, number>>({});
  const [overrides, setOverrides] = useState<Record<ItemKey, number>>({});

  function persist(next: Member[]) {
    setVillage(next);
    try {
      localStorage.setItem(VILLAGE_LS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function setStepEach(b: boolean) {
    setStepEachState(b);
    try {
      localStorage.setItem(STEP_LS, b ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  function pickSub(s: GearSubtab) {
    setSub(s);
    try {
      localStorage.setItem(SUB_LS, s);
    } catch {
      /* ignore */
    }
  }

  const active = village.find((m) => m.id === activeId) ?? village[0];
  const subCats = SUBTABS.find((s) => s.id === sub)!.cats;

  function updateMember(id: string, fn: (m: Member) => Member) {
    persist(village.map((m) => (m.id === id ? fn(m) : m)));
  }
  // Edit the active preset's gear of a member.
  function updateGear(id: string, fn: (g: Record<string, PieceState>) => Record<string, PieceState>) {
    updateMember(id, (m) => {
      const presets = m.presets.map((p, i) => (i === m.activePreset ? { ...p, gear: fn(p.gear) } : p));
      return { ...m, presets };
    });
  }
  function addMember() {
    const m = newMember(`Person ${village.length + 1}`);
    persist([...village, m]);
    setActiveId(m.id);
  }
  function removeMember(id: string) {
    const next = village.filter((m) => m.id !== id);
    persist(next.length ? next : [newMember("Me")]);
    if (activeId === id) setActiveId((next[0] ?? loadVillage()[0]).id);
    if (scope === id) setScope("all");
  }

  // Rollup: for each member in scope, use their ACTIVE preset's gear.
  const build = useMemo(() => {
    const qty = new Map<ItemKey, number>();
    const members = scope === "all" ? village : village.filter((m) => m.id === scope);
    for (const m of members) {
      for (const [pk, st] of Object.entries(activeGear(m))) {
        const piece = index.pieces.get(pk);
        if (!piece || !isUpgrade(st.cur.t, st.cur.r, st.tgt.t, st.tgt.r)) continue;
        const items =
          stepEach && st.tgt.t > st.cur.t
            ? stepsBetween(piece, st.cur.t, st.tgt.t, st.tgt.r)
            : [resolve(piece, st.tgt.t, st.tgt.r)].filter(Boolean);
        for (const it of items) if (it) qty.set(it.key, (qty.get(it.key) || 0) + 1);
      }
    }
    const targets: Target[] = [...qty.entries()].map(([k, q]) => ({ t: "i", k, q }));
    return { name: "Gear upgrades", targets };
  }, [village, scope, stepEach, index]);

  const plan = useMemo(() => planBuild(data, build, chosen), [data, build, chosen]);
  const buildSig = useMemo(
    () =>
      "gearv:" +
      scope +
      (stepEach ? ":step" : "") +
      ":" +
      build.targets.map((t) => `${"k" in t ? t.k : t.id}:${t.q}`).sort().join("|"),
    [build, scope, stepEach]
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

  const upgradeCount = build.targets.length;

  return (
    <main className="layout">
      <section className="col-left">
        <MemberBar village={village} activeId={active?.id ?? ""} onSelect={setActiveId} onAdd={addMember} />

        {active && (
          <MemberPanel
            key={active.id}
            data={data}
            index={index}
            member={active}
            onUpdate={(fn) => updateMember(active.id, fn)}
            onRemove={() => removeMember(active.id)}
            canRemove={village.length > 1}
          />
        )}

        {active && (
          <PresetTabs
            member={active}
            onSelect={(i) => updateMember(active.id, (m) => ({ ...m, activePreset: i }))}
            onAdd={() =>
              updateMember(active.id, (m) => ({
                ...m,
                presets: [...m.presets, { name: `Preset ${m.presets.length + 1}`, gear: {} }],
                activePreset: m.presets.length,
              }))
            }
            onRemove={(i) =>
              updateMember(active.id, (m) => {
                if (m.presets.length <= 1) return m;
                const presets = m.presets.filter((_, j) => j !== i);
                return { ...m, presets, activePreset: Math.min(m.activePreset, presets.length - 1) };
              })
            }
          />
        )}

        <div className="gear-subtabs">
          {SUBTABS.map((s) => (
            <button key={s.id} className={sub === s.id ? "gsub on" : "gsub"} onClick={() => pickSub(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        {active && (
          <>
            <AddGear
              index={index}
              cats={subCats}
              owned={activeGear(active)}
              onAdd={(piece) =>
                updateGear(active.id, (g) => ({
                  ...g,
                  [piece.pieceKey]: {
                    cur: { t: tiersOf(piece)[0] ?? 1, r: raritiesAtTier(piece, tiersOf(piece)[0] ?? 1)[0] || "Common" },
                    tgt: topTarget(piece),
                  },
                }))
              }
            />
            <TrackingPanel
              data={data}
              index={index}
              member={active}
              cats={subCats}
              stepEach={stepEach}
              onStepEach={setStepEach}
              chosen={chosen}
              onGear={(fn) => updateGear(active.id, fn)}
            />
          </>
        )}
      </section>

      <section className="col-right">
        <div className="gear-scope">
          <span className="muted small">Shopping list for:</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Whole village ({village.length})</option>
            {village.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span className="muted small gear-scope-note">
            (each person's <b>{active?.presets[active.activePreset]?.name ?? "active"}</b> preset)
          </span>
        </div>
        {upgradeCount === 0 ? (
          <div className="panel empty">
            <h2>Track gear upgrades for your village</h2>
            <p>
              Add people, pull their gear &amp; levels from Bitjita (all three loadout presets), and
              set the tier and <b>rarity</b> you want each piece to reach. BitForge totals every
              upgrade's materials and <b>divides them by profession</b>.
            </p>
            <p className="hint">
              New pieces default to their top craftable tier &amp; rarity, so you'll see what it
              takes to max out. The shopping list sums the active preset of each person in scope.
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

function MemberBar({
  village,
  activeId,
  onSelect,
  onAdd,
}: {
  village: Member[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const count = (m: Member) => m.presets.reduce((s, p) => s + Object.keys(p.gear).length, 0);
  return (
    <div className="member-bar">
      {village.map((m) => (
        <button
          key={m.id}
          className={m.id === activeId ? "member-chip on" : "member-chip"}
          onClick={() => onSelect(m.id)}
        >
          {m.name}
          <span className="member-count">{count(m)}</span>
        </button>
      ))}
      <button className="member-add" onClick={onAdd} title="Add a person">
        + Person
      </button>
    </div>
  );
}

function PresetTabs({
  member,
  onSelect,
  onAdd,
  onRemove,
}: {
  member: Member;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="preset-tabs">
      {member.presets.map((p, i) => (
        <span key={i} className={i === member.activePreset ? "preset-tab on" : "preset-tab"}>
          <button className="preset-tab-btn" onClick={() => onSelect(i)}>
            {p.name}
            <span className="preset-count">{Object.keys(p.gear).length}</span>
          </button>
          {member.presets.length > 1 && (
            <button className="preset-x" onClick={() => onRemove(i)} title="Remove preset">
              ×
            </button>
          )}
        </span>
      ))}
      <button className="preset-add" onClick={onAdd} title="Add a preset">
        +
      </button>
    </div>
  );
}

function MemberPanel({
  data,
  index,
  member,
  onUpdate,
  onRemove,
  canRemove,
}: {
  data: GameData;
  index: GearIndex;
  member: Member;
  onUpdate: (fn: (m: Member) => Member) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showLevels, setShowLevels] = useState(false);

  async function pull() {
    const id = member.playerId.trim();
    if (!/^\d{5,25}$/.test(id)) {
      setMsg("Enter a numeric player ID (from bitjita.com/players/…).");
      return;
    }
    setBusy(true);
    setMsg(null);
    const [eq, prof] = await Promise.all([pullEquipment(data, id), pullPlayer(id)]);
    setBusy(false);
    if (!eq && !prof) {
      setMsg("Couldn't reach Bitjita for that player. Check the ID.");
      return;
    }
    onUpdate((m) => {
      const presets: Preset[] = [...m.presets];
      (eq?.presets ?? []).forEach((pp, i) => {
        const existing = presets[i] ?? { name: pp.name, gear: {} };
        const gear = { ...existing.gear };
        for (const it of pp.items) {
          const piece = pieceForItem(data, index, it.key);
          if (!piece) continue;
          const tier = it.tier && it.tier > 0 ? it.tier : tiersOf(piece)[0] ?? 1;
          const cur = { t: tier, r: it.rarity || raritiesAtTier(piece, tier)[0] || "Common" };
          gear[piece.pieceKey] = { cur, tgt: existing.gear[piece.pieceKey]?.tgt ?? topTarget(piece) };
        }
        presets[i] = { name: pp.name || existing.name, gear };
      });
      return {
        ...m,
        presets,
        skills: prof?.skills?.length ? prof.skills : m.skills,
        name: (m.name === "Me" || /^Person \d+$/.test(m.name)) && prof?.name ? prof.name : m.name,
      };
    });
    const parts: string[] = [];
    if (eq) parts.push(`${eq.count} pieces in ${eq.presets.length} preset${eq.presets.length === 1 ? "" : "s"}`);
    if (prof?.skills.length) parts.push(`${prof.skills.length} skills`);
    setMsg(parts.length ? `Pulled ${parts.join(" + ")}.` : "Reached Bitjita but found no gear/skills for that player.");
  }

  const topSkills = [...member.skills].sort((a, b) => b.level - a.level);

  return (
    <div className="panel">
      <div className="panel-head">
        <input
          className="member-name"
          value={member.name}
          onChange={(e) => onUpdate((m) => ({ ...m, name: e.target.value }))}
          placeholder="Name"
        />
        <div className="spacer" />
        {canRemove && (
          <button className="btn ghost small" onClick={onRemove} title="Remove this person">
            Remove
          </button>
        )}
      </div>
      <div className="store-row">
        <input
          className="search"
          placeholder="Bitjita player ID"
          value={member.playerId}
          onChange={(e) => onUpdate((m) => ({ ...m, playerId: e.target.value }))}
          inputMode="numeric"
        />
        <button className="btn primary small" disabled={busy} onClick={pull}>
          {busy ? "Pulling…" : "Pull gear + levels"}
        </button>
      </div>
      {msg && <div className="store-msg">{msg}</div>}
      {member.skills.length > 0 && (
        <div className="levels">
          <button className="levels-head" onClick={() => setShowLevels((s) => !s)}>
            <span className="chev">{showLevels ? "▾" : "▸"}</span>
            Levels ({member.skills.length} skills)
          </button>
          {showLevels && (
            <ul className="levels-list">
              {topSkills.map((s) => (
                <li key={s.name}>
                  <span className="lvl-name">{s.name}</span>
                  <span className="lvl-num">Lv {s.level}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AddGear({
  index,
  cats,
  owned,
  onAdd,
}: {
  index: GearIndex;
  cats: string[];
  owned: Record<string, PieceState>;
  onAdd: (piece: GearPiece) => void;
}) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out: GearPiece[] = [];
    for (const cat of cats) {
      for (const piece of index.byCategory.get(cat as GearPiece["category"]) ?? []) {
        if (owned[piece.pieceKey]) continue;
        if (`${piece.suffix} ${piece.tag}`.toLowerCase().includes(term)) out.push(piece);
        if (out.length > 60) break;
      }
    }
    return out.slice(0, 16);
  }, [q, cats, index, owned]);

  return (
    <div className="panel gear-addpanel">
      <div className="gear-add">
        <input
          className="search"
          placeholder="Add gear… (e.g. axe, shortsword, charm)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="gear-add-results">
            {results.map((piece) => (
              <li key={piece.pieceKey}>
                <button
                  onClick={() => {
                    onAdd(piece);
                    setQ("");
                  }}
                >
                  <span className="gear-add-name">{piece.suffix}</span>
                  <span className="gear-add-meta">{piece.tag}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TrackingPanel({
  data,
  index,
  member,
  cats,
  stepEach,
  onStepEach,
  chosen,
  onGear,
}: {
  data: GameData;
  index: GearIndex;
  member: Member;
  cats: string[];
  stepEach: boolean;
  onStepEach: (b: boolean) => void;
  chosen: Record<ItemKey, number>;
  onGear: (fn: (g: Record<string, PieceState>) => Record<string, PieceState>) => void;
}) {
  const gear = activeGear(member);
  const entries = Object.entries(gear)
    .map(([pk, st]) => ({ piece: index.pieces.get(pk), st, pk }))
    .filter((e) => e.piece && cats.includes(e.piece.category)) as {
    piece: GearPiece;
    st: PieceState;
    pk: string;
  }[];
  entries.sort((a, b) => a.piece.tag.localeCompare(b.piece.tag) || a.piece.suffix.localeCompare(b.piece.suffix));

  function setState(pk: string, st: PieceState) {
    onGear((g) => ({ ...g, [pk]: st }));
  }
  function remove(pk: string) {
    onGear((g) => {
      const next = { ...g };
      delete next[pk];
      return next;
    });
  }
  function maxAll() {
    onGear((g) => {
      const next = { ...g };
      for (const { pk, piece } of entries) next[pk] = { ...next[pk], tgt: topTarget(piece) };
      return next;
    });
  }

  function levelFor(piece: GearPiece): number | null {
    const prof = professionOf(data, piece).toLowerCase();
    if (!prof) return null;
    const s = member.skills.find(
      (x) => x.name.toLowerCase() === prof || x.name.toLowerCase().includes(prof) || prof.includes(x.name.toLowerCase())
    );
    return s ? s.level : null;
  }

  if (!entries.length) {
    return (
      <div className="panel">
        <p className="hint" style={{ margin: 0 }}>
          Nothing tracked here yet for {member.name} — pull from Bitjita or add some above.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{member.name} · {member.presets[member.activePreset]?.name}</h2>
        <div className="spacer" />
        <button className="btn ghost small" onClick={maxAll} title="Set every target to top tier & rarity">
          Max all ★
        </button>
      </div>
      <label className="gear-step-toggle" title="Count crafting every tier on the way up, not just the final one">
        <input type="checkbox" checked={stepEach} onChange={(e) => onStepEach(e.target.checked)} />
        Step through every tier (realistic grind)
      </label>
      <ul className="gear-list">
        {entries.map(({ piece, st, pk }) => (
          <PieceRow
            key={pk}
            data={data}
            piece={piece}
            st={st}
            level={levelFor(piece)}
            stepEach={stepEach}
            chosen={chosen}
            onChange={(next) => setState(pk, next)}
            onRemove={() => remove(pk)}
          />
        ))}
      </ul>
    </div>
  );
}

function PieceRow({
  data,
  piece,
  st,
  level,
  stepEach,
  chosen,
  onChange,
  onRemove,
}: {
  data: GameData;
  piece: GearPiece;
  st: PieceState;
  level: number | null;
  stepEach: boolean;
  chosen: Record<ItemKey, number>;
  onChange: (st: PieceState) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allTiers = tiersOf(piece);
  const ctiers = craftableTiers(piece);
  const upgrading = isUpgrade(st.cur.t, st.cur.r, st.tgt.t, st.tgt.r);
  const rec = level != null ? recommendedTier(data, piece, level) : null;
  const targetItem = resolve(piece, st.tgt.t, st.tgt.r);

  function curTier(t: number) {
    const rs = raritiesAtTier(piece, t, false);
    const r = rs.includes(st.cur.r) ? st.cur.r : rs[0] || "Common";
    onChange({ ...st, cur: { t, r } });
  }
  function curRar(r: string) {
    onChange({ ...st, cur: { ...st.cur, r } });
  }
  function tgtTier(t: number) {
    const rs = raritiesAtTier(piece, t, true);
    const r = rs.includes(st.tgt.r) ? st.tgt.r : rs[rs.length - 1] || "Common";
    onChange({ ...st, tgt: { t, r } });
  }
  function tgtRar(r: string) {
    onChange({ ...st, tgt: { ...st.tgt, r } });
  }
  function setTop() {
    const t = maxCraftableTier(piece);
    onChange({ ...st, tgt: { t, r: topRarityAtTier(piece, t) } });
  }
  function useRec() {
    if (rec == null) return;
    onChange({ ...st, tgt: { t: rec, r: topRarityAtTier(piece, rec) } });
  }

  const curRarities = raritiesAtTier(piece, st.cur.t, false);
  const tgtRarities = raritiesAtTier(piece, st.tgt.t, true);
  const steps = stepEach && st.tgt.t > st.cur.t ? stepsBetween(piece, st.cur.t, st.tgt.t, st.tgt.r) : [];

  const stepCosts = useMemo(() => {
    if (!open) return [];
    const list = steps.length ? steps : targetItem ? [targetItem] : [];
    return list.map((item) => {
      const p = planBuild(data, { name: "", targets: [{ t: "i", k: item.key, q: 1 }] }, chosen);
      return { item, mats: p.lines.length, units: p.lines.reduce((s, l) => s + l.qty, 0) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, st.cur.t, st.tgt.t, st.tgt.r, piece.pieceKey, stepEach, data, chosen]);

  return (
    <li className={upgrading ? "gear-row" : "gear-row flat"}>
      <div className="gear-row-main">
        <button className="gear-expand" onClick={() => setOpen((o) => !o)} title="Per-tier cost breakdown">
          <span className="gear-chev">{open ? "▾" : "▸"}</span>
          <span className="gear-name">
            {piece.suffix}
            <span className="gear-tagmini">{piece.tag}</span>
          </span>
        </button>
        {rec != null && (
          <button
            className={`gear-rec${st.cur.t >= rec ? " ok" : ""}`}
            onClick={useRec}
            title={`At Lv ${level}, this should be about T${rec}. Click to target it.`}
          >
            rec T{rec}
          </button>
        )}
        <button className="gear-x" onClick={onRemove} title="Stop tracking">
          ×
        </button>
      </div>
      <div className="gear-row-tiers">
        <span className="gt-label">Have</span>
        <select className="gt-sel" value={st.cur.t} onChange={(e) => curTier(Number(e.target.value))}>
          {allTiers.map((t) => (
            <option key={t} value={t}>
              T{t}
            </option>
          ))}
        </select>
        <select className="gt-sel rar" value={st.cur.r} onChange={(e) => curRar(e.target.value)}>
          {curRarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span className="gear-arrow">→</span>
        <span className="gt-label">Want</span>
        <select className="gt-sel" value={st.tgt.t} onChange={(e) => tgtTier(Number(e.target.value))}>
          {ctiers.map((t) => (
            <option key={t} value={t}>
              T{t}
            </option>
          ))}
        </select>
        <select className="gt-sel rar" value={st.tgt.r} onChange={(e) => tgtRar(e.target.value)}>
          {tgtRarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="gear-top" onClick={setTop} title="Top craftable tier & rarity">
          ★
        </button>
      </div>
      {upgrading && targetItem && <div className="gear-target-name">→ {itemName(data, targetItem.key)}</div>}
      {open && stepCosts.length > 0 && (
        <ol className="gear-steps">
          {stepCosts.map(({ item, mats, units }) => (
            <li key={item.key}>
              <span className="gear-step-tier">T{item.tier}</span>
              <span className="gear-step-name">{itemName(data, item.key)}</span>
              <span className="gear-step-cost">
                {mats.toLocaleString()} mats · {units.toLocaleString()} units
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
