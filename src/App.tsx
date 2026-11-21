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
import { loadBuildRemote, saveBuildRemote } from "./backend";
import { Picker } from "./components/Picker";
import { PlanView } from "./components/PlanView";
import { TargetList } from "./components/TargetList";

type Tab = "planner" | "upgrade";

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("planner");
  const [build, setBuild] = useState<Build>(() => buildFromHash() || emptyBuild());
  // chosen recipe index per item key (when multiple recipes exist)
  const [chosen, setChosen] = useState<Record<ItemKey, number>>({});

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
              />
            )}
          </section>
        </main>
      ) : (
        <UpgradePlannerPlaceholder />
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
        <button className={tab === "upgrade" ? "tab active" : "tab"} onClick={() => setTab("upgrade")}>
          Upgrade Planner
          <span className="soon">soon</span>
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

function UpgradePlannerPlaceholder() {
  return (
    <main className="layout single">
      <div className="panel empty">
        <h2>Upgrade Planner — coming next</h2>
        <p>
          Pick a target tier/level, drop in the stations you want, and BitForge
          will front-load the <b>research books</b> you need first, then roll up
          all the station build materials — divided by profession, same as the
          Build Planner.
        </p>
        <p className="hint">
          The research/knowledge data is already in the dataset; this tab wires it
          into a tier-by-tier checklist.
        </p>
      </div>
    </main>
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
