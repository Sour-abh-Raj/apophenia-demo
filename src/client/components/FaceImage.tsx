import type { MouseEvent } from "react";

interface Props {
  src: string;
  marker?: { x: number; y: number } | null;
  overlay?: { cx: number; cy: number; rx: number; ry: number } | null;
  dots?: { x: number; y: number }[];
  onPick?: (p: { x: number; y: number }) => void;
  className?: string;
}

/** Square stimulus image. Coordinates are normalised to [0,1] so they are independent of display size. */
export function FaceImage({ src, marker, overlay, dots, onPick, className }: Props) {
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
  };
  return (
    <div className={`face-img ${onPick ? "pickable" : ""} ${className ?? ""}`} onClick={click} data-testid="face-image">
      <img src={src} alt="Visual noise stimulus" draggable={false} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {dots?.map((d, i) => <circle key={i} cx={d.x * 100} cy={d.y * 100} r={1.6} className="heat-dot" />)}
        {overlay && <ellipse cx={overlay.cx * 100} cy={overlay.cy * 100} rx={overlay.rx * 100 * 1.1} ry={overlay.ry * 100 * 1.05} className="face-ring" />}
        {marker && (
          <g className="pick-marker">
            <circle cx={marker.x * 100} cy={marker.y * 100} r={6} />
            <circle cx={marker.x * 100} cy={marker.y * 100} r={0.9} />
          </g>
        )}
      </svg>
    </div>
  );
}
