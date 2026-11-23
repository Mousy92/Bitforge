import { useEffect, useMemo, useRef, useState } from "react";
import type { GameData } from "../data";

// Gathering swing calculator + timer. Pull a node's HP (or set it), enter your
// damage per swing and swing speed, and it works out swings + time to break it —
// with a built-in countdown you can run while you gather.

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m ${r}s`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}
function clock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
function num(s: string): number {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function GatherTab({ data }: { data: GameData }) {
  const nodes = data.nodes ?? [];
  const [hp, setHp] = useState("12000");
  const [dmg, setDmg] = useState("500");
  const [swing, setSwing] = useState("1.6"); // seconds per swing
  const [nodeName, setNodeName] = useState("");
  const [nodeMeta, setNodeMeta] = useState<{ tier: number; tag: string; rs: number } | null>(null);
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return nodes.filter((n) => n.n.toLowerCase().includes(term) || n.tag.toLowerCase().includes(term)).slice(0, 14);
  }, [q, nodes]);

  const H = num(hp);
  const D = num(dmg);
  const S = num(swing);
  const swings = D > 0 ? Math.ceil(H / D) : 0;
  const duration = swings * S; // seconds

  // Countdown timer.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = (endRef.current - Date.now()) / 1000;
      if (left <= 0) {
        setRemaining(0);
        setRunning(false);
        beep();
      } else setRemaining(left);
    }, 100);
    return () => clearInterval(id);
  }, [running]);
  function start() {
    endRef.current = Date.now() + duration * 1000;
    setRemaining(duration);
    setRunning(true);
  }
  function stop() {
    setRunning(false);
  }
  function reset() {
    setRunning(false);
    setRemaining(null);
  }

  return (
    <main className="layout single">
      <div className="panel">
        <div className="panel-head">
          <h2>Gathering swing timer</h2>
        </div>
        <p className="hint">
          Pull a node's health (or type it in), set your damage per swing and swing speed, and get
          the swings &amp; time to break it — with a countdown you can run while you gather.
        </p>

        <div className="calc-lookup">
          <input
            className="search"
            placeholder="🔍 Pull a node's HP… (e.g. oak tree, ferralith ore vein)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <ul className="calc-lookup-results">
              {results.map((n, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setHp(String(n.hp));
                      setNodeName(n.n);
                      setNodeMeta({ tier: n.t, tag: n.tag, rs: n.rs });
                      setQ("");
                    }}
                  >
                    <span className="cl-name">
                      {n.n}
                      {n.t > 0 && <span className="m-tier">T{n.t}</span>}
                    </span>
                    <span className="cl-rate">
                      {n.hp.toLocaleString()} HP{n.rs ? ` · respawn ${fmt(n.rs)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {nodeName && (
          <div className="gather-node">
            <b>{nodeName}</b>
            {nodeMeta && (
              <span className="muted small">
                {nodeMeta.tier > 0 ? `T${nodeMeta.tier} · ` : ""}
                {nodeMeta.tag}
                {nodeMeta.rs ? ` · respawns in ${fmt(nodeMeta.rs)}` : ""}
              </span>
            )}
          </div>
        )}

        <div className="gather-inputs">
          <label>
            <span>Node HP</span>
            <input className="calc-in" inputMode="numeric" value={hp} onChange={(e) => setHp(e.target.value)} />
          </label>
          <label>
            <span>Damage / swing</span>
            <input className="calc-in" inputMode="numeric" value={dmg} onChange={(e) => setDmg(e.target.value)} />
          </label>
          <label>
            <span>Swing time (sec)</span>
            <input className="calc-in" inputMode="decimal" value={swing} onChange={(e) => setSwing(e.target.value)} />
          </label>
        </div>

        <div className="gather-out">
          <div className="gather-stat">
            <span className="gs-n">{D > 0 ? swings.toLocaleString() : "—"}</span>
            <span className="gs-l">swings to break</span>
          </div>
          <div className="gather-stat big">
            <span className="gs-n">{D > 0 && S > 0 ? fmt(duration) : "—"}</span>
            <span className="gs-l">total time</span>
          </div>
        </div>

        <div className="gather-timer">
          <div className={`gt-display${remaining === 0 ? " done" : ""}`}>
            {remaining === 0 ? "Done! 🎉" : clock(remaining ?? duration)}
          </div>
          <div className="gt-controls">
            {!running ? (
              <button className="btn primary small" disabled={!(D > 0 && S > 0)} onClick={start}>
                {remaining != null && remaining > 0 ? "Resume" : "Start timer"}
              </button>
            ) : (
              <button className="btn small" onClick={stop}>
                Pause
              </button>
            )}
            <button className="btn ghost small" onClick={reset}>
              Reset
            </button>
          </div>
        </div>

        <p className="calc-note">
          Swings = node HP ÷ your damage (rounded up); time = swings × swing speed. It assumes steady
          swings and doesn't model crits, tool tier or gathering buffs, so treat it as a close
          estimate. A node's <b>respawn</b> time (when shown) is how long until it's back.
        </p>
      </div>
    </main>
  );
}

// Short beep via Web Audio when the timer finishes.
function beep() {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const Ctx = AC.AudioContext || AC.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    o.start();
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.stop(ctx.currentTime + 0.6);
  } catch {
    /* ignore */
  }
}
