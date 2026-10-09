/** A coin-flip sequence rendered as coins. Optionally highlights runs of length >= minRun. */
export function Coins({ flips, highlightRuns = 0, size = "md" }: { flips: string; highlightRuns?: number; size?: "sm" | "md" | "lg" }) {
  const runId: number[] = [];
  const runLen: number[] = [];
  let id = 0;
  for (let i = 0; i < flips.length; i++) {
    if (i > 0 && flips[i] !== flips[i - 1]) id++;
    runId.push(id);
  }
  for (let i = 0; i < flips.length; i++) runLen.push(runId.filter((r) => r === runId[i]).length);
  return (
    <div className={`coins coins-${size}`} aria-label={`Sequence: ${flips.split("").join(" ")}`}>
      {flips.split("").map((c, i) => (
        <span key={i} className={`coin ${c === "H" ? "coin-h" : "coin-t"} ${highlightRuns && runLen[i] >= highlightRuns ? "coin-run" : ""}`}>
          {c}
        </span>
      ))}
    </div>
  );
}
