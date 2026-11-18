import { type GameData, itemName } from "../data";
import type { Target } from "../model";
import { targetId } from "../model";

export function TargetList({
  data,
  targets,
  onQty,
  onRemove,
}: {
  data: GameData;
  targets: Target[];
  onQty: (id: string, q: number) => void;
  onRemove: (id: string) => void;
}) {
  if (!targets.length) {
    return <p className="muted small">No targets yet — search above to add one.</p>;
  }
  return (
    <ul className="targets">
      {targets.map((t) => {
        const id = targetId(t);
        const isBuilding = t.t === "b";
        const name = isBuilding
          ? data.buildings.find((b) => b.id === t.id)?.n ?? `Building ${t.id}`
          : itemName(data, t.k);
        return (
          <li key={id}>
            <span className={`pill ${isBuilding ? "building" : "item"}`}>
              {isBuilding ? "Build" : "Item"}
            </span>
            <span className="t-name" title={name}>
              {name}
            </span>
            <input
              className="t-qty"
              type="number"
              min={1}
              value={t.q}
              onChange={(e) => onQty(id, Number(e.target.value) || 0)}
            />
            <button className="t-remove" title="Remove" onClick={() => onRemove(id)}>
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
