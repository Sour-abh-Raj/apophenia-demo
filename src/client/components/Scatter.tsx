import type { Variable } from "../../shared/types";

/** "Nice" tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => span / s <= count) ?? 10 * pow;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Same padding rule for every chart: data range ± 8 %. No trend lines, no statistics. */
export function domainOf(vals: number[]): [number, number] {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.08;
  return [lo - pad, hi + pad];
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US") : String(Number(v.toPrecision(6))));

interface Props {
  x: Variable; y: Variable; points: [number, number][];
  /** optionally share axes with another sample (e.g. replication) */
  domain?: { x: [number, number]; y: [number, number] };
  dotR?: number; dotOpacity?: number; className?: string; title?: string; theme?: "light" | "dark";
}

export function Scatter({ x, y, points, domain, dotR = 5, dotOpacity = 0.8, className, title, theme = "light" }: Props) {
  // The dark (projector) theme is drawn at ~half size and then screen-shared, so its text is scaled up to stay legible.
  const k = theme === "dark" ? 1.5 : 1;
  const W = 520, H = 400, m = { l: 66 * k, r: 16, t: title ? 30 * k : 14, b: 58 * k };
  const xd = domain?.x ?? domainOf(points.map((p) => p[0]));
  const yd = domain?.y ?? domainOf(points.map((p) => p[1]));
  const sx = (v: number) => m.l + ((v - xd[0]) / (xd[1] - xd[0])) * (W - m.l - m.r);
  const sy = (v: number) => H - m.b - ((v - yd[0]) / (yd[1] - yd[0])) * (H - m.t - m.b);
  const ink = theme === "dark" ? "#cbd5e1" : "#334155", grid = theme === "dark" ? "#334155" : "#e2e8f0", dot = theme === "dark" ? "#a5b4fc" : "#4338ca";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className ?? "scatter"} role="img" aria-label={`Scatterplot of ${y.name} against ${x.name}`}>
      {title && <text x={W / 2} y={18 * k} textAnchor="middle" fontSize={15 * k} fontWeight={600} fill={ink}>{title}</text>}
      {niceTicks(xd[0], xd[1]).map((t) => (
        <g key={`x${t}`}>
          <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} stroke={grid} />
          <text x={sx(t)} y={H - m.b + 18 * k} textAnchor="middle" fontSize={12 * k} fill={ink}>{fmt(t)}</text>
        </g>
      ))}
      {niceTicks(yd[0], yd[1]).map((t) => (
        <g key={`y${t}`}>
          <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} stroke={grid} />
          <text x={m.l - 8} y={sy(t) + 4} textAnchor="end" fontSize={12 * k} fill={ink}>{fmt(t)}</text>
        </g>
      ))}
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="none" stroke={ink} strokeOpacity={0.5} />
      {points.map(([px, py], i) => (
        <circle key={i} cx={sx(px)} cy={sy(py)} r={dotR} fill={dot} fillOpacity={dotOpacity} stroke={theme === "dark" ? "#0f172a" : "white"} strokeWidth={dotR > 3 ? 1 : 0.4} />
      ))}
      <text x={(m.l + W - m.r) / 2} y={H - 14} textAnchor="middle" fontSize={14 * k} fontWeight={600} fill={ink}>{x.name} ({x.unit})</text>
      <text transform={`translate(${16 * k} ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={14 * k} fontWeight={600} fill={ink}>{y.name} ({y.unit})</text>
    </svg>
  );
}
