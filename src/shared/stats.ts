/** Inverse standard-normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Sensitivity d' and criterion c with the log-linear correction (Hautus, 1995):
 * add 0.5 to hit and false-alarm counts and 1 to each denominator, so perfect
 * scores (0 or 1 rates) remain finite.
 */
export function sdt(hits: number, nSignal: number, fas: number, nNoise: number) {
  const h = (hits + 0.5) / (nSignal + 1);
  const f = (fas + 0.5) / (nNoise + 1);
  const zH = normInv(h), zF = normInv(f);
  return { dPrime: zH - zF, criterion: -(zH + zF) / 2 };
}

/** P(longest run of identical outcomes >= k) in n fair coin flips (exact dynamic programme). */
export function probLongestRunAtLeast(n: number, k: number): number {
  // dp[j] = probability that the current run length is j and no run >= k has occurred yet
  let dp = new Array(k).fill(0);
  dp[1] = 1; // after the first flip
  for (let i = 2; i <= n; i++) {
    const nd = new Array(k).fill(0);
    for (let j = 1; j < k; j++) {
      if (!dp[j]) continue;
      nd[1] += dp[j] * 0.5; // switch
      if (j + 1 < k) nd[j + 1] += dp[j] * 0.5; // repeat (if j+1 == k the run reaches k: absorbed)
    }
    dp = nd;
  }
  return 1 - dp.reduce((s, v) => s + v, 0);
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
