import { useEffect, useMemo, useRef, useState } from "react";
import type { GameData } from "../data";

// Gathering swing timers. Set your damage + swing speed once, then add as many
// node timers as you want (pull a node's HP or type it). Each runs its own
// countdown so you can track several nodes/respawns at the same time.

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
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? `${h}:` : "") + `${mm}:${String(r).padStart(2, "0")}`;
}
function num(s: string): number {
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function beep() {
  try {
    const AC = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
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

interface Timer {
  id: string;
  label: string;
  kind: "active" | "passive";
  // active (node gathering)
  hp?: string;
  respawn?: number; // seconds, if pulled from a node
  mode?: "break" | "respawn"; // which duration the timer counts
  // passive (processes over time, e.g. bricks firing)
  qty?: string;
  per?: number; // seconds per unit
}
const uid = () => Math.random().toString(36).slice(2, 9);
const SWING_LS = "bitforge:gswing";
const TIMERS_LS = "bitforge:gtimers";

export function GatherTab({ data }: { data: GameData }) {
  const nodes = data.nodes ?? [];
  const [dmg, setDmg] = useState("500");
  const [swing, setSwing] = useState("1.6");
  const [timers, setTimers] = useState<Timer[]>([{ id: uid(), label: "", kind: "active", hp: "12000" }]);
  const [q, setQ] = useState("");
  const [pq, setPq] = useState("");
  const [startNonce, setStartNonce] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);

  // Tab-title flash + optional notification when a timer finishes.
  const origTitle = useRef<string>(typeof document !== "undefined" ? document.title : "");
  const flashRef = useRef<number | null>(null);
  function stopFlash() {
    if (flashRef.current) {
      clearInterval(flashRef.current);
      flashRef.current = null;
      document.title = origTitle.current;
    }
  }
  useEffect(() => {
    window.addEventListener("focus", stopFlash);
    return () => {
      window.removeEventListener("focus", stopFlash);
      stopFlash();
    };
  }, []);
  function notifyDone(label: string) {
    const name = label || "Node";
    try {
      if ("Notification" in window && Notification.permission === "granted")
        new Notification("BitForge — timer done", { body: `${name} is ready.` });
    } catch {
      /* ignore */
    }
    if (!document.hasFocus() && !flashRef.current) {
      let on = false;
      flashRef.current = window.setInterval(() => {
        on = !on;
        document.title = on ? "⏰ Timer done!" : origTitle.current;
      }, 900);
    }
  }
  function askNotify() {
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch {
      /* ignore */
    }
  }

  // Load persisted swing + timers.
  useEffect(() => {
    try {
      const sw = localStorage.getItem(SWING_LS);
      if (sw) {
        const o = JSON.parse(sw) as { dmg?: string; swing?: string };
        if (o.dmg) setDmg(o.dmg);
        if (o.swing) setSwing(o.swing);
      }
      const t = localStorage.getItem(TIMERS_LS);
      if (t) {
        const arr = JSON.parse(t) as Timer[];
        if (Array.isArray(arr) && arr.length) setTimers(arr);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(SWING_LS, JSON.stringify({ dmg, swing }));
    } catch {
      /* ignore */
    }
  }, [dmg, swing]);
  function persistTimers(next: Timer[]) {
    setTimers(next);
    try {
      localStorage.setItem(TIMERS_LS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  const passives = data.passives ?? [];
  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return nodes.filter((n) => n.n.toLowerCase().includes(term) || n.tag.toLowerCase().includes(term)).slice(0, 12);
  }, [q, nodes]);
  const presults = useMemo(() => {
    const term = pq.trim().toLowerCase();
    if (!term) return [];
    return passives.filter((p) => p.n.toLowerCase().includes(term)).slice(0, 12);
  }, [pq, passives]);

  function addTimer(t?: Partial<Timer>) {
    persistTimers([
      ...timers,
      { id: uid(), label: t?.label ?? "", kind: t?.kind ?? "active", hp: t?.hp ?? "", respawn: t?.respawn, mode: "break", qty: t?.qty, per: t?.per },
    ]);
  }
  function updateTimer(id: string, patch: Partial<Timer>) {
    persistTimers(timers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  function removeTimer(id: string) {
    persistTimers(timers.filter((t) => t.id !== id));
  }

  const D = num(dmg);
  const S = num(swing);

  return (
    <main className="layout single">
      <div className="panel">
        <div className="panel-head">
          <h2>Gathering timers</h2>
        </div>
        <p className="hint">
          Two kinds of timers, running side by side: <b>active</b> gathering (node HP ÷ your swing)
          and <b>passive</b> processes that cook over time (bricks, ingots, charcoal…). Add as many
          as you like — pull a node's HP, or pick a passive process and set a quantity.
        </p>

        <div className="gather-inputs">
          <label>
            <span>Damage / swing</span>
            <input className="calc-in" inputMode="numeric" value={dmg} onChange={(e) => setDmg(e.target.value)} />
          </label>
          <label>
            <span>Swing time (sec)</span>
            <input className="calc-in" inputMode="decimal" value={swing} onChange={(e) => setSwing(e.target.value)} />
          </label>
        </div>

        <div className="calc-lookup" style={{ marginTop: 14 }}>
          <input
            className="search"
            placeholder="🔍 Add a node timer — pull HP… (e.g. oak tree, ferralith ore vein)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {results.length > 0 && (
            <ul className="calc-lookup-results">
              {results.map((n, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      addTimer({ label: n.n, hp: String(n.hp), respawn: n.rs || undefined });
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

        <div className="calc-lookup" style={{ marginTop: 8 }}>
          <input
            className="search"
            placeholder="⏳ Add a passive timer — process over time… (e.g. sturdy brick, ingot, charcoal)"
            value={pq}
            onChange={(e) => setPq(e.target.value)}
          />
          {presults.length > 0 && (
            <ul className="calc-lookup-results">
              {presults.map((p, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      addTimer({ kind: "passive", label: p.n, per: p.per, qty: "10" });
                      setPq("");
                    }}
                  >
                    <span className="cl-name">
                      {p.n}
                      {p.t > 0 && <span className="m-tier">T{p.t}</span>}
                    </span>
                    <span className="cl-rate">{fmt(p.per)} / unit</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {timers.length > 1 && (
          <div className="timer-bulk">
            <button
              className="btn primary small"
              onClick={() => {
                askNotify();
                setStartNonce((n) => n + 1);
              }}
            >
              ▶ Start all
            </button>
            <button className="btn ghost small" onClick={() => setResetNonce((n) => n + 1)}>
              ↺ Reset all
            </button>
          </div>
        )}

        <div className="timer-grid">
          {timers.map((t) => (
            <TimerCard
              key={t.id}
              timer={t}
              dmg={D}
              swing={S}
              startNonce={startNonce}
              resetNonce={resetNonce}
              onChange={(patch) => updateTimer(t.id, patch)}
              onRemove={() => removeTimer(t.id)}
              onStart={askNotify}
              onFinish={notifyDone}
            />
          ))}
          <button className="timer-add" onClick={() => addTimer()}>
            + Add timer
          </button>
        </div>

        <p className="calc-note">
          <b>Active:</b> break time = node HP ÷ your damage (rounded up) × swing speed (steady swings;
          no crits / tool tier / buffs). A node's <b>respawn</b> timer (when pulled) counts how long
          until it's back — switch with the ⟳ toggle. <b>Passive:</b> total = quantity × the process's
          per-unit time (one station, in series).
        </p>
      </div>
    </main>
  );
}

function TimerCard({
  timer,
  dmg,
  swing,
  startNonce,
  resetNonce,
  onChange,
  onRemove,
  onStart,
  onFinish,
}: {
  timer: Timer;
  dmg: number;
  swing: number;
  startNonce: number;
  resetNonce: number;
  onChange: (patch: Partial<Timer>) => void;
  onRemove: () => void;
  onStart: () => void;
  onFinish: (label: string) => void;
}) {
  const passive = timer.kind === "passive";
  const qty = num(timer.qty ?? "");
  const per = timer.per ?? 0;
  const H = num(timer.hp ?? "");
  const swings = dmg > 0 ? Math.ceil(H / dmg) : 0;
  const breakDur = swings * swing;
  const mode = timer.mode ?? "break";
  const duration = passive
    ? qty * per
    : mode === "respawn" && timer.respawn
      ? timer.respawn
      : breakDur;
  const canRun = duration > 0;

  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const endRef = useRef(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const left = (endRef.current - Date.now()) / 1000;
      if (left <= 0) {
        setRemaining(0);
        setRunning(false);
        beep();
        finishRef.current(timer.label);
      } else setRemaining(left);
    }, 100);
    return () => clearInterval(id);
  }, [running, timer.label]);
  function start() {
    if (!canRun) return;
    onStart();
    endRef.current = Date.now() + duration * 1000;
    setRemaining(duration);
    setRunning(true);
  }
  function reset() {
    setRunning(false);
    setRemaining(null);
  }
  // Respond to "Start all" / "Reset all" (skip the initial 0 value).
  useEffect(() => {
    if (startNonce > 0) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNonce]);
  useEffect(() => {
    if (resetNonce > 0) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);
  return (
    <div className={`timer-card${remaining === 0 ? " done" : ""}${running ? " running" : ""}`}>
      <div className="tc-head">
        <input
          className="tc-label"
          placeholder="Label (optional)"
          value={timer.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <button className="tc-x" onClick={onRemove} title="Remove timer">
          ×
        </button>
      </div>
      <div className="tc-inputs">
        {passive ? (
          <label>
            <span>Quantity</span>
            <input className="calc-in" inputMode="numeric" value={timer.qty ?? ""} onChange={(e) => onChange({ qty: e.target.value })} />
          </label>
        ) : (
          <>
            <label>
              <span>HP</span>
              <input className="calc-in" inputMode="numeric" value={timer.hp ?? ""} onChange={(e) => onChange({ hp: e.target.value })} />
            </label>
            {timer.respawn ? (
              <button
                className="tc-mode"
                onClick={() => onChange({ mode: mode === "break" ? "respawn" : "break" })}
                title="Switch between break time and respawn time"
              >
                ⟳ {mode === "break" ? "break" : "respawn"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="tc-meta">
        {passive ? (
          <>
            {qty.toLocaleString()} × {fmt(per)} · {canRun ? fmt(duration) : "—"}
          </>
        ) : mode === "break" ? (
          <>
            {dmg > 0 ? swings.toLocaleString() : "—"} swings · {canRun ? fmt(breakDur) : "—"}
          </>
        ) : (
          <>respawn · {fmt(duration)}</>
        )}
      </div>
      <div className={`tc-display${remaining === 0 ? " done" : ""}`}>
        {remaining === 0 ? "Done! 🎉" : clock(remaining ?? duration)}
      </div>
      <div className="tc-controls">
        {!running ? (
          <button className="btn primary small" disabled={!canRun} onClick={start}>
            {remaining != null && remaining > 0 ? "Resume" : "Start"}
          </button>
        ) : (
          <button className="btn small" onClick={() => setRunning(false)}>
            Pause
          </button>
        )}
        <button className="btn ghost small" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}
