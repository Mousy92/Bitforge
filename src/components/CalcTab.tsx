import { useEffect, useMemo, useState } from "react";

// Approximation calculator for RNG-yield materials (e.g. crushing ore -> sand).
// You give the drop chance per craft and how many you need; it tells you the
// average number of crafts and — erring on the side of bad luck — how many
// crafts to be ~X% likely to actually hit your target.

interface Row {
  id: string;
  name: string;
  chance: string; // % chance of a success per craft
  per: string; // amount gained per success
  need: string; // amount wanted
}

const CALC_LS = "bitforge:calc";
const uid = () => Math.random().toString(36).slice(2, 9);
const emptyRow = (): Row => ({ id: uid(), name: "", chance: "50", per: "1", need: "100" });

const CONFIDENCES = [
  { label: "50% — just the average", p: 0.5, z: 0 },
  { label: "75% — fairly safe", p: 0.75, z: 0.6745 },
  { label: "80% — recommended", p: 0.8, z: 0.8416 },
  { label: "90% — very safe", p: 0.9, z: 1.2816 },
  { label: "95% — paranoid", p: 0.95, z: 1.6449 },
];

/**
 * Smallest number of crafts C so that P(at least m successes) >= conf, where
 * each craft succeeds with probability p. Exact (negative-binomial accumulation)
 * when numerically safe, else a normal approximation.
 */
function recommendedCrafts(p: number, m: number, conf: number, z: number): number {
  if (m <= 0) return 0;
  if (p >= 1) return m;
  if (p <= 0) return Infinity;
  const logStart = m * Math.log(p);
  if (m <= 4000 && logStart > -200) {
    const cap = Math.ceil((m / p) * 4) + 3000;
    let pmf = Math.exp(logStart); // P(exactly m crafts for m successes), at C = m
    let cum = 0;
    for (let C = m; C <= cap; C++) {
      cum += pmf;
      if (cum >= conf) return C;
      pmf *= (C / (C - m + 1)) * (1 - p);
    }
  }
  // Normal approximation of the negative-binomial.
  return Math.ceil(m / p + (z * Math.sqrt(m * (1 - p))) / p);
}

function num(s: string): number {
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function CalcTab() {
  const [rows, setRows] = useState<Row[]>(() => {
    try {
      const r = localStorage.getItem(CALC_LS);
      const v = r ? (JSON.parse(r) as Row[]) : null;
      if (v && v.length) return v;
    } catch {
      /* ignore */
    }
    return [emptyRow()];
  });
  const [confIdx, setConfIdx] = useState(2); // 80%

  useEffect(() => {
    try {
      localStorage.setItem(CALC_LS, JSON.stringify(rows));
    } catch {
      /* ignore */
    }
  }, [rows]);

  const conf = CONFIDENCES[confIdx];

  const computed = useMemo(
    () =>
      rows.map((r) => {
        const p = num(r.chance) / 100;
        const per = Math.max(1, num(r.per));
        const need = num(r.need);
        const m = per > 0 ? Math.ceil(need / per) : 0;
        const avg = p > 0 ? Math.ceil(m / p) : Infinity;
        const rec = recommendedCrafts(p, m, conf.p, conf.z);
        const validP = p > 0 && p <= 1;
        return { r, p, per, need, m, avg, rec, validP };
      }),
    [rows, conf]
  );

  const totalRec = computed.reduce((s, c) => s + (Number.isFinite(c.rec) ? c.rec : 0), 0);
  const totalAvg = computed.reduce((s, c) => s + (Number.isFinite(c.avg) ? c.avg : 0), 0);

  function update(id: string, field: keyof Row, val: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  }
  function add() {
    setRows((rs) => [...rs, emptyRow()]);
  }
  function remove(id: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  }

  return (
    <main className="layout single">
      <div className="panel">
        <div className="panel-head">
          <h2>RNG yield calculator</h2>
          <div className="spacer" />
          <label className="calc-conf">
            <span className="muted small">Safety</span>
            <select value={confIdx} onChange={(e) => setConfIdx(Number(e.target.value))}>
              {CONFIDENCES.map((c, i) => (
                <option key={i} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          For materials with a random drop (crushed sand, crushed ore, byproducts…). Enter the{" "}
          <b>chance per craft</b> and how many you need. "Average" is the expected number of crafts;
          "Aim for" pads that so you're about <b>{Math.round(conf.p * 100)}%</b> likely to hit your
          target even with bad luck.
        </p>

        <div className="calc-table-wrap">
          <table className="calc-table">
            <thead>
              <tr>
                <th>Material</th>
                <th className="num">Chance / craft</th>
                <th className="num">Per success</th>
                <th className="num">You need</th>
                <th className="num">Average crafts</th>
                <th className="num">Aim for</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {computed.map(({ r, avg, rec, validP, m }) => (
                <tr key={r.id}>
                  <td>
                    <input
                      className="calc-in name"
                      placeholder="e.g. Crushed Sand"
                      value={r.name}
                      onChange={(e) => update(r.id, "name", e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <span className="calc-pct">
                      <input
                        className="calc-in sm"
                        inputMode="decimal"
                        value={r.chance}
                        onChange={(e) => update(r.id, "chance", e.target.value)}
                      />
                      %
                    </span>
                  </td>
                  <td className="num">
                    <input
                      className="calc-in sm"
                      inputMode="decimal"
                      value={r.per}
                      onChange={(e) => update(r.id, "per", e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="calc-in sm"
                      inputMode="numeric"
                      value={r.need}
                      onChange={(e) => update(r.id, "need", e.target.value)}
                    />
                  </td>
                  <td className="num calc-avg">{validP && m > 0 ? avg.toLocaleString() : "—"}</td>
                  <td className="num calc-rec">
                    {validP && m > 0 ? (Number.isFinite(rec) ? rec.toLocaleString() : "∞") : "—"}
                  </td>
                  <td className="num">
                    <button className="gear-x" onClick={() => remove(r.id)} title="Remove row">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="calc-total-label">
                    Total crafts
                  </td>
                  <td className="num calc-avg">{totalAvg.toLocaleString()}</td>
                  <td className="num calc-rec">{totalRec.toLocaleString()}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <button className="btn ghost small" onClick={add}>
          + Add material
        </button>

        <p className="calc-note">
          How it works: each craft has your chance of producing{" "}
          <b>per-success</b> units. On average you'll need <b>need ÷ chance</b> crafts, but RNG
          varies — the <b>Aim for</b> column adds a safety margin so about{" "}
          {Math.round(conf.p * 100)}% of the time you'll have enough by then. Bump the Safety
          selector up if you really can't afford to come up short.
        </p>
      </div>
    </main>
  );
}
