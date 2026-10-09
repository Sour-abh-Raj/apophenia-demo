/** Small comparison charts. Colours: "you" = indigo, "class" = slate; consistent across the app. */
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
export const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

export function CompareRow({ label, you, cls, format = "pct", max = 1, note }: {
  label: string; you: number | null; cls: number | null; format?: "pct" | "num"; max?: number; note?: string;
}) {
  const f = format === "pct" ? pct : (v: number | null) => num(v);
  const w = (v: number | null) => `${v == null ? 0 : Math.max(0, Math.min(1, v / max)) * 100}%`;
  return (
    <div className="cmp-row">
      <div className="cmp-label">{label}{note && <span className="cmp-note">{note}</span>}</div>
      <div className="cmp-bars">
        <div className="cmp-bar"><span className="who">You</span><div className="track"><div className="fill you" style={{ width: w(you) }} /></div><b>{f(you)}</b></div>
        <div className="cmp-bar"><span className="who">Class</span><div className="track"><div className="fill cls" style={{ width: w(cls) }} /></div><b>{f(cls)}</b></div>
      </div>
    </div>
  );
}

export function HBar({ label, value, tone = "accent", sub, max = 1, format = "pct" }: { label: string; value: number | null; tone?: string; sub?: string; max?: number; format?: "pct" | "num" }) {
  return (
    <div className="hbar">
      <div className="hbar-label">{label}{sub && <span>{sub}</span>}</div>
      <div className="hbar-track"><div className={`hbar-fill tone-${tone}`} style={{ width: `${value == null ? 0 : Math.max(0, Math.min(1, value / max)) * 100}%` }} /></div>
      <div className="hbar-val">{format === "pct" ? pct(value) : num(value)}</div>
    </div>
  );
}
