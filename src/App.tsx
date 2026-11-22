import { useEffect, useMemo, useState } from "react";
import { type GameData, type ItemKey, loadGameData } from "./data";
import { type Build, type Target, emptyBuild, targetId } from "./model";
import { planBuild } from "./engine";
import {
  buildFromHash,
  decodeBuild,
  encodeBuild,
  shareUrl,
  shortIdFromHash,
  shortShareUrl,
  syncHash,
} from "./share";
import { loadBuildRemote, pullInventory, saveBuildRemote } from "./backend";
import { Picker } from "./components/Picker";
import { PlanView } from "./components/PlanView";
import { TargetList } from "./components/TargetList";
import { CookingTab } from "./components/CookingTab";
import { UpgradeTab } from "./components/UpgradeTab";
import { GearTab } from "./components/GearTab";
import { CalcTab } from "./components/CalcTab";

type Tab = "planner" | "cooking" | "upgrade" | "gear" | "calc";

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("planner");
  const [build, setBuild] = useState<Build>(() => buildFromHash() || emptyBuild());
  // chosen recipe index per item key (when multiple recipes exist)
  const [chosen, setChosen] = useState<Record<ItemKey, number>>({});
  // pulled claim storage (canonical keys -> qty), and whether to subtract it.
  // Both persist to localStorage so a Pull survives a refresh.
  const [storage, setStorageState] = useState<Record<ItemKey, number> | null>(() => {
    try {
      const r = localStorage.getItem("bitforge:storage");
      return r ? JSON.parse(r) : null;
    } catch {
      return null;
    }
  });
  const [useStorage, setUseStorageState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bitforge:usestorage") !== "0";
    } catch {
      return true;
    }
  });
  function setStorage(s: Record<ItemKey, number> | null) {
    setStorageState(s);
    try {
      if (s) localStorage.setItem("bitforge:storage", JSON.stringify(s));
      else localStorage.removeItem("bitforge:storage");
    } catch {
      /* storage may be unavailable */
    }
  }
  function setUseStorage(b: boolean) {
    setUseStorageState(b);
    try {
      localStorage.setItem("bitforge:usestorage", b ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  // Hardset overrides: a manually-locked "have" per item that takes precedence
  // over storage and survives storage refreshes. Persisted per build.
  const [overrides, setOverrides] = useState<Record<ItemKey, number>>({});

  // Re-pull storage using the saved claim id, keeping overrides intact.
  async function refreshStorage() {
    if (!data) return;
    let id = "";
    try {
      id = localStorage.getItem("bitforge:claim") || "";
    } catch {
      /* ignore */
    }
    if (!/^\d{5,25}$/.test(id)) return;
    const res = await pullInventory(data, id);
    if (res) setStorage(res.totals);
  }

  useEffect(() => {
    loadGameData().then(setData).catch((e) => setErr(String(e)));
  }, []);

  // If opened via a short link (#s=<id>) and no inline build, fetch the saved one.
  useEffect(() => {
    const sid = shortIdFromHash();
    if (sid && !buildFromHash()) {
      loadBuildRemote(sid).then((b) => {
        if (b) setBuild(b);
      });
    }
  }, []);

  // Keep the URL hash in sync so a refresh / copy always reflects the build.
  useEffect(() => {
    if (build.targets.length || build.name) syncHash(build);
  }, [build]);

  const plan = useMemo(
    () => (data ? planBuild(data, build, chosen) : null),
    [data, build, chosen]
  );
  const buildSig = useBuildSig(build);

  // Load/persist hardset overrides per build.
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

  function addTarget(t: Target) {
    setBuild((b) => {
      const id = targetId(t);
      const existing = b.targets.find((x) => targetId(x) === id);
      if (existing) {
        return {
          ...b,
          targets: b.targets.map((x) =>
            targetId(x) === id ? { ...x, q: x.q + t.q } : x
          ),
        };
      }
      return { ...b, targets: [...b.targets, t] };
    });
  }
  function setQty(id: string, q: number) {
    setBuild((b) => ({
      ...b,
      targets: b.targets.map((x) => (targetId(x) === id ? { ...x, q: Math.max(0, q) } : x)),
    }));
  }
  function removeTarget(id: string) {
    setBuild((b) => ({ ...b, targets: b.targets.filter((x) => targetId(x) !== id) }));
  }
  function clearBuild() {
    if (build.targets.length && !confirm("Clear the whole build?")) return;
    setBuild(emptyBuild());
    history.replaceState(null, "", location.pathname);
  }

  if (err) {
    return (
      <div className="app">
        <Header tab={tab} setTab={setTab} />
        <div className="panel error">
          <p>Couldn't load game data.</p>
          <pre>{err}</pre>
        </div>
      </div>
    );
  }
  if (!data || !plan) {
    return (
      <div className="app">
        <Header tab={tab} setTab={setTab} />
        <div className="loading">Loading BitCraft game data…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header tab={tab} setTab={setTab} data={data} />

      {tab === "planner" ? (
        <main className="layout">
          <section className="col-left">
            <div className="panel">
              <div className="panel-head">
                <h2>Your build</h2>
                <div className="spacer" />
                <ShareBar build={build} />
              </div>
              <input
                className="build-name"
                placeholder="Name this build (optional)…"
                value={build.name}
                onChange={(e) => setBuild((b) => ({ ...b, name: e.target.value }))}
              />
              <Picker data={data} onAdd={addTarget} />
              <TargetList
                data={data}
                targets={build.targets}
                onQty={setQty}
                onRemove={removeTarget}
              />
              {build.targets.length > 0 && (
                <button className="btn ghost small clear" onClick={clearBuild}>
                  Clear build
                </button>
              )}
              <ImportExport build={build} onImport={setBuild} />
            </div>

            <StoragePanel
              data={data}
              storage={storage}
              setStorage={setStorage}
              useStorage={useStorage}
              setUseStorage={setUseStorage}
            />
          </section>

          <section className="col-right">
            {build.targets.length === 0 ? (
              <EmptyState />
            ) : (
              <PlanView
                data={data}
                plan={plan}
                chosen={chosen}
                onChoose={(key, idx) => setChosen((c) => ({ ...c, [key]: idx }))}
                buildSig={buildSig}
                storage={useStorage ? storage : null}
                overrides={overrides}
                onOverride={setOverride}
                onRefresh={refreshStorage}
              />
            )}
          </section>
        </main>
      ) : tab === "cooking" ? (
        <CookingTab data={data} />
      ) : tab === "upgrade" ? (
        <UpgradeTab data={data} storage={useStorage ? storage : null} onRefresh={refreshStorage} />
      ) : tab === "gear" ? (
        <GearTab data={data} storage={useStorage ? storage : null} onRefresh={refreshStorage} />
      ) : (
        <CalcTab data={data} />
      )}

      <Footer data={data} />
    </div>
  );
}

function Header({
  tab,
  setTab,
  data,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  data?: GameData;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo">▲</span>
        <div>
          <h1>BitForge</h1>
          <span className="tagline">BitCraft build &amp; crafting planner</span>
        </div>
      </div>
      <nav className="tabs">
        <button className={tab === "planner" ? "tab active" : "tab"} onClick={() => setTab("planner")}>
          Build Planner
        </button>
        <button className={tab === "cooking" ? "tab active" : "tab"} onClick={() => setTab("cooking")}>
          Cooking
        </button>
        <button className={tab === "upgrade" ? "tab active" : "tab"} onClick={() => setTab("upgrade")}>
          Upgrade Planner
        </button>
        <button className={tab === "gear" ? "tab active" : "tab"} onClick={() => setTab("gear")}>
          Gear Tracker
        </button>
        <button className={tab === "calc" ? "tab active" : "tab"} onClick={() => setTab("calc")}>
          Approx Calc
        </button>
      </nav>
      {data && <span className="data-ver">data {data.sourceCommit}</span>}
    </header>
  );
}

async function toClipboard(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt("Copy your link:", url);
  }
}

function ShareBar({ build }: { build: Build }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shortMsg, setShortMsg] = useState<string | null>(null);
  const disabled = build.targets.length === 0;

  async function copyFull() {
    await toClipboard(shareUrl(build));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Save server-side and copy a short link. Falls back to the full link if the
  // backend isn't available (offline build, or before KV is configured).
  async function saveShort() {
    setSaving(true);
    setShortMsg(null);
    const id = await saveBuildRemote(build);
    setSaving(false);
    if (id) {
      await toClipboard(shortShareUrl(id));
      setShortMsg("Short link copied ✓");
    } else {
      await toClipboard(shareUrl(build));
      setShortMsg("Saved offline — copied full link");
    }
    setTimeout(() => setShortMsg(null), 2200);
  }

  return (
    <div className="sharebar">
      <button className="btn ghost small" disabled={disabled} onClick={copyFull} title="A self-contained link that carries the whole build">
        {copied ? "Copied ✓" : "Copy link"}
      </button>
      <button className="btn primary small" disabled={disabled || saving} onClick={saveShort} title="Save the build and get a short, shareable link">
        {saving ? "Saving…" : shortMsg || "Save & share"}
      </button>
    </div>
  );
}

function ImportExport({ build, onImport }: { build: Build; onImport: (b: Build) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="impexp">
      <button className="btn ghost small" onClick={() => setOpen((o) => !o)}>
        Import / export code
      </button>
      {open && (
        <div className="impexp-body">
          <textarea
            value={text || encodeBuild(build)}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={3}
          />
          <div className="row">
            <button
              className="btn small"
              onClick={() => {
                const b = decodeBuild(text.trim());
                if (b) {
                  onImport(b);
                  setText("");
                } else alert("That doesn't look like a valid BitForge code.");
              }}
            >
              Load code
            </button>
            <span className="hint">Paste a code here, or copy the one shown to share.</span>
          </div>
        </div>
      )}
    </div>
  );
}

const CLAIM_LS = "bitforge:claim";

function StoragePanel({
  data,
  storage,
  setStorage,
  useStorage,
  setUseStorage,
}: {
  data: GameData;
  storage: Record<ItemKey, number> | null;
  setStorage: (s: Record<ItemKey, number> | null) => void;
  useStorage: boolean;
  setUseStorage: (b: boolean) => void;
}) {
  const [claim, setClaim] = useState<string>(() => {
    try {
      return localStorage.getItem(CLAIM_LS) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function pull() {
    const id = claim.trim();
    if (!/^\d{5,25}$/.test(id)) {
      setMsg("Enter your numeric claim ID.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      localStorage.setItem(CLAIM_LS, id);
    } catch {
      /* ignore */
    }
    const res = await pullInventory(data, id);
    setBusy(false);
    if (!res) {
      setMsg("Couldn't reach storage for that claim. Check the ID.");
      return;
    }
    setStorage(res.totals);
    setUseStorage(true);
    setMsg(`Pulled ${res.distinct.toLocaleString()} item types from storage.`);
  }

  return (
    <div className="panel storage">
      <div className="panel-head">
        <h2>My storage</h2>
        {storage && (
          <label className="store-toggle">
            <input
              type="checkbox"
              checked={useStorage}
              onChange={(e) => setUseStorage(e.target.checked)}
            />
            subtract from needs
          </label>
        )}
      </div>
      <p className="hint">
        Pull your settlement's on-hand items from{" "}
        <a href="https://bitjita.com" target="_blank" rel="noreferrer">
          Bitjita
        </a>{" "}
        so the plan shows only what you still need.
      </p>
      <div className="store-row">
        <input
          className="search"
          placeholder="Claim ID (number from your bitjita.com/claims/… URL)"
          value={claim}
          onChange={(e) => {
            setClaim(e.target.value);
            try {
              localStorage.setItem(CLAIM_LS, e.target.value.trim());
            } catch {
              /* ignore */
            }
          }}
          inputMode="numeric"
        />
        <button className="btn primary small" disabled={busy} onClick={pull}>
          {busy ? "Pulling…" : storage ? "Refresh" : "Pull"}
        </button>
      </div>
      {msg && <div className="store-msg">{msg}</div>}
      {storage && (
        <button
          className="btn ghost small"
          onClick={() => {
            setStorage(null);
            setMsg(null);
          }}
        >
          Clear storage
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="panel empty">
      <h2>Plan a build, get a shopping list sorted by profession</h2>
      <p>
        Add the buildings and items you want on the left. BitForge expands every
        recipe down to raw materials, totals everything up, and <b>divides the
        whole list by the profession</b> that makes or gathers it — so each crafter
        knows exactly what to produce. Then share it with a link.
      </p>
      <ul className="tips">
        <li>Search a building (e.g. “Loom”, “Carpentry Station”) or any item.</li>
        <li>Set quantities; the totals update live.</li>
        <li>Check off materials as you gather — progress is saved on this device.</li>
        <li>Hit <b>Copy share link</b> to send the whole plan to a friend.</li>
      </ul>
    </div>
  );
}

function Footer({ data }: { data: GameData }) {
  return (
    <footer className="footer">
      <span>
        Game data from the community{" "}
        <a href="https://github.com/BitCraftToolBox/BitCraft_GameData" target="_blank" rel="noreferrer">
          BitCraft_GameData
        </a>{" "}
        project · snapshot {new Date(data.generatedAt).toLocaleDateString()}
      </span>
      <span>Not affiliated with Clockwork Labs. Builds are stored in your link, not on a server.</span>
    </footer>
  );
}

// A stable signature for the current build's target set, used to scope progress.
function useBuildSig(build: Build): string {
  return useMemo(
    () =>
      build.targets
        .map((t) => `${targetId(t)}:${t.q}`)
        .sort()
        .join("|"),
    [build.targets]
  );
}
