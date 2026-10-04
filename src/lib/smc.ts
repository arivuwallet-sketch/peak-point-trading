import type { Candle } from "./market.functions";
import type { Bias, Pivot } from "./analysis";

export type ZoneKind = "FVG" | "IFVG" | "OB" | "BREAKER" | "DEMAND" | "SUPPLY";
export type Zone = {
  kind: ZoneKind;
  bias: "bull" | "bear";
  top: number;
  bottom: number;
  time: number;
  i: number;
  /** True if price has not returned into the zone since formation — strongest reaction expected. */
  fresh: boolean;
  /** Displacement that created the zone, in ATRs — proxy for institutional urgency. */
  impulse: number;
  tests: number;
};
export type Sweep = { i: number; time: number; bias: "bull" | "bear"; level: number };
export type OrderFlow = { delta: number[]; cvd: number[]; available: boolean };
export type Pool = {
  price: number;
  kind: "equal-highs" | "equal-lows";
  touches: number;
  time: number;
  i: number;
};

const LOOK = 200;

/** Fair value gaps + inversions. A gap closed through flips into an IFVG of the opposite bias. */
export function fairValueGaps(cs: Candle[], A: number): Zone[] {
  const out: Zone[] = [];
  const start = Math.max(2, cs.length - LOOK);
  for (let i = start; i < cs.length; i++) {
    const a = cs[i - 2],
      b = cs[i - 1],
      c = cs[i];
    let z: Zone | null = null;
    const impulse = (b.high - b.low) / A;
    if (c.low > a.high && c.low - a.high > A * 0.1)
      z = {
        kind: "FVG",
        bias: "bull",
        top: c.low,
        bottom: a.high,
        time: b.time,
        i: i - 1,
        fresh: true,
        impulse,
        tests: 0,
      };
    else if (c.high < a.low && a.low - c.high > A * 0.1)
      z = {
        kind: "FVG",
        bias: "bear",
        top: a.low,
        bottom: c.high,
        time: b.time,
        i: i - 1,
        fresh: true,
        impulse,
        tests: 0,
      };
    if (!z) continue;
    let alive = true;
    for (let j = i + 1; j < cs.length && alive; j++) {
      const k = cs[j];
      if (z.kind === "FVG") {
        if (z.bias === "bull" && k.close < z.bottom) z = { ...z, kind: "IFVG", bias: "bear" };
        else if (z.bias === "bear" && k.close > z.top) z = { ...z, kind: "IFVG", bias: "bull" };
        else if (z.bias === "bull" ? k.low <= z.bottom : k.high >= z.top)
          alive = false; // fully filled
        else if (z.bias === "bull" ? k.low <= z.top : k.high >= z.bottom) {
          z = { ...z, fresh: false, tests: z.tests + 1 };
        }
      } else if (z.bias === "bear" ? k.close > z.top : k.close < z.bottom) alive = false; // IFVG failed
    }
    if (alive) out.push(z);
  }
  return out;
}

/** Order blocks: last opposite candle before a displacement that breaks structure. Violated OBs become breakers. */
export function orderBlocks(cs: Candle[], pv: Pivot[], A: number): Zone[] {
  const out: Zone[] = [];
  const start = Math.max(1, cs.length - LOOK);
  for (let i = start; i < cs.length - 3; i++) {
    const k = cs[i];
    const move = cs[i + 3].close - k.close;
    const bullOB = k.close < k.open && move > 1.5 * A;
    const bearOB = k.close > k.open && move < -1.5 * A;
    if (!bullOB && !bearOB) continue;
    // must break the most recent swing in the move direction
    const prior = pv.filter((p) => p.i < i && p.kind === (bullOB ? "H" : "L")).pop();
    const hi = Math.max(...cs.slice(i + 1, i + 4).map((x) => x.high));
    const lo = Math.min(...cs.slice(i + 1, i + 4).map((x) => x.low));
    if (prior && (bullOB ? hi <= prior.price : lo >= prior.price)) continue;
    let z: Zone = {
      kind: "OB",
      bias: bullOB ? "bull" : "bear",
      top: k.high,
      bottom: k.low,
      time: k.time,
      i,
      fresh: true,
      impulse: Math.abs(move) / A,
      tests: 0,
    };
    let alive = true;
    for (let j = i + 4; j < cs.length && alive; j++) {
      const c = cs[j];
      if (z.kind === "OB") {
        if (z.bias === "bull" && c.close < z.bottom) z = { ...z, kind: "BREAKER", bias: "bear" };
        else if (z.bias === "bear" && c.close > z.top) z = { ...z, kind: "BREAKER", bias: "bull" };
        else if (z.bias === "bull" ? c.low <= z.top : c.high >= z.bottom)
          z = { ...z, fresh: false, tests: z.tests + 1 };
      } else if (z.bias === "bear" ? c.close > z.top : c.close < z.bottom) alive = false;
    }
    if (alive) out.push(z);
  }
  return out;
}

/** Supply/demand: a tight base (1–3 small candles) followed by a strong displacement candle. */
export function supplyDemand(cs: Candle[], A: number): Zone[] {
  const out: Zone[] = [];
  const start = Math.max(3, cs.length - LOOK);
  for (let i = start; i < cs.length; i++) {
    const d = cs[i];
    const body = d.close - d.open;
    if (Math.abs(body) < 1.5 * A) continue;
    const base: Candle[] = [];
    for (let j = i - 1; j >= i - 3 && j >= 0; j--) {
      if (cs[j].high - cs[j].low < 0.7 * A) base.push(cs[j]);
      else break;
    }
    if (!base.length) continue;
    const top = Math.max(...base.map((b) => b.high)),
      bottom = Math.min(...base.map((b) => b.low));
    const bull = body > 0;
    const touched = cs.slice(i + 1).some((k) => (bull ? k.low <= top : k.high >= bottom));
    const broken = cs.slice(i + 1).some((k) => (bull ? k.close < bottom : k.close > top));
    if (broken) continue;
    out.push({
      kind: bull ? "DEMAND" : "SUPPLY",
      bias: bull ? "bull" : "bear",
      top,
      bottom,
      time: base[base.length - 1].time,
      i: i - base.length,
      fresh: !touched,
      impulse: Math.abs(body) / A,
      tests: touched ? 1 : 0,
    });
  }
  return out;
}

/** Liquidity sweeps: wick through a prior swing extreme with a close back inside (stop hunt). */
export function liquiditySweeps(cs: Candle[], pv: Pivot[]): Sweep[] {
  const out: Sweep[] = [];
  for (let i = Math.max(1, cs.length - 30); i < cs.length; i++) {
    const k = cs[i];
    const ph = pv.filter((p) => p.kind === "H" && p.i < i - 1 && p.i > i - 60);
    const pl = pv.filter((p) => p.kind === "L" && p.i < i - 1 && p.i > i - 60);
    const sh = ph.find((p) => k.high > p.price && k.close < p.price);
    const sl = pl.find((p) => k.low < p.price && k.close > p.price);
    if (sh) out.push({ i, time: k.time, bias: "bear", level: sh.price });
    if (sl) out.push({ i, time: k.time, bias: "bull", level: sl.price });
  }
  return out;
}

/**
 * Equal highs / equal lows — resting liquidity pools where stop orders cluster.
 * Two swing extremes within `tol` of each other, separated by at least 5 bars.
 */
export function liquidityPools(cs: Candle[], pv: Pivot[], tol: number): Pool[] {
  const out: Pool[] = [];
  const recent = pv.filter((p) => p.i > cs.length - 250);
  const highs = recent.filter((p) => p.kind === "H");
  const lows = recent.filter((p) => p.kind === "L");
  const scan = (arr: Pivot[], kind: Pool["kind"]) => {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[j].i - arr[i].i < 5) continue;
        if (Math.abs(arr[j].price - arr[i].price) <= tol) {
          const price = (arr[i].price + arr[j].price) / 2;
          // dedupe against pools already found
          if (out.some((p) => p.kind === kind && Math.abs(p.price - price) <= tol)) continue;
          const touches = arr.filter((p) => Math.abs(p.price - price) <= tol).length;
          out.push({ price, kind, touches, time: arr[j].time, i: arr[j].i });
        }
      }
    }
  };
  scan(highs, "equal-highs");
  scan(lows, "equal-lows");
  return out;
}

/** Dealing range from the dominant recent swing: premium/discount/equilibrium bands. */
export function dealingRange(cs: Candle[], lookback = 100) {
  const win = cs.slice(-lookback);
  const hiI = win.reduce((b, x, i) => (x.high > win[b].high ? i : b), 0);
  const loI = win.reduce((b, x, i) => (x.low < win[b].low ? i : b), 0);
  const hi = win[hiI].high,
    lo = win[loI].low;
  return { hi, lo, eq: (hi + lo) / 2, upLeg: loI < hiI };
}

/** Order-flow proxy: candle delta estimated from close location within range × volume; cumulative = CVD. */
export function orderFlow(cs: Candle[]): OrderFlow {
  const available = cs.slice(-50).filter((c) => c.volume > 0).length > 40;
  const delta = cs.map((c) => {
    const r = c.high - c.low;
    return r > 0 ? (c.volume * (c.close - c.low - (c.high - c.close))) / r : 0;
  });
  const cvd: number[] = [];
  delta.reduce((s, d) => (cvd.push(s + d), s + d), 0);
  return { delta, cvd, available };
}

export function inZone(price: number, z: Zone, pad: number) {
  return price >= z.bottom - pad && price <= z.top + pad;
}
export type { Bias };
